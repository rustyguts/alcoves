package facedetection

import (
	"fmt"
	"log"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// DeleteFaceDataForFiles removes face detections for specific files,
// updates person face counts, and cleans up orphaned people and thumbnails.
func DeleteFaceDataForFiles(db *gorm.DB, storageSvc *storage.Service, libraryID string, fileIDs []string) error {
	if len(fileIDs) == 0 {
		return nil
	}

	// Get all affected detections (for thumbnail cleanup and person updates)
	var detections []models.FaceDetection
	if err := db.Where("file_id IN ? AND library_id = ?", fileIDs, libraryID).Find(&detections).Error; err != nil {
		return fmt.Errorf("failed to query detections: %w", err)
	}

	if len(detections) == 0 {
		return nil
	}

	// Track affected person IDs
	affectedPersonIDs := make(map[string]bool)
	for _, d := range detections {
		if d.PersonID != nil {
			affectedPersonIDs[d.PersonID.String()] = true
		}
	}

	// Delete the face detections
	if err := db.Where("file_id IN ? AND library_id = ?", fileIDs, libraryID).Delete(&models.FaceDetection{}).Error; err != nil {
		return fmt.Errorf("failed to delete detections: %w", err)
	}

	// Update face counts for affected people
	for personID := range affectedPersonIDs {
		var count int64
		db.Model(&models.FaceDetection{}).Where("person_id = ?", personID).Count(&count)

		if count == 0 {
			// Delete person with no faces
			db.Where("id = ?", personID).Delete(&models.Person{})
		} else {
			db.Model(&models.Person{}).Where("id = ?", personID).Updates(map[string]interface{}{
				"face_count": count,
			})

			// Check if cover photo was deleted
			var person models.Person
			if err := db.Where("id = ?", personID).First(&person).Error; err == nil {
				if person.CoverFaceDetectionID != nil {
					var coverExists int64
					db.Model(&models.FaceDetection{}).Where("id = ?", *person.CoverFaceDetectionID).Count(&coverExists)
					if coverExists == 0 {
						// Set new cover photo to highest quality remaining face
						var bestFace models.FaceDetection
						if err := db.Where("person_id = ?", personID).Order("quality_score DESC NULLS LAST").First(&bestFace).Error; err == nil {
							db.Model(&models.Person{}).Where("id = ?", personID).Update("cover_face_detection_id", bestFace.ID)
						} else {
							db.Model(&models.Person{}).Where("id = ?", personID).Update("cover_face_detection_id", nil)
						}
					}
				}
			}
		}
	}

	// Clean up cached thumbnails
	for _, d := range detections {
		cacheKey := storage.FaceCropKey(libraryID, d.ID.String())
		if err := storageSvc.DeleteCachePrefix(cacheKey); err != nil {
			log.Printf("failed to delete face thumbnail cache %s: %v", cacheKey, err)
		}
	}

	return nil
}
