package handlers

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
)

type FileHandler struct {
	db         *gorm.DB
	fileSvc    *files.Service
	storageSvc *storage.Service
	faceSvc    *facedetection.Service
	videoSvc   *videoproxy.Service
}

func NewFileHandler(db *gorm.DB, fileSvc *files.Service, storageSvc *storage.Service, faceSvc *facedetection.Service, videoSvc *videoproxy.Service) *FileHandler {
	return &FileHandler{db: db, fileSvc: fileSvc, storageSvc: storageSvc, faceSvc: faceSvc, videoSvc: videoSvc}
}

func (h *FileHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/files", h.List)
	g.POST("/:id/files", h.Upload)
	g.GET("/:id/files/:fileId", h.Get)
	g.PATCH("/:id/files/:fileId", h.Update)
	g.DELETE("/:id/files/:fileId", h.Delete)
	g.GET("/:id/files/:fileId/playback-sources", h.PlaybackSources)
	g.POST("/:id/files/:fileId/proxy", h.GenerateProxy)
	g.POST("/:id/files/video-thumbnails/reprocess", h.ReprocessVideoThumbnails)
	g.GET("/:id/files/:fileId/proxy", h.Proxy)
	g.GET("/:id/files/:fileId/thumbnail", h.Thumbnail)
	g.POST("/:id/files/purge", h.Purge)
	g.POST("/:id/files/restore", h.Restore)
}

func (h *FileHandler) List(c echo.Context) error {
	libraryID := c.Param("id")
	result, err := h.fileSvc.ListLibraryFiles(libraryID, c)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, result)
}

func (h *FileHandler) Upload(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	// Original uses streaming body with X-Upload-* headers
	fileName := c.Request().Header.Get("X-Upload-Name")
	if fileName == "" {
		fileName = "unnamed"
	}
	mimeType := c.Request().Header.Get("X-Upload-Mime-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// Get optional parent folder from header
	var parentFolderID *uuid.UUID
	folderIDStr := c.Request().Header.Get("X-Upload-Folder-Id")
	if folderIDStr != "" && folderIDStr != "null" {
		parsed, err := uuid.Parse(folderIDStr)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid folder ID")
		}
		parentFolderID = &parsed
	}

	fileID := uuid.New()

	// Stream body directly to storage
	bytesWritten, err := h.storageSvc.StoreFileStream(libraryID.String(), fileID.String(), c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to store file")
	}

	file := models.File{
		ID:             fileID,
		LibraryID:      libraryID,
		ParentFolderID: parentFolderID,
		Name:           fileName,
		MimeType:       mimeType,
		Size:           bytesWritten,
		OwnerID:        &userID,
	}

	if err := h.db.Create(&file).Error; err != nil {
		// Clean up storage on DB failure
		h.storageSvc.DeleteFile(libraryID.String(), fileID.String())
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create file record")
	}

	// Trigger face detection if library has it enabled and file is an image
	h.maybeEnqueueFaceDetection(libraryID, fileID, mimeType)

	// Trigger video proxy generation for video files
	h.maybeEnqueueVideoProxy(libraryID, fileID, mimeType)
	h.maybeEnqueueVideoThumbnail(libraryID, fileID, mimeType)

	return c.JSON(http.StatusOK, fileToJSON(&file))
}

func (h *FileHandler) Get(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var file models.File
	if err := h.db.Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	// If ?inline=true, serve the actual file data
	inline := c.QueryParam("inline") == "true"
	if inline {
		return h.serveFileData(c, &file)
	}

	// Otherwise return metadata
	return c.JSON(http.StatusOK, fileToJSON(&file))
}

func (h *FileHandler) serveFileData(c echo.Context, file *models.File) error {
	libraryID := file.LibraryID.String()
	fileID := file.ID.String()

	size, err := h.storageSvc.FileStat(libraryID, fileID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found on storage")
	}

	c.Response().Header().Set("Content-Type", file.MimeType)
	c.Response().Header().Set("Accept-Ranges", "bytes")
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, file.Name))

	rangeHeader := c.Request().Header.Get("Range")
	if rangeHeader != "" {
		return h.serveRangeRequest(c, libraryID, fileID, size, rangeHeader)
	}

	reader, err := h.storageSvc.OpenFileReadStream(libraryID, fileID, nil)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read file")
	}
	defer reader.Close()

	c.Response().Header().Set("Content-Length", strconv.FormatInt(size, 10))
	return c.Stream(http.StatusOK, file.MimeType, reader)
}

