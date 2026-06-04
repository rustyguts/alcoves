package facedetection

import (
	"fmt"
	"log"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/queues"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// EnqueueExistingLibraryImages enqueues face:detect tasks for all image files
// in a library that don't already have face detections.
func EnqueueExistingLibraryImages(client *asynq.Client, db *gorm.DB, libraryID string) (int, error) {
	type fileRow struct {
		ID string `gorm:"column:id"`
	}

	var files []fileRow
	err := db.Raw(`
		SELECT f.id
		FROM files f
		LEFT JOIN face_detections fd ON fd.file_id = f.id
		WHERE f.library_id = ?
		  AND f.trashed_at IS NULL
		  AND f.mime_type LIKE 'image/%'
		  AND fd.id IS NULL
		GROUP BY f.id
	`, libraryID).Scan(&files).Error
	if err != nil {
		return 0, fmt.Errorf("failed to query files: %w", err)
	}

	enqueued := 0
	for _, f := range files {
		task, err := NewFaceDetectTask(libraryID, f.ID)
		if err != nil {
			log.Printf("failed to create task for file %s: %v", f.ID, err)
			continue
		}
		if _, err := client.Enqueue(task, asynq.Queue(queues.FaceDetection), asynq.Retention(completedTaskRetention)); err != nil {
			log.Printf("failed to enqueue task for file %s: %v", f.ID, err)
			continue
		}
		enqueued++
	}

	return enqueued, nil
}

// DeleteLibraryFaceData deletes all face detections and people for a library,
// and cleans up cached face thumbnails.
func DeleteLibraryFaceData(db *gorm.DB, storageSvc *storage.Service, libraryID string) error {
	// Delete all face detections
	if err := db.Where("library_id = ?", libraryID).Delete(&models.FaceDetection{}).Error; err != nil {
		return fmt.Errorf("failed to delete face detections: %w", err)
	}

	// Delete all people
	if err := db.Where("library_id = ?", libraryID).Delete(&models.Person{}).Error; err != nil {
		return fmt.Errorf("failed to delete people: %w", err)
	}

	// Clean up cached face thumbnails
	cachePrefix := fmt.Sprintf("%s/faces", libraryID)
	if err := storageSvc.DeleteCachePrefix(cachePrefix); err != nil {
		log.Printf("failed to clean face cache for library %s: %v", libraryID, err)
		// Non-fatal
	}

	return nil
}

// ReprocessLibraryFaceData deletes existing face data and re-enqueues all images.
func ReprocessLibraryFaceData(client *asynq.Client, db *gorm.DB, storageSvc *storage.Service, libraryID string) (int, error) {
	if err := DeleteLibraryFaceData(db, storageSvc, libraryID); err != nil {
		return 0, err
	}
	return EnqueueExistingLibraryImages(client, db, libraryID)
}
