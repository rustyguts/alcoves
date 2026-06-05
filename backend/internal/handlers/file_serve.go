package handlers

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

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

	selected, err := findActiveFile(h.db, libraryID, fileID)
	if err != nil {
		return err
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
		cacheKey := storage.ProxyKey(libraryID, source.ID.String())
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

func (h *FileHandler) GetWaveform(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	file, err := findActiveFile(h.db, libraryID, fileID)
	if err != nil {
		return err
	}
	if file.WaveformStatus == nil || *file.WaveformStatus != "ready" {
		return echo.NewHTTPError(http.StatusNotFound, "Waveform not ready")
	}

	cacheKey := storage.WaveformKey(libraryID, fileID)
	// Stream the waveform JSON without loading it fully into RAM.
	rc, err := h.storageSvc.OpenCacheReadStream(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Waveform data not found")
	}
	defer rc.Close()
	return c.Stream(http.StatusOK, "application/json", rc)
}

func (h *FileHandler) GetTranscript(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	file, err := findActiveFile(h.db, libraryID, fileID)
	if err != nil {
		return err
	}
	if file.TranscribeStatus == nil || *file.TranscribeStatus != "ready" {
		return echo.NewHTTPError(http.StatusNotFound, "Transcript not ready")
	}

	resp := map[string]interface{}{
		"text":  file.TranscriptText,
		"vtt":   file.TranscriptVTT,
		"model": file.TranscriptModel,
	}
	return c.JSON(http.StatusOK, resp)
}

func (h *FileHandler) ListAudioDetections(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	var file models.File
	if err := h.db.Select("id").Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	if h.audioDetectSvc == nil {
		return c.JSON(http.StatusOK, []interface{}{})
	}
	dets, err := h.audioDetectSvc.ListByFile(libraryID, fileID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to list detections")
	}
	return c.JSON(http.StatusOK, dets)
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

	cacheKey := storage.ProxyKey(libraryID, fileID)
	exists, _ := h.storageSvc.CacheExists(cacheKey)
	if !exists {
		return echo.NewHTTPError(http.StatusNotFound, "Proxy file not found")
	}

	// Get total size without loading the file into memory.
	totalSize, err := h.storageSvc.CacheStat(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to stat proxy")
	}

	c.Response().Header().Set("Content-Type", "video/mp4")
	c.Response().Header().Set("Accept-Ranges", "bytes")
	c.Response().Header().Set("Cache-Control", "private, max-age=3600")

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

			rc, err := h.storageSvc.OpenCacheReadStreamRange(cacheKey, &storage.ByteRange{Start: start, End: end})
			if err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read proxy")
			}
			defer rc.Close()

			c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, totalSize))
			c.Response().Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
			return c.Stream(http.StatusPartialContent, "video/mp4", rc)
		}
	}

	// Full (non-range) response — stream without buffering.
	rc, err := h.storageSvc.OpenCacheReadStream(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read proxy")
	}
	defer rc.Close()

	c.Response().Header().Set("Content-Length", strconv.FormatInt(totalSize, 10))
	return c.Stream(http.StatusOK, "video/mp4", rc)
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

	cacheKey := storage.ThumbnailKey(libraryID, fileID)
	exists, _ := h.storageSvc.CacheExists(cacheKey)
	if !exists {
		return echo.NewHTTPError(http.StatusNotFound, "Thumbnail not found")
	}

	// Stream the thumbnail without loading it fully into RAM.
	rc, err := h.storageSvc.OpenCacheReadStream(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read thumbnail")
	}
	defer rc.Close()

	c.Response().Header().Set("Cache-Control", "private, max-age=86400")
	return c.Stream(http.StatusOK, "image/webp", rc)
}