var rangeRegex = regexp.MustCompile(`bytes=(\d+)-(\d*)`)

func (h *FileHandler) serveRangeRequest(c echo.Context, libraryID, fileID string, totalSize int64, rangeHeader string) error {
	matches := rangeRegex.FindStringSubmatch(rangeHeader)
	if matches == nil {
		return echo.NewHTTPError(http.StatusRequestedRangeNotSatisfiable, "Invalid range")
	}

	start, _ := strconv.ParseInt(matches[1], 10, 64)
	var end int64
	if matches[2] != "" {
		end, _ = strconv.ParseInt(matches[2], 10, 64)
	} else {
		end = totalSize - 1
	}

	if start >= totalSize {
		c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes */%d", totalSize))
		return c.NoContent(http.StatusRequestedRangeNotSatisfiable)
	}

	if end >= totalSize {
		end = totalSize - 1
	}

	length := end - start + 1
	reader, err := h.storageSvc.OpenFileReadStream(libraryID, fileID, &storage.ByteRange{Start: start, End: end})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read file")
	}
	defer reader.Close()

	c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, totalSize))
	c.Response().Header().Set("Content-Length", strconv.FormatInt(length, 10))
	c.Response().WriteHeader(http.StatusPartialContent)
	io.Copy(c.Response(), reader)
	return nil
}

type updateFileRequest struct {
	Name           *string `json:"name"`
	ParentFolderID *string `json:"parentFolderId"`
}

func (h *FileHandler) Update(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var req updateFileRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.ParentFolderID != nil {
		if *req.ParentFolderID == "" || *req.ParentFolderID == "null" {
			updates["parent_folder_id"] = nil
		} else {
			updates["parent_folder_id"] = *req.ParentFolderID
		}
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}

	updates["updated_at"] = time.Now()

	if err := h.db.Model(&models.File{}).Where("id = ? AND library_id = ?", fileID, libraryID).Updates(updates).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to update file")
	}

	var file models.File
	h.db.Where("id = ? AND library_id = ?", fileID, libraryID).First(&file)

	return c.JSON(http.StatusOK, fileToJSON(&file))
}

type deleteFileRequest struct {
	FileIDs []string `json:"fileIds"`
}

func (h *FileHandler) Delete(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	now := time.Now()

	// Check for bulk delete via body
	var req deleteFileRequest
	c.Bind(&req) // ignore error — body is optional

	if len(req.FileIDs) > 0 {
		// Bulk soft-delete
		result := h.db.Model(&models.File{}).
			Where("id IN ? AND library_id = ? AND trashed_at IS NULL", req.FileIDs, libraryID).
			Updates(map[string]interface{}{"trashed_at": now, "updated_at": now})
		return c.JSON(http.StatusOK, map[string]int64{"trashed": result.RowsAffected})
	}

	// Single file soft-delete
	result := h.db.Model(&models.File{}).
		Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).
		Updates(map[string]interface{}{"trashed_at": now, "updated_at": now})

	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	return c.JSON(http.StatusOK, map[string]int64{"trashed": result.RowsAffected})
}

type purgeRequest struct {
	FileIDs   []string `json:"fileIds"`
	FolderIDs []string `json:"folderIds"`
}

