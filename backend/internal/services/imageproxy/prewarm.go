package imageproxy

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/queues"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// TaskTypePrewarm is the asynq task type for the background job that generates
// every image-proxy Variant for a single file and writes them to the cache, so
// the first real request is a warm-cache hit instead of a blocking transform.
const TaskTypePrewarm = "image:prewarm"

const (
	// prewarmCompletedRetention keeps a finished pre-warm task visible in the
	// admin dashboard briefly. These are high-volume and uninteresting once
	// done, so retention is short.
	prewarmCompletedRetention = 10 * time.Minute
	// prewarmUniqueTTL deduplicates concurrent enqueues of the same file within
	// a maintenance pass. It is well under the 1-hour maintenance interval so a
	// file that still needs warming is re-enqueued on the next pass.
	prewarmUniqueTTL = 50 * time.Minute
)

// PrewarmPayload is the asynq payload for a pre-warm task.
type PrewarmPayload struct {
	LibraryID string `json:"libraryId"`
	FileID    string `json:"fileId"`
}

// PrewarmService owns enqueuing image-proxy variant pre-warm work. Unlike the
// request-path Service it needs DB access (to read source dimensions and track
// the 3-strike attempt counter), so it is a distinct type wired with its own
// dependencies.
type PrewarmService struct {
	db          *gorm.DB
	storageSvc  *storage.Service
	processor   Processor
	asynqClient *asynq.Client
}

// NewPrewarmService constructs the pre-warm service. processor may be nil (the
// request-path Service serves originals when no processor is wired up); in that
// case Enabled reports false and the maintenance loop is a no-op.
func NewPrewarmService(db *gorm.DB, storageSvc *storage.Service, processor Processor, asynqClient *asynq.Client) *PrewarmService {
	return &PrewarmService{db: db, storageSvc: storageSvc, processor: processor, asynqClient: asynqClient}
}

// Enabled reports whether pre-warming can run. Without a processor there is no
// way to transform images (e.g. a build without libvips), so the maintenance
// loop should not start.
func (s *PrewarmService) Enabled() bool {
	return s.processor != nil && s.asynqClient != nil
}

// NewPrewarmTask builds the asynq task for a single file's pre-warm.
func NewPrewarmTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(PrewarmPayload{LibraryID: libraryID, FileID: fileID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypePrewarm, payload), nil
}

// EnqueuePrewarm queues variant pre-warming for one file on the low-priority
// maintenance queue. MaxRetry is 0: the cross-pass attempt counter in the DB
// (image_proxy_attempts, capped at maxPrewarmAttempts) is the real 3-strike
// guard, so a single failed run is simply retried by the next hourly pass —
// never asynq's 25-retry default.
func (s *PrewarmService) EnqueuePrewarm(libraryID, fileID string) error {
	task, err := NewPrewarmTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create prewarm task: %w", err)
	}
	if _, err := s.asynqClient.Enqueue(task,
		asynq.Queue(queues.Maintenance),
		asynq.MaxRetry(0),
		asynq.Unique(prewarmUniqueTTL),
		asynq.Retention(prewarmCompletedRetention),
	); err != nil {
		return fmt.Errorf("failed to enqueue prewarm task: %w", err)
	}
	return nil
}

// NewTaskHandler returns the asynq handler for image:prewarm tasks.
func (s *PrewarmService) NewTaskHandler() *PrewarmTaskHandler {
	return &PrewarmTaskHandler{db: s.db, storageSvc: s.storageSvc, processor: s.processor}
}
