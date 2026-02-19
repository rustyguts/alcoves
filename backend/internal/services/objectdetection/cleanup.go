package objectdetection

import (
	"fmt"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// DeleteObjectDataForFiles removes object detections for specific files.
func DeleteObjectDataForFiles(db *gorm.DB, libraryID string, fileIDs []string) error {
	if len(fileIDs) == 0 {
		return nil
	}

	if err := db.Where("file_id IN ? AND library_id = ?", fileIDs, libraryID).Delete(&models.ObjectDetection{}).Error; err != nil {
		return fmt.Errorf("failed to delete object detections: %w", err)
	}

	return nil
}
