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
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// Tag color palette — matches shared/tag-colors.ts exactly.
var TagColorPalette = []string{
	"#E11D48", "#F97316", "#F59E0B", "#EAB308",
	"#84CC16", "#22C55E", "#14B8A6", "#06B6D4",
	"#3B82F6", "#6366F1", "#8B5CF6", "#D946EF",
}

type TagHandler struct {
	db          *gorm.DB
	activitySvc *activity.Service
}

func NewTagHandler(db *gorm.DB, activitySvc *activity.Service) *TagHandler {
	return &TagHandler{db: db, activitySvc: activitySvc}
}

func (h *TagHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/tags", h.List)
	g.POST("/:id/tags", h.Create)
	g.PATCH("/:id/tags/:tagId", h.Update)
	g.DELETE("/:id/tags/:tagId", h.Delete)
	g.PUT("/:id/files/:fileId/tags", h.SyncFileTags)
	g.PUT("/:id/folders/:folderId/tags", h.SyncFolderTags)
}

func (h *TagHandler) List(c echo.Context) error {
	libraryID := c.Param("id")

	var tags []models.Tag
	h.db.Where("library_id = ?", libraryID).Order("name").Find(&tags)

	result := make([]map[string]interface{}, len(tags))
	for i, t := range tags {
		result[i] = tagToJSON(&t)
	}

	return c.JSON(http.StatusOK, result)
}

type createTagRequest struct {
	Name  string  `json:"name" validate:"required,min=1"`
	Color *string `json:"color"`
}

func (h *TagHandler) Create(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	var req createTagRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}

	color := ""
	if req.Color != nil {
		color = *req.Color
	}

	// Auto-assign color if not provided
	if color == "" {
		color = h.nextAvailableColor(libraryID)
	}

	tag := models.Tag{
		LibraryID: libraryID,
		Name:      req.Name,
		Color:     color,
	}

	if err := h.db.Create(&tag).Error; err != nil {
		return echo.NewHTTPError(http.StatusConflict, "Tag name already in use")
	}

	if h.activitySvc != nil {
		actorID := middleware.GetUserID(c)
		h.activitySvc.EmitAsync(activity.EmitParams{
			LibraryID:   libraryID,
			ActorID:     &actorID,
			Action:      activity.ActionTagCreated,
			SubjectType: activity.SubjectTag,
			SubjectID:   &tag.ID,
			Metadata: map[string]any{
				"name":  tag.Name,
				"color": tag.Color,
			},
		})
	}

	return c.JSON(http.StatusOK, tagToJSON(&tag))
}

type updateTagRequest struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

func (h *TagHandler) Update(c echo.Context) error {
	libraryID := c.Param("id")
	tagID := c.Param("tagId")

	var req updateTagRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}
	updates["updated_at"] = time.Now()

	result := h.db.Model(&models.Tag{}).Where("id = ? AND library_id = ?", tagID, libraryID).Updates(updates)
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Tag not found")
	}

	var tag models.Tag
	h.db.Where("id = ?", tagID).First(&tag)
	return c.JSON(http.StatusOK, tagToJSON(&tag))
}

func (h *TagHandler) Delete(c echo.Context) error {
	libraryID := c.Param("id")
	tagID := c.Param("tagId")

	result := h.db.Where("id = ? AND library_id = ?", tagID, libraryID).Delete(&models.Tag{})
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Tag not found")
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

type syncTagsRequest struct {
	TagIDs []string `json:"tagIds"`
}

func (h *TagHandler) SyncFileTags(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var req syncTagsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	// Verify file exists
	var count int64
	h.db.Model(&models.File{}).Where("id = ? AND library_id = ?", fileID, libraryID).Count(&count)
	if count == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	parsedFileID, err := uuid.Parse(fileID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid file ID")
	}

	// Parse all tag IDs up front so we can fail fast before touching the DB.
	parsedTagIDs := make([]uuid.UUID, 0, len(req.TagIDs))
	for _, tagID := range req.TagIDs {
		tid, err := uuid.Parse(tagID)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid tag ID: "+tagID)
		}
		parsedTagIDs = append(parsedTagIDs, tid)
	}

	// Delete + insert atomically so a failed insert never leaves tags half-written.
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("file_id = ?", parsedFileID).Delete(&models.FileTag{}).Error; err != nil {
			return err
		}
		for _, tid := range parsedTagIDs {
			if err := tx.Create(&models.FileTag{
				FileID: parsedFileID,
				TagID:  tid,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to sync tags")
	}

	// Return updated tags
	var tags []models.Tag
	h.db.Raw(
		"SELECT t.* FROM tags t INNER JOIN file_tags ft ON ft.tag_id = t.id WHERE ft.file_id = ? ORDER BY t.name",
		fileID,
	).Scan(&tags)

	result := make([]map[string]interface{}, len(tags))
	for i, t := range tags {
		result[i] = tagToJSON(&t)
	}
	return c.JSON(http.StatusOK, result)
}

func (h *TagHandler) SyncFolderTags(c echo.Context) error {
	libraryID := c.Param("id")
	folderID := c.Param("folderId")

	var req syncTagsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	var count int64
	h.db.Model(&models.Folder{}).Where("id = ? AND library_id = ?", folderID, libraryID).Count(&count)
	if count == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Folder not found")
	}

	parsedFolderID, err := uuid.Parse(folderID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid folder ID")
	}

	// Parse all tag IDs up front so we can fail fast before touching the DB.
	parsedTagIDs := make([]uuid.UUID, 0, len(req.TagIDs))
	for _, tagID := range req.TagIDs {
		tid, err := uuid.Parse(tagID)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid tag ID: "+tagID)
		}
		parsedTagIDs = append(parsedTagIDs, tid)
	}

	// Delete + insert atomically so a failed insert never leaves tags half-written.
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("folder_id = ?", parsedFolderID).Delete(&models.FolderTag{}).Error; err != nil {
			return err
		}
		for _, tid := range parsedTagIDs {
			if err := tx.Create(&models.FolderTag{
				FolderID: parsedFolderID,
				TagID:    tid,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to sync tags")
	}

	var tags []models.Tag
	h.db.Raw(
		"SELECT t.* FROM tags t INNER JOIN folder_tags ft ON ft.tag_id = t.id WHERE ft.folder_id = ? ORDER BY t.name",
		folderID,
	).Scan(&tags)

	result := make([]map[string]interface{}, len(tags))
	for i, t := range tags {
		result[i] = tagToJSON(&t)
	}
	return c.JSON(http.StatusOK, result)
}

func (h *TagHandler) nextAvailableColor(libraryID uuid.UUID) string {
	var usedColors []string
	h.db.Model(&models.Tag{}).Where("library_id = ?", libraryID).Pluck("color", &usedColors)

	usedSet := map[string]bool{}
	for _, c := range usedColors {
		usedSet[strings.ToUpper(c)] = true
	}

	for _, color := range TagColorPalette {
		if !usedSet[strings.ToUpper(color)] {
			return color
		}
	}

	// If all palette colors used, return first one
	return TagColorPalette[0]
}

func tagToJSON(t *models.Tag) map[string]interface{} {
	return map[string]interface{}{
		"id":        t.ID.String(),
		"libraryId": t.LibraryID.String(),
		"name":      t.Name,
		"color":     t.Color,
		"createdAt": t.CreatedAt.Format(time.RFC3339Nano),
		"updatedAt": t.UpdatedAt.Format(time.RFC3339Nano),
	}
}
