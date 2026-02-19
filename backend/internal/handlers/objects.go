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