func (h *FileHandler) Purge(c echo.Context) error {
	libraryID := c.Param("id")

	var req purgeRequest
	if err := c.Bind(&req); err != nil && !errors.Is(err, io.EOF) {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	var filesToPurge []models.File
	var folderIDsToPurge []string

	if len(req.FileIDs) > 0 {
		// Purge specific files — must be trashed
		if err := h.db.Where("id IN ? AND library_id = ? AND trashed_at IS NOT NULL", req.FileIDs, libraryID).Find(&filesToPurge).Error; err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load files for purge")
		}
	} else if len(req.FolderIDs) > 0 {
		// Purge specific trashed folders and their descendants
		allFolderSet := make(map[string]struct{})
		for _, fid := range req.FolderIDs {
			allFolderSet[fid] = struct{}{}
			for _, descendantID := range h.getDescendantFolderIDs(libraryID, fid) {
				allFolderSet[descendantID] = struct{}{}
			}
		}
		for id := range allFolderSet {
			folderIDsToPurge = append(folderIDsToPurge, id)
		}

		if len(folderIDsToPurge) > 0 {
			if err := h.db.Where("parent_folder_id IN ? AND library_id = ? AND trashed_at IS NOT NULL", folderIDsToPurge, libraryID).Find(&filesToPurge).Error; err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load folder files for purge")
			}
		}
	} else {
		// Purge all trashed items in the library
		if err := h.db.Where("library_id = ? AND trashed_at IS NOT NULL", libraryID).Find(&filesToPurge).Error; err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load files for purge")
		}
		var trashedFolders []models.Folder
		if err := h.db.Select("id").Where("library_id = ? AND trashed_at IS NOT NULL", libraryID).Find(&trashedFolders).Error; err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load folders for purge")
		}
		for _, folder := range trashedFolders {
			folderIDsToPurge = append(folderIDsToPurge, folder.ID.String())
		}
	}

	// Delete original files from disk first, before touching the DB.
	// If any storage delete fails we stop early and leave the DB intact.
	for _, f := range filesToPurge {
		if err := h.storageSvc.DeleteFileBlob(f.LibraryID.String(), f.ID.String()); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to delete file from disk")
		}
	}

	// Collect IDs for the DB cleanup.
	fileIDs := make([]string, 0, len(filesToPurge))
	for _, f := range filesToPurge {
		fileIDs = append(fileIDs, f.ID.String())
	}

	purgedCount := 0

	// All DB mutations inside a transaction.
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if len(fileIDs) > 0 {
			// Remove file-tag associations
			if err := tx.Where("file_id IN ?", fileIDs).Delete(&models.FileTag{}).Error; err != nil {
				return fmt.Errorf("failed to delete file tags: %w", err)
			}

			// Clear source_file_id references so proxy rows don't have dangling FKs
			if err := tx.Model(&models.File{}).Where("source_file_id IN ?", fileIDs).
				Update("source_file_id", nil).Error; err != nil {
				return fmt.Errorf("failed to clear source file references: %w", err)
			}

			// Delete the file records
			result := tx.Where("id IN ? AND library_id = ?", fileIDs, libraryID).Delete(&models.File{})
			if result.Error != nil {
				return fmt.Errorf("failed to delete files: %w", result.Error)
			}
			purgedCount += int(result.RowsAffected)
		}

		if len(folderIDsToPurge) > 0 {
			// Remove folder-tag associations
			if err := tx.Where("folder_id IN ?", folderIDsToPurge).Delete(&models.FolderTag{}).Error; err != nil {
				return fmt.Errorf("failed to delete folder tags: %w", err)
			}

			result := tx.Where("id IN ? AND library_id = ?", folderIDsToPurge, libraryID).Delete(&models.Folder{})
			if result.Error != nil {
				return fmt.Errorf("failed to delete folders: %w", result.Error)
			}
			purgedCount += int(result.RowsAffected)
		}

		return nil
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to purge items")
	}

	// Clean up face data for purged files (best-effort, outside transaction).
	if len(fileIDs) > 0 && h.faceSvc != nil {
		if err := h.faceSvc.DeleteFaceDataForFiles(libraryID, fileIDs); err != nil {
			log.Printf("failed to clean face data for purged files: %v", err)
		}
	}

	return c.JSON(http.StatusOK, map[string]int{"purged": purgedCount})
}

func (h *FileHandler) getDescendantFolderIDs(libraryID, rootFolderID string) []string {
	var descendants []string
	visited := map[string]bool{}
	queue := []string{rootFolderID}

	for len(queue) > 0 {
		currentID := queue[0]
		queue = queue[1:]
		if visited[currentID] {
			continue
		}
		visited[currentID] = true

		var children []struct {
			ID string `gorm:"column:id"`
		}
		h.db.Raw("SELECT id FROM folders WHERE library_id = ? AND parent_folder_id = ?", libraryID, currentID).Scan(&children)
		for _, child := range children {
			descendants = append(descendants, child.ID)
			queue = append(queue, child.ID)
		}
	}
	return descendants
}

type restoreRequest struct {
	FileIDs []string `json:"fileIds" validate:"required"`
}

