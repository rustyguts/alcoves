// Package jobreaper recovers async jobs that crashed mid-flight and left a
// "files"/"moments" status column stuck on a non-terminal value ("queued" or
// "processing") forever. A worker can die between marking a row in-progress and
// reaching a terminal state — OOM kill, pod eviction, or asynq exhausting its
// retries and archiving the task — at which point no task exists in the queue
// but the database still advertises the job as running. Those rows are the
// "dirty state": a spinner in the UI that never resolves.
//
// The reaper periodically reconciles the database against the *authoritative*
// queue state. A row is considered orphaned only when BOTH hold:
//
//   - its status column is non-terminal ("queued"/"processing"), and
//   - the Asynq inspector reports NO live task (active/pending/scheduled/retry/
//     aggregating) of the matching type for that entity.
//
// Using the inspector as the liveness oracle is what makes this safe for
// genuinely long-running jobs: a multi-hour whisper transcribe is "active" in
// Redis the entire time it runs, so it is never touched no matter how long it
// has been going — there is no wall-clock timeout that could kill a healthy job.
// Only rows whose task has truly vanished (asynq archived it after exhausting
// retries, or it was lost when a worker died uncleanly) are reaped.
//
// The recovery action is to mark the row "failed" — a clean terminal state that
// clears the stuck spinner, surfaces the breakage in the UI, and stays manually
// retryable. The reaper deliberately does NOT re-enqueue: the dominant cause of
// orphaning is a poison-pill input that OOM-kills its worker, and blindly
// re-enqueuing would re-crash the worker pool in a loop. Job classes that have
// their own bounded-retry backfill (metadata, image pre-warm) keep their rows
// "live" in the queue while retrying, so the inspector check naturally spares
// them until they exhaust their own strike cap and settle on a terminal state.
package jobreaper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/queues"
)

const (
	// reaperInterval is how often a reconciliation pass runs. Each pass is a
	// handful of indexed UPDATEs plus bounded inspector reads, so it is cheap to
	// run frequently.
	reaperInterval = 5 * time.Minute

	// reapGrace is how long a row must sit untouched in a non-terminal state
	// before it is even a candidate. It guards the brief window between a worker
	// writing "queued"/"processing" and the matching task becoming visible to
	// the inspector (e.g. a process that committed the status row but died before
	// enqueuing), so normal in-flight work is never mistaken for an orphan. Note
	// this is NOT a job timeout: a healthy long-runner is spared by the live-task
	// check regardless of how stale its row's updated_at is.
	reapGrace = 15 * time.Minute

	// reapBatch bounds how many candidate rows a single spec scans per pass.
	reapBatch = 500

	// orphanReason is written to a job's error column (when it has one) so the
	// UI/admin can tell a reaper recovery apart from a real processing failure.
	orphanReason = "orphaned: worker terminated before the job completed (recovered by the job reaper)"
)

// Task-type wire strings, mirrored here to keep the reaper decoupled from the
// heavyweight worker service packages. reaper_consts_test.go asserts each value
// stays equal to its canonical constant, so a rename can never silently break
// the liveness match.
const (
	taskTranscribe   = "file:transcribe"
	taskVideoProxy   = "video:proxy"
	taskAudioDetect  = "file:audio-detect"
	taskWaveform     = "file:waveform"
	taskMomentExport = "moment:export"
)

// spec describes one reapable job class: where its status lives in the database
// and how to find its live tasks in the queue.
type spec struct {
	name           string // human label for logs
	queue          string // asynq queue to inspect for live tasks
	taskType       string // asynq task type to match within that queue
	table          string // database table holding the status column
	statusColumn   string // the non-terminal/terminal status column
	progressColumn string // optional; nulled on reap
	etaColumn      string // optional; nulled on reap
	errorColumn    string // optional; set to orphanReason on reap
	payloadIDField string // JSON field in the task payload holding the entity id
}

