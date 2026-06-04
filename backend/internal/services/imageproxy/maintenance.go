package imageproxy

import (
	"context"
	"log"
	"time"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

const (
	// prewarmInterval is how often the pre-warm backfill scan runs. The product
	// requirement is hourly: heavy enough work that more frequent passes would
	// waste CPU, infrequent enough that a freshly imported library is fully
	// warm within a day.
	prewarmInterval = 1 * time.Hour
	// prewarmBatch bounds how many files a single pass enqueues so the
	// maintenance queue (and Redis) is never flooded; the rest drain on later
	// passes.
	prewarmBatch = 500
	// maxPrewarmAttempts is the 3-strike cap: a file whose variants fail to
	// generate this many times (a corrupted/unsupported image) is dropped from
	// the scan and never re-queued. This is what stops a job that "fails every
	// time" from running more than 3 times across maintenance passes.
	maxPrewarmAttempts = 3
	// prewarmStuckThreshold lets a file stuck in "queued"/"processing" longer
	// than this be re-selected, recovering work orphaned by a crashed worker.
	prewarmStuckThreshold = 15 * time.Minute
)

// pendingPrewarmFile is the minimal projection the scan needs to enqueue work;
// the worker re-loads the full row (with source dimensions) when it runs.
type pendingPrewarmFile struct {
	ID        string `gorm:"column:id"`
	LibraryID string `gorm:"column:library_id"`
}

// StartPrewarmMaintenance launches the hourly background loop that generates
// every image-proxy Variant for images that have not been warmed yet. It runs
// only on worker/all nodes and exits when ctx is cancelled. An immediate first
// pass runs at boot so existing libraries start warming without waiting an hour.
// If pre-warming is disabled (no processor wired up) the loop is a no-op.
func StartPrewarmMaintenance(ctx context.Context, db *gorm.DB, svc *PrewarmService) {
	if svc == nil || !svc.Enabled() {
		log.Println("image:prewarm — maintenance disabled (no transform processor); skipping")
		return
	}
	go func() {
		ticker := time.NewTicker(prewarmInterval)
		defer ticker.Stop()

		runPrewarmPass(db, svc)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runPrewarmPass(db, svc)
			}
		}
	}()
}

// scanPendingPrewarm selects up to `limit` live image files that have not been
// warmed at the current VariantsVersion, are under the 3-strike cap, and are not
// already queued/processing (unless stuck past prewarmStuckThreshold).
func scanPendingPrewarm(db *gorm.DB, limit int) ([]pendingPrewarmFile, error) {
	var rows []pendingPrewarmFile
	err := db.Raw(`
		SELECT id, library_id FROM files
		WHERE image_proxy_warmed_version IS NULL
		  AND image_proxy_attempts < ?
		  AND trashed_at IS NULL
		  AND mime_type LIKE 'image/%'
		  AND (
		        image_proxy_status IS NULL
		        OR image_proxy_status NOT IN ('queued', 'processing')
		        OR updated_at < NOW() - ? * INTERVAL '1 second'
		  )
		ORDER BY created_at DESC
		LIMIT ?
	`, maxPrewarmAttempts, int(prewarmStuckThreshold.Seconds()), limit).Scan(&rows).Error
	return rows, err
}

// runPrewarmPass selects a bounded batch of un-warmed image files, marks them
// queued (so the next pass skips them and the stuck-recovery clock starts), and
// enqueues a pre-warm task for each.
func runPrewarmPass(db *gorm.DB, svc *PrewarmService) {
	rows, err := scanPendingPrewarm(db, prewarmBatch)
	if err != nil {
		log.Printf("image:prewarm maintenance: scan failed: %v", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}

	if err := db.Model(&models.File{}).Where("id IN ?", ids).
		Update("image_proxy_status", "queued").Error; err != nil {
		log.Printf("image:prewarm maintenance: failed to mark %d file(s) queued: %v", len(ids), err)
		return
	}

	enqueued := 0
	for _, r := range rows {
		if err := svc.EnqueuePrewarm(r.LibraryID, r.ID); err != nil {
			log.Printf("image:prewarm maintenance: enqueue failed for %s: %v", r.ID, err)
			continue
		}
		enqueued++
	}
	log.Printf("image:prewarm maintenance: enqueued %d/%d image file(s) for variant pre-warm", enqueued, len(rows))
}