func (h *FileHandler) Restore(c echo.Context) error {
	libraryID := c.Param("id")

	var req restoreRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if len(req.FileIDs) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "fileIds is required")
	}

	result := h.db.Model(&models.File{}).
		Where("id IN ? AND library_id = ? AND trashed_at IS NOT NULL", req.FileIDs, libraryID).
		Updates(map[string]interface{}{
			"trashed_at":       nil,
			"parent_folder_id": nil, // Restore to root
			"updated_at":       time.Now(),
		})

	return c.JSON(http.StatusOK, map[string]int64{"restored": result.RowsAffected})
}

func (h *FileHandler) ReprocessVideoThumbnails(c echo.Context) error {
	if h.videoSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Video service unavailable")
	}

	la := middleware.GetLibraryAccess(c)
	if la == nil || !la.IsOwner {
		return echo.NewHTTPError(http.StatusForbidden, "Only the library owner can regenerate video thumbnails")
	}

	libraryID := c.Param("id")
	queuedCount, err := h.videoSvc.EnqueueExistingVideoThumbnails(libraryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to queue video thumbnails")
	}

	return c.JSON(http.StatusOK, map[string]int{"queuedCount": queuedCount})
}

type playbackSourceResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MimeType  string `json:"mimeType"`
	Kind      string `json:"kind"`
	StreamURL string `json:"streamUrl"`
	CreatedAt string `json:"createdAt"`
}

type playbackSourcesResponse struct {
	DefaultSourceID string                   `json:"defaultSourceId"`
	Sources         []playbackSourceResponse `json:"sources"`
}

func (h *FileHandler) PlaybackSources(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var selected models.File
	if err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&selected).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	if !strings.HasPrefix(selected.MimeType, "video/") {
		return echo.NewHTTPError(http.StatusBadRequest, "Playback sources are only available for video files")
	}

	sourceID := selected.ID
	if selected.SourceFileID != nil {
		sourceID = *selected.SourceFileID
	}

	var source models.File
	if err := h.db.Where("id = ? AND library_id = ?", sourceID, libraryID).First(&source).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Source file not found")
	}

	var proxies []models.File
	if err := h.db.
		Where("source_file_id = ? AND library_id = ? AND trashed_at IS NULL AND mime_type LIKE ?", sourceID, libraryID, "video/%").
		Order("created_at DESC").
		Find(&proxies).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load playback sources")
	}

	defaultSourceID := source.ID.String()
	if source.ProxyStatus != nil && *source.ProxyStatus == "ready" && len(proxies) > 0 {
		defaultSourceID = proxies[0].ID.String()
	}

	sources := make([]playbackSourceResponse, 0, len(proxies)+1)
	sources = append(sources, playbackSourceResponse{
		ID:        source.ID.String(),
		Name:      source.Name,
		MimeType:  source.MimeType,
		Kind:      "source",
		StreamURL: fmt.Sprintf("/api/libraries/%s/files/%s?inline=true", libraryID, source.ID.String()),
		CreatedAt: source.CreatedAt.Format(time.RFC3339Nano),
	})
	for _, proxy := range proxies {
		sources = append(sources, playbackSourceResponse{
			ID:        proxy.ID.String(),
			Name:      proxy.Name,
			MimeType:  proxy.MimeType,
			Kind:      "proxy",
			StreamURL: fmt.Sprintf("/api/libraries/%s/files/%s?inline=true", libraryID, proxy.ID.String()),
			CreatedAt: proxy.CreatedAt.Format(time.RFC3339Nano),
		})
	}

	if len(proxies) == 0 && source.ProxyStatus != nil && *source.ProxyStatus == "ready" {
		cacheKey := fmt.Sprintf("%s/%s/proxy.mp4", libraryID, source.ID.String())
		if exists, _ := h.storageSvc.CacheExists(cacheKey); exists {
			defaultSourceID = source.ID.String() + "::legacy-proxy"
			sources = append(sources, playbackSourceResponse{
				ID:        defaultSourceID,
				Name:      "Legacy Proxy",
				MimeType:  "video/mp4",
				Kind:      "proxy",
				StreamURL: fmt.Sprintf("/api/libraries/%s/files/%s/proxy", libraryID, source.ID.String()),
				CreatedAt: source.UpdatedAt.Format(time.RFC3339Nano),
			})
		}
	}

	return c.JSON(http.StatusOK, playbackSourcesResponse{DefaultSourceID: defaultSourceID, Sources: sources})
}

