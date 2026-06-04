package metadata

import (
	"log"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// ReprocessLibrary re-enqueues metadata extraction for every live, non-derived
// image/video file in a library. It resets metadata_attempts (lifting the
// 3-strike cap — the escape hatch for retrying exhausted files after a parser
// fix) and bumps metadata_version so any in-flight stale work self-discards.
// Returns the number of files enqueued.
func (s *Service) ReprocessLibrary(libraryID string) (int, error) {
	var rows []pendingFile
	if err := s.db.Raw(`
		SELECT id, library_id FROM files
		WHERE library_id = ?
		  AND trashed_at IS NULL
		  AND source_file_id IS NULL
		  AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')
	`, libraryID).Scan(&rows).Error; err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}

	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}

	if err := s.db.Model(&models.File{}).Where("id IN ?", ids).Updates(map[string]interface{}{
		"metadata_attempts": 0,
		"metadata_status":   "queued",
		"metadata_error":    nil,
		"metadata_version":  gorm.Expr("metadata_version + 1"),
	}).Error; err != nil {
		return 0, err
	}

	enqueued := 0
	for _, r := range rows {
		if err := s.EnqueueMetadata(r.LibraryID, r.ID); err != nil {
			log.Printf("metadata reprocess: enqueue failed for %s: %v", r.ID, err)
			continue
		}
		enqueued++
	}
	return enqueued, nil
}