// specs enumerates every async job class that owns a status column on a row and
// has no other mechanism to clear a crashed-mid-flight non-terminal state.
//
// table/column values here are fixed internal identifiers (never user input),
// so interpolating them into SQL below is not an injection vector.
var specs = []spec{
	{
		name: "transcribe", queue: queues.Transcription, taskType: taskTranscribe,
		table: "files", statusColumn: "transcribe_status",
		progressColumn: "transcribe_progress", etaColumn: "transcribe_eta_seconds",
		errorColumn: "transcribe_error", payloadIDField: "fileId",
	},
	{
		name: "video-proxy", queue: queues.VideoTranscode, taskType: taskVideoProxy,
		table: "files", statusColumn: "proxy_status",
		progressColumn: "proxy_progress", etaColumn: "proxy_eta_seconds",
		errorColumn: "", payloadIDField: "fileId",
	},
	{
		name: "audio-detect", queue: queues.AudioDetection, taskType: taskAudioDetect,
		table: "files", statusColumn: "audio_detect_status",
		progressColumn: "audio_detect_progress", etaColumn: "audio_detect_eta_seconds",
		errorColumn: "audio_detect_error", payloadIDField: "fileId",
	},
	{
		name: "waveform", queue: queues.Waveform, taskType: taskWaveform,
		table: "files", statusColumn: "waveform_status",
		progressColumn: "waveform_progress", etaColumn: "",
		errorColumn: "waveform_error", payloadIDField: "fileId",
	},
	{
		name: "moment-export", queue: queues.MomentExport, taskType: taskMomentExport,
		table: "moments", statusColumn: "export_status",
		progressColumn: "export_progress", etaColumn: "export_eta_seconds",
		errorColumn: "", payloadIDField: "momentId",
	},
}

// Service reconciles job status rows against the queue.
type Service struct {
	db        *gorm.DB
	inspector *asynq.Inspector
}

// NewService builds a reaper bound to a database and an Asynq inspector.
func NewService(db *gorm.DB, inspector *asynq.Inspector) *Service {
	return &Service{db: db, inspector: inspector}
}

// Start launches a background loop that runs a reconciliation pass at boot and
// then every reaperInterval until ctx is cancelled. It is meant to run only on
// worker/all nodes (where the inspector and DB are both reachable).
func Start(ctx context.Context, db *gorm.DB, inspector *asynq.Inspector) {
	s := NewService(db, inspector)
	go func() {
		ticker := time.NewTicker(reaperInterval)
		defer ticker.Stop()

		s.RunPass(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.RunPass(ctx)
			}
		}
	}()
}

// RunPass reaps orphaned jobs for every spec once. Errors are logged per spec so
// one failing job class never blocks the others.
func (s *Service) RunPass(ctx context.Context) {
	for _, sp := range specs {
		n, err := s.reapSpec(sp)
		if err != nil {
			log.Printf("job reaper: %s: %v", sp.name, err)
			continue
		}
		if n > 0 {
			log.Printf("job reaper: %s: marked %d orphaned job(s) failed", sp.name, n)
		}
		if ctx.Err() != nil {
			return
		}
	}
}

// reapSpec scans one job class for orphans and marks them failed. It returns the
// number of rows recovered.
func (s *Service) reapSpec(sp spec) (int, error) {
	// 1. Candidates: non-terminal and untouched past the grace window.
	candidates, err := s.candidates(sp)
	if err != nil {
		return 0, fmt.Errorf("scan: %w", err)
	}
	if len(candidates) == 0 {
		return 0, nil
	}

	// 2. Liveness oracle, read AFTER selecting candidates so a task that became
	//    active in the meantime is in the set and spares its row.
	live, err := s.liveIDs(sp)
	if err != nil {
		return 0, fmt.Errorf("inspect queue %q: %w", sp.queue, err)
	}

	// 3. Orphans = candidates with no live task of the matching type.
	orphans := selectOrphans(candidates, live)
	if len(orphans) == 0 {
		return 0, nil
	}

	// 4. Mark failed. The status guard in the UPDATE makes this a no-op for any
	//    row that reached a terminal state between the scan and now.
	return s.markFailed(sp, orphans)
}