func (h *FileHandler) GenerateProxy(c echo.Context) error {
	if h.videoSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Video proxy service unavailable")
	}

	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var file models.File
	if err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	if !strings.HasPrefix(file.MimeType, "video/") {
		return echo.NewHTTPError(http.StatusBadRequest, "File is not a video")
	}
	if file.SourceFileID != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot generate proxy for proxy file")
	}

	now := time.Now()
	if err := h.db.Model(&models.File{}).
		Where("source_file_id = ? AND library_id = ? AND trashed_at IS NULL", file.ID, libraryID).
		Updates(map[string]interface{}{"trashed_at": now, "updated_at": now}).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to expire previous proxies")
	}

	queued := "queued"
	zero := 0
	if err := h.db.Model(&models.File{}).
		Where("id = ?", file.ID).
		Updates(map[string]interface{}{
			"proxy_status":      queued,
			"proxy_progress":    zero,
			"proxy_eta_seconds": nil,
			"updated_at":        now,
		}).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to update file proxy status")
	}

	if err := h.videoSvc.EnqueueVideoProxy(libraryID, fileID, true); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to queue video proxy generation")
	}

	file.ProxyStatus = &queued
	file.ProxyProgress = &zero
	file.ProxyEtaSeconds = nil

	return c.JSON(http.StatusOK, fileToJSON(&file))
}

func (h *FileHandler) Proxy(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var file models.File
	if err := h.db.Select("id, mime_type, proxy_status, name, source_file_id").
		Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	if file.SourceFileID != nil {
		return c.Redirect(http.StatusFound, fmt.Sprintf("/api/libraries/%s/files/%s?inline=true", libraryID, file.ID.String()))
	}

	var proxyFile models.File
	err := h.db.Select("id, mime_type").
		Where("source_file_id = ? AND library_id = ? AND trashed_at IS NULL", file.ID, libraryID).
		Order("created_at DESC").
		First(&proxyFile).Error
	if err == nil {
		return c.Redirect(http.StatusFound, fmt.Sprintf("/api/libraries/%s/files/%s?inline=true", libraryID, proxyFile.ID.String()))
	}

	if file.ProxyStatus != nil && *file.ProxyStatus == "not_needed" {
		return c.Redirect(http.StatusFound, fmt.Sprintf("/api/libraries/%s/files/%s?inline=true", libraryID, fileID))
	}

	if file.ProxyStatus == nil || *file.ProxyStatus != "ready" {
		msg := "No proxy available"
		if file.ProxyStatus != nil && (*file.ProxyStatus == "processing" || *file.ProxyStatus == "queued") {
			msg = "Proxy is still processing"
		}
		return echo.NewHTTPError(http.StatusNotFound, msg)
	}

	cacheKey := fmt.Sprintf("%s/%s/proxy.mp4", libraryID, fileID)
	exists, _ := h.storageSvc.CacheExists(cacheKey)
	if !exists {
		return echo.NewHTTPError(http.StatusNotFound, "Proxy file not found")
	}

	data, err := h.storageSvc.ReadCacheBuffer(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read proxy")
	}

	c.Response().Header().Set("Content-Type", "video/mp4")
	c.Response().Header().Set("Accept-Ranges", "bytes")
	c.Response().Header().Set("Cache-Control", "private, max-age=3600")

	totalSize := int64(len(data))
	rangeHeader := c.Request().Header.Get("Range")
	if rangeHeader != "" {
		matches := rangeRegex.FindStringSubmatch(rangeHeader)
		if matches != nil {
			start, _ := strconv.ParseInt(matches[1], 10, 64)
			var end int64
			if matches[2] != "" {
				end, _ = strconv.ParseInt(matches[2], 10, 64)
			} else {
				end = totalSize - 1
			}

			if start >= totalSize {
				c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes */%d", totalSize))
				return c.NoContent(http.StatusRequestedRangeNotSatisfiable)
			}
			if end >= totalSize {
				end = totalSize - 1
			}

			c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, totalSize))
			c.Response().Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
			return c.Blob(http.StatusPartialContent, "video/mp4", data[start:end+1])
		}
	}

	c.Response().Header().Set("Content-Length", strconv.FormatInt(totalSize, 10))
	return c.Blob(http.StatusOK, "video/mp4", data)
}

