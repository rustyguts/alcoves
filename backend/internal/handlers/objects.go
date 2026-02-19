package handlers

import (
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
)

type ObjectsHandler struct {
	db     *gorm.DB
	objSvc *objectdetection.Service
}

func NewObjectsHandler(db *gorm.DB, objSvc *objectdetection.Service) *ObjectsHandler {
	return &ObjectsHandler{db: db, objSvc: objSvc}
}

func (h *ObjectsHandler) RegisterRoutes(g *echo.Group) {
	g.POST("/:id/object-detection/reprocess", h.Reprocess)
	g.GET("/:id/objects/labels", h.Labels)
}

// Reprocess deletes all object detection data for a library and re-enqueues all images.
func (h *ObjectsHandler) Reprocess(c echo.Context) error {
	libraryID := c.Param("id")

	if h.objSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Object detection service not available")
	}

	enqueued, err := h.objSvc.ReprocessLibrary(libraryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("Reprocess failed: %v", err))
	}

	return c.JSON(http.StatusOK, map[string]int{"queuedCount": enqueued})
}

// Labels returns distinct object labels and file counts for a library.
func (h *ObjectsHandler) Labels(c echo.Context) error {
	libraryID := c.Param("id")

	type labelCount struct {
		Label     string `gorm:"column:label" json:"label"`
		FileCount int    `gorm:"column:file_count" json:"fileCount"`
	}

	var labels []labelCount
	if err := h.db.Raw(`
		SELECT label, COUNT(DISTINCT file_id) as file_count
		FROM object_detections
		WHERE library_id = ?
		GROUP BY label
		ORDER BY file_count DESC, label ASC
	`, libraryID).Scan(&labels).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to query object labels")
	}

	if labels == nil {
		labels = []labelCount{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"labels": labels,
	})
}
