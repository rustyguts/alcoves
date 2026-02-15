package handlers

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

type DownloadHandler struct {
	db         *gorm.DB
	storageSvc *storage.Service
}

func NewDownloadHandler(db *gorm.DB, storageSvc *storage.Service) *DownloadHandler {
	return &DownloadHandler{db: db, storageSvc: storageSvc}
}

func (h *DownloadHandler) RegisterRoutes(g *echo.Group) {
	g.POST("/:id/download-estimate", h.Estimate)
	g.POST("/:id/download", h.Download)
}

type downloadEstimateRequest struct {
	FileIDs   []string `json:"fileIds"`
	FolderIDs []string `json:"folderIds"`
}

func (h *DownloadHandler) Estimate(c echo.Context) error {
	libraryID := c.Param("id")

	var req downloadEstimateRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	var totalSize int64
	var fileCount int64

	if len(req.FileIDs) > 0 {
		h.db.Model(&models.File{}).
			Where("id IN ? AND library_id = ? AND trashed_at IS NULL", req.FileIDs, libraryID).
			Select("COALESCE(SUM(size), 0)").Scan(&totalSize)
		h.db.Model(&models.File{}).
			Where("id IN ? AND library_id = ? AND trashed_at IS NULL", req.FileIDs, libraryID).
			Count(&fileCount)
	}

	if len(req.FolderIDs) > 0 {
		// Include files in folders and their descendants
		for _, fid := range req.FolderIDs {
			allIDs := []string{fid}
			allIDs = append(allIDs, getDescendants(h.db, libraryID, fid)...)

			var folderSize int64
			var folderFiles int64
			h.db.Model(&models.File{}).
				Where("parent_folder_id IN ? AND library_id = ? AND trashed_at IS NULL", allIDs, libraryID).
				Select("COALESCE(SUM(size), 0)").Scan(&folderSize)
			h.db.Model(&models.File{}).
				Where("parent_folder_id IN ? AND library_id = ? AND trashed_at IS NULL", allIDs, libraryID).
				Count(&folderFiles)
			totalSize += folderSize
			fileCount += folderFiles
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"totalSize": totalSize,
		"fileCount": fileCount,
	})
}

type downloadRequest struct {
	FileIDs   []string `json:"fileIds"`
	FolderIDs []string `json:"folderIds"`
}

func (h *DownloadHandler) Download(c echo.Context) error {
	libraryID := c.Param("id")

	var req downloadRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	// Collect all files to download
	var filesToDownload []models.File

	if len(req.FileIDs) > 0 {
		h.db.Where("id IN ? AND library_id = ? AND trashed_at IS NULL", req.FileIDs, libraryID).
			Find(&filesToDownload)
	}

	if len(req.FolderIDs) > 0 {
		for _, fid := range req.FolderIDs {
			allIDs := []string{fid}
			allIDs = append(allIDs, getDescendants(h.db, libraryID, fid)...)

			var folderFiles []models.File
			h.db.Where("parent_folder_id IN ? AND library_id = ? AND trashed_at IS NULL", allIDs, libraryID).
				Find(&folderFiles)
			filesToDownload = append(filesToDownload, folderFiles...)
		}
	}

	if len(filesToDownload) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No files to download")
	}

	// Stream as zip
	c.Response().Header().Set("Content-Type", "application/zip")
	c.Response().Header().Set("Content-Disposition", "attachment; filename=\"download.zip\"")
	c.Response().WriteHeader(http.StatusOK)

	zipWriter := zip.NewWriter(c.Response())
	defer zipWriter.Close()

	for _, file := range filesToDownload {
		reader, err := h.storageSvc.OpenFileReadStream(libraryID, file.ID.String(), nil)
		if err != nil {
			continue // skip files that can't be read
		}

		w, err := zipWriter.Create(file.Name)
		if err != nil {
			reader.Close()
			continue
		}

		io.Copy(w, reader)
		reader.Close()
	}

	return nil
}

// Public file proxy handler
type FileProxyHandler struct {
	db         *gorm.DB
	storageSvc *storage.Service
}

func NewFileProxyHandler(db *gorm.DB, storageSvc *storage.Service) *FileProxyHandler {
	return &FileProxyHandler{db: db, storageSvc: storageSvc}
}

func (h *FileProxyHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/proxy/*", h.Serve)
}

func (h *FileProxyHandler) Serve(c echo.Context) error {
	// Path format: /api/files/proxy/{libraryId}/{fileId}/{filename}
	path := c.Param("*")
	if path == "" {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	// Parse path components
	// Expected: libraryId/fileId/filename
	var libraryID, fileID string
	n, _ := fmt.Sscanf(path, "%36s/%36s/", &libraryID, &fileID)
	if n < 2 {
		return echo.NewHTTPError(http.StatusNotFound, "Invalid path")
	}

	var file models.File
	if err := h.db.Select("id, name, mime_type, size").
		Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	size, err := h.storageSvc.FileStat(libraryID, fileID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found on storage")
	}

	reader, err := h.storageSvc.OpenFileReadStream(libraryID, fileID, nil)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read file")
	}
	defer reader.Close()

	c.Response().Header().Set("Content-Type", file.MimeType)
	c.Response().Header().Set("Content-Length", fmt.Sprintf("%d", size))
	c.Response().Header().Set("Cache-Control", "public, max-age=31536000")

	return c.Stream(http.StatusOK, file.MimeType, reader)
}

func getDescendants(db *gorm.DB, libraryID, rootID string) []string {
	var descendants []string
	visited := map[string]bool{}
	queue := []string{rootID}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if visited[cur] {
			continue
		}
		visited[cur] = true

		var children []struct{ ID string `gorm:"column:id"` }
		db.Raw("SELECT id FROM folders WHERE library_id = ? AND parent_folder_id = ? AND trashed_at IS NULL", libraryID, cur).Scan(&children)
		for _, ch := range children {
			descendants = append(descendants, ch.ID)
			queue = append(queue, ch.ID)
		}
	}
	return descendants
}
