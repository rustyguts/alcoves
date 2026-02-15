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
	c.Bind(&req) // ignore error — body may be empty for purge-all

	var filesToPurge []models.File
	purgedCount := 0

	if len(req.FileIDs) > 0 {
		// Purge specific files
		h.db.Where("id IN ? AND library_id = ? AND trashed_at IS NOT NULL", req.FileIDs, libraryID).Find(&filesToPurge)
	} else if len(req.FolderIDs) > 0 {
		// Purge specific folders and all their descendants' files
		allFolderIDs := make([]string, 0)
		for _, fid := range req.FolderIDs {
			allFolderIDs = append(allFolderIDs, fid)
			allFolderIDs = append(allFolderIDs, h.getDescendantFolderIDs(libraryID, fid)...)
		}
		// Purge files in those folders
		h.db.Where("parent_folder_id IN ? AND library_id = ?", allFolderIDs, libraryID).Find(&filesToPurge)
		// Also delete the folders themselves
		h.db.Where("id IN ? AND library_id = ?", req.FolderIDs, libraryID).Delete(&models.Folder{})
		// Delete descendant folders
		for _, fid := range req.FolderIDs {
			descs := h.getDescendantFolderIDs(libraryID, fid)
			if len(descs) > 0 {
				h.db.Where("id IN ?", descs).Delete(&models.Folder{})
			}
		}
	} else {
		// Purge all trashed files
		h.db.Where("library_id = ? AND trashed_at IS NOT NULL", libraryID).Find(&filesToPurge)
		// Also purge all trashed folders
		h.db.Where("library_id = ? AND trashed_at IS NOT NULL", libraryID).Delete(&models.Folder{})
	}

	purgedFileIDs := make([]string, 0, len(filesToPurge))
	for _, f := range filesToPurge {
		h.storageSvc.DeleteFile(libraryID, f.ID.String())
		h.db.Delete(&f)
		purgedFileIDs = append(purgedFileIDs, f.ID.String())
		purgedCount++
	}

	// Clean up face data for purged files
	if len(purgedFileIDs) > 0 && h.faceSvc != nil {
		if err := h.faceSvc.DeleteFaceDataForFiles(libraryID, purgedFileIDs); err != nil {
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

		var children []struct{ ID string `gorm:"column:id"` }
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

func (h *FileHandler) Proxy(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var file models.File
	if err := h.db.Select("id, mime_type, proxy_status, name").
		Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	if file.ProxyStatus != nil && *file.ProxyStatus == "not_needed" {
		return c.Redirect(http.StatusFound, fmt.Sprintf("/api/libraries/%s/files/%s?inline=true", libraryID, fileID))
	}

	if file.ProxyStatus == nil || *file.ProxyStatus != "ready" {
		msg := "No proxy available"
		if file.ProxyStatus != nil && *file.ProxyStatus == "processing" {
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
	if err := h.db.Select("id").Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
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
		"id":             f.ID.String(),
		"libraryId":      f.LibraryID.String(),
		"parentFolderId": uuidPtr(f.ParentFolderID),
		"name":           f.Name,
		"kind":           "file",
		"mimeType":       f.MimeType,
		"size":           f.Size,
		"duration":       f.Duration,
		"width":          f.Width,
		"height":         f.Height,
		"proxyStatus":    f.ProxyStatus,
		"sourceFileId":   uuidPtr(f.SourceFileID),
		"trashedAt":      timeStr(f.TrashedAt),
		"createdAt":      f.CreatedAt.Format(time.RFC3339Nano),
		"updatedAt":      f.UpdatedAt.Format(time.RFC3339Nano),
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
	if err := h.videoSvc.EnqueueVideoProxy(libraryID.String(), fileID.String()); err != nil {
		log.Printf("failed to enqueue video proxy for file %s: %v", fileID, err)
	}
}

// Ensure errors import is used (for future use)
var _ = errors.New
