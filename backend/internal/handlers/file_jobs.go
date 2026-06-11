package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
)

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
		return internalError("Failed to queue video thumbnails", err)
	}

	return c.JSON(http.StatusOK, map[string]int{"queuedCount": queuedCount})
}

// MetadataReprocess re-enqueues EXIF/media-metadata extraction for every media
// file in the library. Owner/admin-gated by the route middleware (non-GET on
// /api/libraries/:id/* requires library admin). Resets the 3-strike attempt cap
// so previously-exhausted files retry — the escape hatch after a parser fix.
func (h *FileHandler) MetadataReprocess(c echo.Context) error {
	if h.metadataSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Metadata service unavailable")
	}

	libraryID := c.Param("id")
	if _, err := uuid.Parse(libraryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	queuedCount, err := h.metadataSvc.ReprocessLibrary(libraryID)
	if err != nil {
		return internalError(fmt.Sprintf("Reprocess failed: %v", err), err)
	}

	return c.JSON(http.StatusOK, map[string]int{"queuedCount": queuedCount})
}

func (h *FileHandler) GenerateProxy(c echo.Context) error {
	if h.videoSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Video proxy service unavailable")
	}

	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	file, err := findActiveFile(h.db, libraryID, fileID)
	if err != nil {
		return err
	}

	if !strings.HasPrefix(file.MimeType, "video/") {
		return echo.NewHTTPError(http.StatusBadRequest, "File is not a video")
	}
	if file.SourceFileID != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot generate proxy for proxy file")
	}

	if err := h.mediaJobs.TriggerProxy(libraryID, file); err != nil {
		return internalError("Failed to queue video proxy generation", err)
	}

	return c.JSON(http.StatusOK, h.fileToJSONWithLookup(file))
}

func (h *FileHandler) GenerateWaveform(c echo.Context) error {
	if h.waveformSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Waveform service unavailable")
	}

	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	file, err := findActiveFile(h.db, libraryID, fileID)
	if err != nil {
		return err
	}

	if !strings.HasPrefix(file.MimeType, "video/") && !strings.HasPrefix(file.MimeType, "audio/") {
		return echo.NewHTTPError(http.StatusBadRequest, "File is not audio/video")
	}
	if file.SourceFileID != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot generate waveform for proxy file")
	}

	if err := h.mediaJobs.TriggerWaveform(libraryID, file); err != nil {
		return internalError("Failed to queue waveform generation", err)
	}

	return c.JSON(http.StatusAccepted, h.fileToJSONWithLookup(file))
}

func (h *FileHandler) GenerateTranscript(c echo.Context) error {
	if h.transcribeSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Transcribe service unavailable")
	}

	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	file, err := findActiveFile(h.db, libraryID, fileID)
	if err != nil {
		return err
	}

	if !strings.HasPrefix(file.MimeType, "video/") && !strings.HasPrefix(file.MimeType, "audio/") {
		return echo.NewHTTPError(http.StatusBadRequest, "File is not audio/video")
	}
	if file.SourceFileID != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot transcribe proxy file")
	}

	if err := h.mediaJobs.TriggerTranscribe(libraryID, file); err != nil {
		return internalError("Failed to queue transcription", err)
	}

	return c.JSON(http.StatusAccepted, h.fileToJSONWithLookup(file))
}

func (h *FileHandler) GenerateAudioDetections(c echo.Context) error {
	if h.audioDetectSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Audio detection service unavailable")
	}

	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	file, err := findActiveFile(h.db, libraryID, fileID)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(file.MimeType, "video/") && !strings.HasPrefix(file.MimeType, "audio/") {
		return echo.NewHTTPError(http.StatusBadRequest, "File is not audio/video")
	}
	if file.TranscribeStatus == nil || *file.TranscribeStatus != "ready" {
		return echo.NewHTTPError(http.StatusBadRequest, "Transcription must be completed before audio detection")
	}
	if file.SourceFileID != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot run detection on proxy file")
	}

	if err := h.mediaJobs.TriggerAudioDetect(libraryID, file); err != nil {
		return internalError("Failed to queue audio detection", err)
	}

	return c.JSON(http.StatusAccepted, h.fileToJSONWithLookup(file))
}

