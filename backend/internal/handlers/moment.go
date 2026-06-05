package handlers

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// MomentHandler exposes CRUD for moments + tag attach/detach + export trigger
// + download. Share endpoints live in moment_share.go.
type MomentHandler struct {
	db           *gorm.DB
	storage      *storage.Service
	momentExport *momentexport.Service
	baseURL      string
	activitySvc  *activity.Service
}

func NewMomentHandler(db *gorm.DB, storageSvc *storage.Service, momentExportSvc *momentexport.Service, baseURL string, activitySvc *activity.Service) *MomentHandler {
	return &MomentHandler{db: db, storage: storageSvc, momentExport: momentExportSvc, baseURL: baseURL, activitySvc: activitySvc}
}

func (h *MomentHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/files/:fileId/moments", h.List)
	g.POST("/:id/files/:fileId/moments", h.Create)
	g.GET("/:id/files/:fileId/moments/:momentId", h.Get)
	g.PATCH("/:id/files/:fileId/moments/:momentId", h.Update)
	g.DELETE("/:id/files/:fileId/moments/:momentId", h.Delete)

	g.PUT("/:id/files/:fileId/moments/:momentId/tags", h.SyncTags)

	g.POST("/:id/files/:fileId/moments/:momentId/export", h.Export)
	g.GET("/:id/files/:fileId/moments/:momentId/download", h.Download)

	h.RegisterShareRoutes(g)
}

// ─── Response shape ─────────────────────────────────────────────────────────

