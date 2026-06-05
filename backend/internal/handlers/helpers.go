package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// findActiveFile loads a non-trashed file scoped to its library, or returns a 404.
func findActiveFile(db *gorm.DB, libraryID, fileID string) (*models.File, error) {
	var file models.File
	if err := db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error; err != nil {
		return nil, echo.NewHTTPError(http.StatusNotFound, "File not found")
	}
	return &file, nil
}

// findFileAnyState loads a file scoped to its library regardless of trash state, or returns a 404.
func findFileAnyState(db *gorm.DB, libraryID, fileID string) (*models.File, error) {
	var file models.File
	if err := db.Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return nil, echo.NewHTTPError(http.StatusNotFound, "File not found")
	}
	return &file, nil
}

// emitActivity emits an activity event when the service is configured. A nil
// service (e.g. in tests or worker-only mode) is a no-op.
func emitActivity(svc *activity.Service, p activity.EmitParams) {
	if svc != nil {
		svc.EmitAsync(p)
	}
}
