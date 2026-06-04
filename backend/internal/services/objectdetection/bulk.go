package objectdetection

import (
	"fmt"
	"log"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/queues"
)

// EnqueueExistingLibraryImages enqueues object:detect tasks for all image files
// in a library that don't already have object detections.
func EnqueueExistingLibraryImages(client *asynq.Client, db *gorm.DB, libraryID string) (int, error) {
	type fileRow struct {
		ID string `gorm:"column:id"`
	}

	var files []fileRow
	err := db.Raw(`
		SELECT f.id
		FROM files f
		LEFT JOIN object_detections od ON od.file_id = f.id
		WHERE f.library_id = ?
		  AND f.trashed_at IS NULL
		  AND f.mime_type LIKE 'image/%'
		  AND od.id IS NULL
		GROUP BY f.id
	`, libraryID).Scan(&files).Error
	if err != nil {
		return 0, fmt.Errorf("failed to query files: %w", err)
	}

	enqueued := 0
	for _, f := range files {
		task, err := NewObjectDetectTask(libraryID, f.ID)
		if err != nil {
			log.Printf("failed to create object detect task for file %s: %v", f.ID, err)
			continue
		}
		if _, err := client.Enqueue(task, asynq.Queue(queues.ObjectDetection)); err != nil {
			log.Printf("failed to enqueue object detect task for file %s: %v", f.ID, err)
			continue
		}
		enqueued++
	}

	return enqueued, nil
}

// DeleteLibraryObjectData deletes all object detections for a library.
func DeleteLibraryObjectData(db *gorm.DB, libraryID string) error {
	if err := db.Where("library_id = ?", libraryID).Delete(&models.ObjectDetection{}).Error; err != nil {
		return fmt.Errorf("failed to delete object detections: %w", err)
	}
	return nil
}

// ReprocessLibraryObjectData deletes existing object data and re-enqueues all images.
func ReprocessLibraryObjectData(client *asynq.Client, db *gorm.DB, libraryID string) (int, error) {
	if err := DeleteLibraryObjectData(db, libraryID); err != nil {
		return 0, err
	}
	return EnqueueExistingLibraryImages(client, db, libraryID)
}