type momentResponse struct {
	ID               string   `json:"id"`
	FileID           string   `json:"fileId"`
	LibraryID        string   `json:"libraryId"`
	CreatedByID      string   `json:"createdById"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	StartSeconds     float64  `json:"startSeconds"`
	EndSeconds       float64  `json:"endSeconds"`
	ExportStatus     *string  `json:"exportStatus"`
	ExportProgress   *int     `json:"exportProgress"`
	ExportEtaSeconds *int     `json:"exportEtaSeconds"`
	ExportVersion    int      `json:"exportVersion"`
	ExportedVersion  *int     `json:"exportedVersion"`
	TrashedAt        *string  `json:"trashedAt"`
	CreatedAt        string   `json:"createdAt"`
	UpdatedAt        string   `json:"updatedAt"`
	Tags             []tagRef `json:"tags"`
}

type tagRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

func formatMomentTime(t time.Time) string {
	return t.Format("2006-01-02T15:04:05.000Z")
}

func formatMomentTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := formatMomentTime(*t)
	return &s
}

func (h *MomentHandler) toMomentResponse(m *models.Moment, tags []models.Tag) momentResponse {
	tagList := make([]tagRef, 0, len(tags))
	for _, t := range tags {
		tagList = append(tagList, tagRef{ID: t.ID.String(), Name: t.Name, Color: t.Color})
	}
	return momentResponse{
		ID:               m.ID.String(),
		FileID:           m.FileID.String(),
		LibraryID:        m.LibraryID.String(),
		CreatedByID:      m.CreatedByID.String(),
		Name:             m.Name,
		Description:      m.Description,
		StartSeconds:     m.StartSeconds,
		EndSeconds:       m.EndSeconds,
		ExportStatus:     m.ExportStatus,
		ExportProgress:   m.ExportProgress,
		ExportEtaSeconds: m.ExportEtaSeconds,
		ExportVersion:    m.ExportVersion,
		ExportedVersion:  m.ExportedVersion,
		TrashedAt:        formatMomentTimePtr(m.TrashedAt),
		CreatedAt:        formatMomentTime(m.CreatedAt),
		UpdatedAt:        formatMomentTime(m.UpdatedAt),
		Tags:             tagList,
	}
}

// loadTagsByMoment returns a map momentID→[]Tag for efficient hydration.
func (h *MomentHandler) loadTagsByMoment(momentIDs []uuid.UUID) (map[uuid.UUID][]models.Tag, error) {
	out := make(map[uuid.UUID][]models.Tag, len(momentIDs))
	if len(momentIDs) == 0 {
		return out, nil
	}

	type row struct {
		MomentID uuid.UUID `gorm:"column:moment_id"`
		models.Tag
	}
	var rows []row
	err := h.db.Raw(`
		SELECT mt.moment_id, t.*
		FROM moment_tags mt
		JOIN tags t ON t.id = mt.tag_id
		WHERE mt.moment_id IN ?
		ORDER BY t.name
	`, momentIDs).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.MomentID] = append(out[r.MomentID], r.Tag)
	}
	return out, nil
}

// ─── List ───────────────────────────────────────────────────────────────────

func (h *MomentHandler) List(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	fileID, err := uuid.Parse(c.Param("fileId"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid file ID")
	}

	var moments []models.Moment
	if err := h.db.
		Where("library_id = ? AND file_id = ? AND trashed_at IS NULL", libraryID, fileID).
		Order("start_seconds ASC, created_at ASC").
		Find(&moments).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to list moments")
	}

	ids := make([]uuid.UUID, 0, len(moments))
	for _, m := range moments {
		ids = append(ids, m.ID)
	}
	tagsByMoment, err := h.loadTagsByMoment(ids)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load moment tags")
	}

	resp := make([]momentResponse, 0, len(moments))
	for i := range moments {
		resp = append(resp, h.toMomentResponse(&moments[i], tagsByMoment[moments[i].ID]))
	}
	return c.JSON(http.StatusOK, resp)
}

// ─── Create ─────────────────────────────────────────────────────────────────

type createMomentRequest struct {
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	StartSeconds float64 `json:"startSeconds"`
	EndSeconds   float64 `json:"endSeconds"`
}

func (h *MomentHandler) Create(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	fileID, err := uuid.Parse(c.Param("fileId"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid file ID")
	}

	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Unauthorized")
	}

	var req createMomentRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if req.EndSeconds <= req.StartSeconds {
		return echo.NewHTTPError(http.StatusBadRequest, "endSeconds must be greater than startSeconds")
	}
	if req.StartSeconds < 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "startSeconds must be non-negative")
	}

	// Confirm the file exists and belongs to the library.
	var file models.File
	if err := h.db.Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "File not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load file")
	}

	moment := models.Moment{
		FileID:        fileID,
		LibraryID:     libraryID,
		CreatedByID:   userID,
		Name:          req.Name,
		Description:   req.Description,
		StartSeconds:  req.StartSeconds,
		EndSeconds:    req.EndSeconds,
		ExportVersion: 1,
	}
	if err := h.db.Create(&moment).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create moment")
	}

	aid := userID
	emitActivity(h.activitySvc, activity.EmitParams{
		LibraryID:   libraryID,
		ActorID:     &aid,
		Action:      activity.ActionMomentCreated,
		SubjectType: activity.SubjectMoment,
		SubjectID:   &moment.ID,
		Metadata: map[string]any{
			"name":         moment.Name,
			"fileId":       file.ID.String(),
			"fileName":     file.Name,
			"startSeconds": moment.StartSeconds,
			"endSeconds":   moment.EndSeconds,
		},
	})

	return c.JSON(http.StatusCreated, h.toMomentResponse(&moment, nil))
}

// ─── Get ────────────────────────────────────────────────────────────────────

func (h *MomentHandler) Get(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}

	tagsByMoment, _ := h.loadTagsByMoment([]uuid.UUID{moment.ID})
	return c.JSON(http.StatusOK, h.toMomentResponse(moment, tagsByMoment[moment.ID]))
}

// ─── Update ─────────────────────────────────────────────────────────────────

type updateMomentRequest struct {
	Name         *string  `json:"name"`
	Description  *string  `json:"description"`
	StartSeconds *float64 `json:"startSeconds"`
	EndSeconds   *float64 `json:"endSeconds"`
}

func (h *MomentHandler) Update(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}

	var req updateMomentRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}

	rangeChanged := false
	nextStart := moment.StartSeconds
	nextEnd := moment.EndSeconds
	if req.StartSeconds != nil {
		nextStart = *req.StartSeconds
		rangeChanged = rangeChanged || nextStart != moment.StartSeconds
	}
	if req.EndSeconds != nil {
		nextEnd = *req.EndSeconds
		rangeChanged = rangeChanged || nextEnd != moment.EndSeconds
	}
	if rangeChanged {
		if nextEnd <= nextStart {
			return echo.NewHTTPError(http.StatusBadRequest, "endSeconds must be greater than startSeconds")
		}
		if nextStart < 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "startSeconds must be non-negative")
		}
		updates["start_seconds"] = nextStart
		updates["end_seconds"] = nextEnd
		// Range changed — bump export version + reset status + drop cache.
		updates["export_version"] = moment.ExportVersion + 1
		updates["export_status"] = nil
		updates["export_progress"] = nil
		updates["export_eta_seconds"] = nil
		updates["exported_version"] = nil
		if h.storage != nil {
			_ = h.storage.DeleteCachePrefix(momentexport.CachePrefix(moment.LibraryID.String(), moment.ID.String()))
		}
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}

	if err := h.db.Model(&models.Moment{}).Where("id = ?", moment.ID).Updates(updates).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to update moment")
	}

	// Reload with fresh values.
	if err := h.db.Where("id = ?", moment.ID).First(moment).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to reload moment")
	}

	tagsByMoment, _ := h.loadTagsByMoment([]uuid.UUID{moment.ID})
	return c.JSON(http.StatusOK, h.toMomentResponse(moment, tagsByMoment[moment.ID]))
}

// ─── Delete ─────────────────────────────────────────────────────────────────

func (h *MomentHandler) Delete(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}

	now := time.Now()
	if err := h.db.Model(&models.Moment{}).Where("id = ?", moment.ID).
		Update("trashed_at", &now).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to delete moment")
	}
	return c.NoContent(http.StatusNoContent)
}

// ─── Tag sync ───────────────────────────────────────────────────────────────

type syncMomentTagsRequest struct {
	TagIDs []string `json:"tagIds"`
}

func (h *MomentHandler) SyncTags(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}

	var req syncMomentTagsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	// Validate tag IDs and ensure they all belong to the same library.
	tagIDs := make([]uuid.UUID, 0, len(req.TagIDs))
	for _, s := range req.TagIDs {
		id, err := uuid.Parse(s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid tag ID")
		}
		tagIDs = append(tagIDs, id)
	}

	if len(tagIDs) > 0 {
		var count int64
		if err := h.db.Model(&models.Tag{}).
			Where("id IN ? AND library_id = ?", tagIDs, moment.LibraryID).
			Count(&count).Error; err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to validate tags")
		}
		if int(count) != len(tagIDs) {
			return echo.NewHTTPError(http.StatusBadRequest, "One or more tags do not belong to this library")
		}
	}

	// Replace all tags for this moment atomically.
	tx := h.db.Begin()
	if err := tx.Where("moment_id = ?", moment.ID).Delete(&models.MomentTag{}).Error; err != nil {
		tx.Rollback()
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to clear existing tags")
	}
	for _, id := range tagIDs {
		mt := models.MomentTag{MomentID: moment.ID, TagID: id}
		if err := tx.Create(&mt).Error; err != nil {
			tx.Rollback()
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to attach tag")
		}
	}
	if err := tx.Commit().Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to commit tag changes")
	}

	tagsByMoment, _ := h.loadTagsByMoment([]uuid.UUID{moment.ID})
	return c.JSON(http.StatusOK, h.toMomentResponse(moment, tagsByMoment[moment.ID]))
}

// ─── Export ─────────────────────────────────────────────────────────────────

func (h *MomentHandler) Export(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}

	// Skip enqueue if cache is already ready for the current version.
	if moment.ExportedVersion != nil && *moment.ExportedVersion == moment.ExportVersion {
		tagsByMoment, _ := h.loadTagsByMoment([]uuid.UUID{moment.ID})
		return c.JSON(http.StatusOK, h.toMomentResponse(moment, tagsByMoment[moment.ID]))
	}

	// Mark queued immediately for responsive UI.
	queued := "queued"
	zero := 0
	now := time.Now()
	if err := h.db.Model(&models.Moment{}).Where("id = ?", moment.ID).Updates(map[string]interface{}{
		"export_status":   &queued,
		"export_progress": &zero,
		"updated_at":      now,
	}).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to update export status")
	}

	if h.momentExport != nil {
		if err := h.momentExport.Enqueue(
			moment.LibraryID.String(),
			moment.FileID.String(),
			moment.ID.String(),
		); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to enqueue export")
		}
	}

	// Reload for response freshness.
	_ = h.db.Where("id = ?", moment.ID).First(moment).Error
	tagsByMoment, _ := h.loadTagsByMoment([]uuid.UUID{moment.ID})
	return c.JSON(http.StatusAccepted, h.toMomentResponse(moment, tagsByMoment[moment.ID]))
}

// ─── Download ───────────────────────────────────────────────────────────────

func (h *MomentHandler) Download(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}
	if moment.ExportedVersion == nil || moment.ExportStatus == nil || *moment.ExportStatus != "ready" {
		return echo.NewHTTPError(http.StatusNotFound, "Moment export not ready")
	}

	cacheKey := momentexport.CacheKey(moment.LibraryID.String(), moment.ID.String(), *moment.ExportedVersion)
	size, err := h.storage.CacheStat(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Export file missing")
	}

	c.Response().Header().Set("Accept-Ranges", "bytes")
	c.Response().Header().Set("Content-Type", "video/mp4")
	c.Response().Header().Set("Cache-Control", "private, max-age=3600")
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.mp4"`, safeFilename(moment.Name)))

	rangeHeader := c.Request().Header.Get("Range")
	if rangeHeader == "" {
		c.Response().Header().Set("Content-Length", strconv.FormatInt(size, 10))
		reader, err := h.storage.OpenCacheReadStream(cacheKey)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read export")
		}
		defer reader.Close()
		c.Response().WriteHeader(http.StatusOK)
		_, _ = io.Copy(c.Response(), reader)
		return nil
	}

	matches := rangeRegex.FindStringSubmatch(rangeHeader)
	if matches == nil {
		return echo.NewHTTPError(http.StatusRequestedRangeNotSatisfiable, "Invalid range")
	}
	start, _ := strconv.ParseInt(matches[1], 10, 64)
	var end int64
	if matches[2] != "" {
		end, _ = strconv.ParseInt(matches[2], 10, 64)
	} else {
		end = size - 1
	}
	if start >= size {
		c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
		return c.NoContent(http.StatusRequestedRangeNotSatisfiable)
	}
	if end >= size {
		end = size - 1
	}
	length := end - start + 1
	reader, err := h.storage.OpenCacheReadStreamRange(cacheKey, &storage.ByteRange{Start: start, End: end})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read range")
	}
	defer reader.Close()
	c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
	c.Response().Header().Set("Content-Length", strconv.FormatInt(length, 10))
	c.Response().WriteHeader(http.StatusPartialContent)
	_, _ = io.Copy(c.Response(), reader)
	return nil
}

func safeFilename(name string) string {
	if name == "" {
		return "moment"
	}
	// Strip characters that make filenames unhappy.
	bad := []rune{'/', '\\', '"', '\'', '\n', '\r'}
	out := []rune(name)
	for i, r := range out {
		for _, b := range bad {
			if r == b {
				out[i] = '_'
				break
			}
		}
	}
	return string(out)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func (h *MomentHandler) loadMoment(c echo.Context) (*models.Moment, error) {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	fileID, err := uuid.Parse(c.Param("fileId"))
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid file ID")
	}
	momentID, err := uuid.Parse(c.Param("momentId"))
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid moment ID")
	}

	var moment models.Moment
	if err := h.db.
		Where("id = ? AND library_id = ? AND file_id = ? AND trashed_at IS NULL",
			momentID, libraryID, fileID).
		First(&moment).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, echo.NewHTTPError(http.StatusNotFound, "Moment not found")
		}
		return nil, echo.NewHTTPError(http.StatusInternalServerError, "Failed to load moment")
	}
	return &moment, nil
}
