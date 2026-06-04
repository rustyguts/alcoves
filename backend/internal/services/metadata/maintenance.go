package metadata

import (
	"context"
	"log"
	"time"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

const (
	// maintenanceInterval is how often the backfill scan runs.
	maintenanceInterval = 2 * time.Minute
	// maintenanceBatch bounds how many files a single pass enqueues so the
	// shared default queue is never flooded.
	maintenanceBatch = 200
	// maxMetadataAttempts is the 3-strike cap: a file that fails extraction this
	// many times is dropped from the scan and never re-queued by maintenance.
	maxMetadataAttempts = 3
	// stuckThreshold lets a file that has been "queued"/"processing" longer than
	// this be re-selected, recovering work orphaned by a crashed worker.
	stuckThreshold = 15 * time.Minute
)

// pendingFile is the minimal projection the maintenance scan needs.
type pendingFile struct {
	ID        string `gorm:"column:id"`
	LibraryID string `gorm:"column:library_id"`
}

// StartMaintenance launches a background loop that backfills metadata for media
// files that have never been successfully extracted. It runs only on worker/all
// nodes and exits when ctx is cancelled. An immediate first pass runs at boot so
// existing libraries start populating without waiting a full interval.
func StartMaintenance(ctx context.Context, db *gorm.DB, svc *Service) {
	go func() {
		ticker := time.NewTicker(maintenanceInterval)
		defer ticker.Stop()

		runMaintenancePass(db, svc)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runMaintenancePass(db, svc)
			}
		}
	}()
}

// scanPendingMetadata selects up to `limit` live, non-derived media files that
// have not been successfully extracted, are under the 3-strike cap, and are not
// currently queued/processing (unless stuck past stuckThreshold).
func scanPendingMetadata(db *gorm.DB, limit int) ([]pendingFile, error) {
	var rows []pendingFile
	err := db.Raw(`
		SELECT id, library_id FROM files
		WHERE metadata_extracted_version IS NULL
		  AND metadata_attempts < ?
		  AND trashed_at IS NULL
		  AND source_file_id IS NULL
		  AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')
		  AND (
		        metadata_status IS NULL
		        OR metadata_status NOT IN ('queued', 'processing')
		        OR updated_at < NOW() - ? * INTERVAL '1 second'
		  )
		ORDER BY created_at DESC
		LIMIT ?
	`, maxMetadataAttempts, int(stuckThreshold.Seconds()), limit).Scan(&rows).Error
	return rows, err
}

// runMaintenancePass selects a bounded batch of un-extracted media files,
// marks them queued, and enqueues extraction for each.
func runMaintenancePass(db *gorm.DB, svc *Service) {
	rows, err := scanPendingMetadata(db, maintenanceBatch)
	if err != nil {
		log.Printf("metadata maintenance: scan failed: %v", err)
		return
	}

	if len(rows) == 0 {
		return
	}

	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}

	// Mark the batch queued so the next pass skips them (GORM refreshes
	// updated_at, starting the stuck-recovery clock).
	if err := db.Model(&models.File{}).Where("id IN ?", ids).
		Update("metadata_status", "queued").Error; err != nil {
		log.Printf("metadata maintenance: failed to mark %d file(s) queued: %v", len(ids), err)
		return
	}

	enqueued := 0
	for _, r := range rows {
		if err := svc.EnqueueMetadata(r.LibraryID, r.ID); err != nil {
			log.Printf("metadata maintenance: enqueue failed for %s: %v", r.ID, err)
			continue
		}
		enqueued++
	}
	log.Printf("metadata maintenance: enqueued %d/%d media file(s) for backfill", enqueued, len(rows))
}