// bulkActionRequest is the shared shape for bulk-transcribe / bulk-audio-detect.
// Empty FileIDs means "every video/audio file in the library" (the
// "transcribe-everything" library-page button).
type bulkActionRequest struct {
	FileIDs []string `json:"fileIds,omitempty"`
}

// bulkActionResponse reports which files were enqueued vs. skipped so the
// frontend can toast a useful summary instead of a binary success/fail.
type bulkActionResponse struct {
	Enqueued []string          `json:"enqueued"`
	Skipped  map[string]string `json:"skipped"`
}

// BulkTranscribe queues transcription for many files at once. With an empty
// fileIds array it queues every video/audio file in the library that isn't
// a proxy. Dedup is handled by asynq.Unique on the enqueue side, so a user
// double-clicking the button cannot fan out duplicate workers.
func (h *FileHandler) BulkTranscribe(c echo.Context) error {
	if h.transcribeSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Transcribe service unavailable")
	}
	libraryID := c.Param("id")
	files, err := h.bulkResolveFiles(c, libraryID)
	if err != nil {
		return err
	}

	resp := bulkActionResponse{Enqueued: []string{}, Skipped: map[string]string{}}
	for _, f := range files {
		fid := f.ID.String()
		if f.SourceFileID != nil {
			resp.Skipped[fid] = "proxy file"
			continue
		}
		if !strings.HasPrefix(f.MimeType, "video/") && !strings.HasPrefix(f.MimeType, "audio/") {
			resp.Skipped[fid] = "not audio/video"
			continue
		}
		if err := h.mediaJobs.TriggerTranscribe(libraryID, &f); err != nil {
			resp.Skipped[fid] = err.Error()
			continue
		}
		resp.Enqueued = append(resp.Enqueued, fid)
	}
	return c.JSON(http.StatusAccepted, resp)
}

// BulkAudioDetect queues PANNs audio-event detection across many files.
// Skips files whose transcript isn't ready (matches the per-file endpoint
// invariant) so the bulk button on a freshly-imported library still
// produces useful feedback instead of a wall of errors.
func (h *FileHandler) BulkAudioDetect(c echo.Context) error {
	if h.audioDetectSvc == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Audio detection service unavailable")
	}
	libraryID := c.Param("id")
	files, err := h.bulkResolveFiles(c, libraryID)
	if err != nil {
		return err
	}

	resp := bulkActionResponse{Enqueued: []string{}, Skipped: map[string]string{}}
	for _, f := range files {
		fid := f.ID.String()
		if f.SourceFileID != nil {
			resp.Skipped[fid] = "proxy file"
			continue
		}
		if !strings.HasPrefix(f.MimeType, "video/") && !strings.HasPrefix(f.MimeType, "audio/") {
			resp.Skipped[fid] = "not audio/video"
			continue
		}
		if f.TranscribeStatus == nil || *f.TranscribeStatus != "ready" {
			resp.Skipped[fid] = "transcript not ready"
			continue
		}
		if err := h.mediaJobs.TriggerAudioDetect(libraryID, &f); err != nil {
			resp.Skipped[fid] = err.Error()
			continue
		}
		resp.Enqueued = append(resp.Enqueued, fid)
	}
	return c.JSON(http.StatusAccepted, resp)
}

// bulkResolveFiles loads the target file set for a bulk action. With an
// explicit fileIds list it scopes to those IDs (after enforcing they belong
// to the library); otherwise it returns every non-trashed video/audio file
// in the library that isn't a transcoded proxy.
func (h *FileHandler) bulkResolveFiles(c echo.Context, libraryID string) ([]models.File, error) {
	var req bulkActionRequest
	if err := c.Bind(&req); err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	q := h.db.Where("library_id = ? AND trashed_at IS NULL AND source_file_id IS NULL", libraryID).
		Where("mime_type LIKE 'video/%' OR mime_type LIKE 'audio/%'")
	if len(req.FileIDs) > 0 {
		q = q.Where("id IN ?", req.FileIDs)
	}

	var files []models.File
	if err := q.Find(&files).Error; err != nil {
		return nil, internalError("Failed to load files", err)
	}
	return files, nil
}
