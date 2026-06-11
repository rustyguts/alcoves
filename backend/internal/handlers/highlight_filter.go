package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
)

type HighlightFilterHandler struct {
	db *gorm.DB
}

func NewHighlightFilterHandler(db *gorm.DB) *HighlightFilterHandler {
	return &HighlightFilterHandler{db: db}
}

func (h *HighlightFilterHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/highlight-filters", h.List)
	g.POST("/:id/highlight-filters", h.Create)
	g.PATCH("/:id/highlight-filters/:filterId", h.Update)
	g.DELETE("/:id/highlight-filters/:filterId", h.Delete)
}

func (h *HighlightFilterHandler) List(c echo.Context) error {
	libraryID := c.Param("id")
	var filters []models.HighlightFilter
	if err := h.db.Where("library_id = ?", libraryID).Order("created_at ASC").Find(&filters).Error; err != nil {
		return internalError("Failed to list highlight filters", err)
	}
	out := make([]map[string]interface{}, len(filters))
	for i, f := range filters {
		out[i] = highlightFilterToJSON(&f)
	}
	return c.JSON(http.StatusOK, out)
}

type createHighlightFilterRequest struct {
	Name             string  `json:"name" validate:"required,min=1"`
	Expression       string  `json:"expression" validate:"required,min=1"`
	ProximitySeconds *int    `json:"proximitySeconds"`
	Color            *string `json:"color"`
}

func (h *HighlightFilterHandler) Create(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	var req createHighlightFilterRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}
	if strings.TrimSpace(req.Expression) == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "expression cannot be empty")
	}

	proximity := 5
	if req.ProximitySeconds != nil {
		proximity = clampProximity(*req.ProximitySeconds)
	}
	color := "#3B82F6"
	if req.Color != nil && strings.TrimSpace(*req.Color) != "" {
		color = *req.Color
	}

	filter := models.HighlightFilter{
		LibraryID:        libraryID,
		Name:             req.Name,
		Expression:       req.Expression,
		ProximitySeconds: proximity,
		Color:            color,
	}
	if userID := middleware.GetUserID(c); userID != uuid.Nil {
		filter.CreatedByID = &userID
	}

	if err := h.db.Create(&filter).Error; err != nil {
		return internalError("Failed to create highlight filter", err)
	}
	return c.JSON(http.StatusOK, highlightFilterToJSON(&filter))
}

type updateHighlightFilterRequest struct {
	Name             *string `json:"name"`
	Expression       *string `json:"expression"`
	ProximitySeconds *int    `json:"proximitySeconds"`
	Color            *string `json:"color"`
}

func (h *HighlightFilterHandler) Update(c echo.Context) error {
	libraryID := c.Param("id")
	filterID := c.Param("filterId")

	var req updateHighlightFilterRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		if strings.TrimSpace(*req.Name) == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "name cannot be empty")
		}
		updates["name"] = *req.Name
	}
	if req.Expression != nil {
		if strings.TrimSpace(*req.Expression) == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "expression cannot be empty")
		}
		updates["expression"] = *req.Expression
	}
	if req.ProximitySeconds != nil {
		updates["proximity_seconds"] = clampProximity(*req.ProximitySeconds)
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}
	updates["updated_at"] = time.Now()

	result := h.db.Model(&models.HighlightFilter{}).
		Where("id = ? AND library_id = ?", filterID, libraryID).
		Updates(updates)
	if result.Error != nil {
		return internalError("Failed to update highlight filter", result.Error)
	}
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Highlight filter not found")
	}

	var filter models.HighlightFilter
	if err := h.db.Where("id = ?", filterID).First(&filter).Error; err != nil {
		return internalError("Failed to load updated filter", err)
	}
	return c.JSON(http.StatusOK, highlightFilterToJSON(&filter))
}

func (h *HighlightFilterHandler) Delete(c echo.Context) error {
	libraryID := c.Param("id")
	filterID := c.Param("filterId")

	result := h.db.Where("id = ? AND library_id = ?", filterID, libraryID).Delete(&models.HighlightFilter{})
	if result.Error != nil {
		return internalError("Failed to delete highlight filter", result.Error)
	}
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Highlight filter not found")
	}
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func clampProximity(v int) int {
	if v < 0 {
		return 0
	}
	if v > 60 {
		return 60
	}
	return v
}

func highlightFilterToJSON(f *models.HighlightFilter) map[string]interface{} {
	out := map[string]interface{}{
		"id":               f.ID.String(),
		"libraryId":        f.LibraryID.String(),
		"createdById":      nil,
		"name":             f.Name,
		"expression":       f.Expression,
		"proximitySeconds": f.ProximitySeconds,
		"color":            f.Color,
		"createdAt":        f.CreatedAt.Format(time.RFC3339Nano),
		"updatedAt":        f.UpdatedAt.Format(time.RFC3339Nano),
	}
	if f.CreatedByID != nil {
		out["createdById"] = f.CreatedByID.String()
	}
	return out
}