func (h *FileHandler) Thumbnail(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	// Check file exists
	var file models.File
	if err := h.db.Select("id, thumbnail_file_id").Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	if file.ThumbnailFileID != nil {
		return c.Redirect(http.StatusFound, fmt.Sprintf("/api/libraries/%s/files/%s?inline=true", libraryID, file.ThumbnailFileID.String()))
	}

	cacheKey := fmt.Sprintf("%s/%s/thumbnail.webp", libraryID, fileID)
	exists, _ := h.storageSvc.CacheExists(cacheKey)
	if !exists {
		return echo.NewHTTPError(http.StatusNotFound, "Thumbnail not found")
	}

	data, err := h.storageSvc.ReadCacheBuffer(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read thumbnail")
	}

	c.Response().Header().Set("Cache-Control", "private, max-age=86400")
	return c.Blob(http.StatusOK, "image/webp", data)
}

func fileToJSON(f *models.File) map[string]interface{} {
	result := map[string]interface{}{
		"id":              f.ID.String(),
		"libraryId":       f.LibraryID.String(),
		"parentFolderId":  uuidPtr(f.ParentFolderID),
		"name":            f.Name,
		"kind":            "file",
		"mimeType":        f.MimeType,
		"size":            f.Size,
		"duration":        f.Duration,
		"width":           f.Width,
		"height":          f.Height,
		"proxyStatus":     f.ProxyStatus,
		"proxyProgress":   f.ProxyProgress,
		"proxyEtaSeconds": f.ProxyEtaSeconds,
		"thumbnailFileId": uuidPtr(f.ThumbnailFileID),
		"sourceFileId":    uuidPtr(f.SourceFileID),
		"trashedAt":       timeStr(f.TrashedAt),
		"createdAt":       f.CreatedAt.Format(time.RFC3339Nano),
		"updatedAt":       f.UpdatedAt.Format(time.RFC3339Nano),
	}
	if f.OriginalCreatedAt != nil {
		result["originalCreatedAt"] = f.OriginalCreatedAt.Format(time.RFC3339Nano)
	} else {
		result["originalCreatedAt"] = nil
	}
	return result
}

func uuidPtr(u *uuid.UUID) *string {
	if u == nil {
		return nil
	}
	s := u.String()
	return &s
}

func timeStr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339Nano)
	return &s
}

// maybeEnqueueFaceDetection triggers face detection if the library has it enabled
// and the file is an image.
func (h *FileHandler) maybeEnqueueFaceDetection(libraryID, fileID uuid.UUID, mimeType string) {
	if h.faceSvc == nil || !strings.HasPrefix(mimeType, "image/") {
		return
	}

	var library models.Library
	if err := h.db.Select("face_recognition_enabled").Where("id = ?", libraryID).First(&library).Error; err != nil {
		return
	}

	if library.FaceRecognitionEnabled {
		if err := h.faceSvc.EnqueueFaceDetection(libraryID.String(), fileID.String()); err != nil {
			log.Printf("failed to enqueue face detection for file %s: %v", fileID, err)
		}
	}
}

// maybeEnqueueVideoProxy triggers video proxy generation for video uploads.
func (h *FileHandler) maybeEnqueueVideoProxy(libraryID, fileID uuid.UUID, mimeType string) {
	if h.videoSvc == nil || !strings.HasPrefix(mimeType, "video/") {
		return
	}
	if !videoproxy.ShouldCreateProxyByDefault(mimeType) {
		notNeeded := "not_needed"
		h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
			"proxy_status":      notNeeded,
			"proxy_progress":    nil,
			"proxy_eta_seconds": nil,
		})
		return
	}

	queued := "queued"
	zero := 0
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"proxy_status":      queued,
		"proxy_progress":    zero,
		"proxy_eta_seconds": nil,
	})

	if err := h.videoSvc.EnqueueVideoProxy(libraryID.String(), fileID.String(), false); err != nil {
		log.Printf("failed to enqueue video proxy for file %s: %v", fileID, err)
	}
}

func (h *FileHandler) maybeEnqueueVideoThumbnail(libraryID, fileID uuid.UUID, mimeType string) {
	if h.videoSvc == nil || !strings.HasPrefix(mimeType, "video/") {
		return
	}

	if err := h.videoSvc.EnqueueVideoThumbnail(libraryID.String(), fileID.String()); err != nil {
		log.Printf("failed to enqueue video thumbnail for file %s: %v", fileID, err)
	}
}

// Ensure errors import is used (for future use)
var _ = errors.New