// candidates returns ids of rows in a non-terminal state that have not been
// touched for at least reapGrace.
func (s *Service) candidates(sp spec) ([]string, error) {
	var ids []string
	q := fmt.Sprintf(`
		SELECT id FROM %s
		WHERE %s IN ('queued', 'processing')
		  AND trashed_at IS NULL
		  AND updated_at < NOW() - ? * INTERVAL '1 second'
		LIMIT ?`, sp.table, sp.statusColumn)
	err := s.db.Raw(q, int(reapGrace.Seconds()), reapBatch).Scan(&ids).Error
	return ids, err
}

// liveIDs returns the set of entity ids that currently have a live task (active,
// pending, scheduled, or retrying) of the spec's type in its queue. Archived and
// completed tasks are intentionally excluded: archived means asynq gave up (the
// row is orphaned), completed means the job already finished. Aggregating tasks
// are not listed because no reaped job class enqueues with a group key.
func (s *Service) liveIDs(sp spec) (map[string]struct{}, error) {
	live := map[string]struct{}{}
	listers := []func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error){
		s.inspector.ListActiveTasks,
		s.inspector.ListPendingTasks,
		s.inspector.ListScheduledTasks,
		s.inspector.ListRetryTasks,
	}
	for _, list := range listers {
		if err := collectLiveIDs(list, sp, live); err != nil {
			return nil, err
		}
	}
	return live, nil
}

// collectLiveIDs paginates a single task lister fully and adds the payload id of
// every matching-type task to live.
func collectLiveIDs(
	list func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error),
	sp spec,
	live map[string]struct{},
) error {
	const pageSize = 500
	// Bound total pages as a runaway backstop (250 * 500 = 125k tasks per state).
	for page := 1; page <= 250; page++ {
		tasks, err := list(sp.queue, asynq.PageSize(pageSize), asynq.Page(page))
		if err != nil {
			// A queue Redis has never seen yields a wrapped ErrQueueNotFound; that
			// just means zero live tasks, not a failure.
			if errors.Is(err, asynq.ErrQueueNotFound) {
				return nil
			}
			return err
		}
		for _, t := range tasks {
			if t.Type != sp.taskType {
				continue
			}
			if id := payloadID(t.Payload, sp.payloadIDField); id != "" {
				live[id] = struct{}{}
			}
		}
		if len(tasks) < pageSize {
			break
		}
	}
	return nil
}

// payloadID extracts a string field from a task's JSON payload, returning "" if
// the payload is unparseable or the field is missing/non-string.
func payloadID(payload []byte, field string) string {
	if len(payload) == 0 {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		return ""
	}
	if v, ok := m[field].(string); ok {
		return v
	}
	return ""
}

// selectOrphans returns the candidate ids that have no live task.
func selectOrphans(candidates []string, live map[string]struct{}) []string {
	orphans := make([]string, 0, len(candidates))
	for _, id := range candidates {
		if _, ok := live[id]; !ok {
			orphans = append(orphans, id)
		}
	}
	return orphans
}

// markFailed transitions the given rows to "failed", clearing progress/eta and
// recording the orphan reason. The status guard ensures a row that completed
// between the scan and now is left untouched.
func (s *Service) markFailed(sp spec, ids []string) (int, error) {
	updates := map[string]any{
		sp.statusColumn: "failed",
		"updated_at":    gorm.Expr("NOW()"),
	}
	if sp.errorColumn != "" {
		updates[sp.errorColumn] = orphanReason
	}
	if sp.progressColumn != "" {
		updates[sp.progressColumn] = nil
	}
	if sp.etaColumn != "" {
		updates[sp.etaColumn] = nil
	}

	res := s.db.Table(sp.table).
		Where("id IN ?", ids).
		Where(sp.statusColumn+" IN ('queued','processing')").
		Updates(updates)
	return int(res.RowsAffected), res.Error
}
