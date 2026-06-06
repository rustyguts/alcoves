package handlers

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/filehash"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/mediajobs"
	"github.com/alcoves/alcoves-backend/internal/services/metadata"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

type FileHandler struct {
	db             *gorm.DB
	fileSvc        *files.Service
	storageSvc     *storage.Service
	videoSvc       *videoproxy.Service
	transcribeSvc  *transcribe.Service
	audioDetectSvc *audiodetection.Service
	waveformSvc    *waveform.Service
	metadataSvc    *metadata.Service
	activitySvc    *activity.Service
	mediaJobs      *mediajobs.Service
}

func NewFileHandler(db *gorm.DB, fileSvc *files.Service, storageSvc *storage.Service, videoSvc *videoproxy.Service, transcribeSvc *transcribe.Service, audioDetectSvc *audiodetection.Service, waveformSvc *waveform.Service, metadataSvc *metadata.Service, activitySvc *activity.Service) *FileHandler {
	return &FileHandler{db: db, fileSvc: fileSvc, storageSvc: storageSvc, videoSvc: videoSvc, transcribeSvc: transcribeSvc, audioDetectSvc: audioDetectSvc, waveformSvc: waveformSvc, metadataSvc: metadataSvc, activitySvc: activitySvc, mediaJobs: mediajobs.NewService(db, videoSvc, waveformSvc, transcribeSvc, audioDetectSvc)}
}

func (h *FileHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/files", h.List)
	g.POST("/:id/files", h.Upload)
	g.GET("/:id/files/:fileId", h.Get)
	g.PATCH("/:id/files/:fileId", h.Update)
	g.DELETE("/:id/files/:fileId", h.Delete)
	g.GET("/:id/files/:fileId/playback-sources", h.PlaybackSources)
	g.POST("/:id/files/:fileId/proxy", h.GenerateProxy)
	g.POST("/:id/files/:fileId/transcribe", h.GenerateTranscript)
	g.GET("/:id/files/:fileId/transcript", h.GetTranscript)
	g.POST("/:id/files/:fileId/audio-detect", h.GenerateAudioDetections)
	g.GET("/:id/files/:fileId/audio-detections", h.ListAudioDetections)
	g.POST("/:id/files/bulk-transcribe", h.BulkTranscribe)
	g.POST("/:id/files/bulk-audio-detect", h.BulkAudioDetect)
	g.POST("/:id/files/:fileId/waveform", h.GenerateWaveform)
	g.GET("/:id/files/:fileId/waveform", h.GetWaveform)
	g.POST("/:id/files/video-thumbnails/reprocess", h.ReprocessVideoThumbnails)
	g.POST("/:id/metadata/reprocess", h.MetadataReprocess)
	g.GET("/:id/timeline", h.Timeline)
	g.GET("/:id/timeline/histogram", h.TimelineHistogram)
	g.GET("/:id/map", h.Map)
	g.GET("/:id/files/:fileId/proxy", h.Proxy)
	g.GET("/:id/files/:fileId/thumbnail", h.Thumbnail)
	g.POST("/:id/files/purge", h.Purge)
	g.POST("/:id/files/restore", h.Restore)
}

func (h *FileHandler) List(c echo.Context) error {
	// Validate libraryID is a UUID before passing it to the listing service.
	libraryID := c.Param("id")
	if _, err := uuid.Parse(libraryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	result, err := h.fileSvc.ListLibraryFiles(libraryID, files.ListParams{
		Trashed: c.QueryParam("trashed") == "true",
		Limit:   c.QueryParam("limit"),
		Folder:  c.QueryParam("folder"),
		Cursor:  c.QueryParam("cursor"),
	})
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

	// Delegate the full ingest pipeline (stream/hash/store, File record,
	// activity, dedup, post-upload jobs) to the shared IngestStream — the same
	// source of truth used by the tus finalize path and the MCP upload tool.
	result, err := h.fileSvc.IngestStream(c.Request().Context(), files.IngestParams{
		LibraryID: libraryID,
		OwnerID:   userID,
		FolderID:  parentFolderID,
		Name:      fileName,
		MimeType:  mimeType,
	}, c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to upload file")
	}

	return c.JSON(http.StatusOK, fileToJSON(result.File, result.DuplicateIDs))
}

func (h *FileHandler) Get(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")

	file, err := findFileAnyState(h.db, libraryID, fileID)
	if err != nil {
		return err
	}

	// If ?inline=true, serve the actual file data
	inline := c.QueryParam("inline") == "true"
	if inline {
		return h.serveFileData(c, file)
	}

	// Otherwise return metadata
	var dupes []uuid.UUID
	if file.Hash != nil && file.SourceFileID == nil {
		dupes, _ = filehash.FindDuplicates(h.db, file.LibraryID, file.ID, *file.Hash)
	}
	return c.JSON(http.StatusOK, fileToJSON(file, dupes))
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
	if err := h.db.Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to fetch updated file")
	}

	return c.JSON(http.StatusOK, h.fileToJSONWithLookup(&file))
}

type deleteFileRequest struct {
	FileIDs []string `json:"fileIds"`
}

func (h *FileHandler) Delete(c echo.Context) error {
	libraryID := c.Param("id")
	fileID := c.Param("fileId")
	libUUID, parseErr := uuid.Parse(libraryID)
	if parseErr != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	actorID := middleware.GetUserID(c)

	now := time.Now()

	// Check for bulk delete via body
	var req deleteFileRequest
	c.Bind(&req) // ignore error — body is optional

	if len(req.FileIDs) > 0 {
		// Bulk soft-delete
		result := h.db.Model(&models.File{}).
			Where("id IN ? AND library_id = ? AND trashed_at IS NULL", req.FileIDs, libraryID).
			Updates(map[string]interface{}{"trashed_at": now, "updated_at": now})
		if h.activitySvc != nil && result.RowsAffected > 0 {
			aid := actorID
			h.activitySvc.EmitAsync(activity.EmitParams{
				LibraryID:   libUUID,
				ActorID:     &aid,
				Action:      activity.ActionFileDeleted,
				SubjectType: activity.SubjectFile,
				Metadata: map[string]any{
					"count": result.RowsAffected,
				},
			})
		}
		return c.JSON(http.StatusOK, map[string]int64{"trashed": result.RowsAffected})
	}

	// Capture file name BEFORE the Update so the activity row has a snapshot.
	var snapshot models.File
	_ = h.db.Select("id, name, parent_folder_id").
		Where("id = ? AND library_id = ?", fileID, libraryID).First(&snapshot).Error

	// Single file soft-delete
	result := h.db.Model(&models.File{}).
		Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).
		Updates(map[string]interface{}{"trashed_at": now, "updated_at": now})

	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	aid := actorID
	emitActivity(h.activitySvc, activity.EmitParams{
		LibraryID:   libUUID,
		ActorID:     &aid,
		Action:      activity.ActionFileDeleted,
		SubjectType: activity.SubjectFile,
		SubjectID:   &snapshot.ID,
		Metadata: map[string]any{
			"name":           snapshot.Name,
			"count":          1,
			"parentFolderId": snapshot.ParentFolderID,
		},
	})
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

	purged, err := h.fileSvc.Purge(libraryID, files.PurgeParams{FileIDs: req.FileIDs, FolderIDs: req.FolderIDs})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to purge items")
	}
	return c.JSON(http.StatusOK, map[string]int{"purged": purged})
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

// Timeline returns library files flattened and sorted newest-first by effective
// capture date for the Timeline view. ?type=media (default) limits to images +
// videos; ?type=all includes every file. Cursor-paginated.
func (h *FileHandler) Timeline(c echo.Context) error {
	libraryID := c.Param("id")
	if _, err := uuid.Parse(libraryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	result, err := h.fileSvc.ListLibraryTimeline(libraryID, c)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, result)
}

// TimelineHistogram returns whole-library per-month file counts for the date
// scrubber. ?type=media (default) limits to images + videos; ?type=all counts
// every file.
func (h *FileHandler) TimelineHistogram(c echo.Context) error {
	libraryID := c.Param("id")
	if _, err := uuid.Parse(libraryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	result, err := h.fileSvc.ListLibraryTimelineHistogram(libraryID, c)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, result)
}

// Map returns geotagged files (with GPS coordinates) for the Map view, capped at
// a sane maximum with a `truncated` flag when the cap is hit.
func (h *FileHandler) Map(c echo.Context) error {
	libraryID := c.Param("id")
	if _, err := uuid.Parse(libraryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	result, err := h.fileSvc.ListLibraryMapPoints(libraryID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, result)
}

// fileToJSONWithLookup serializes a File and computes duplicateOfFileIds via
// a per-library hash query. Use for single-file responses where dedup info
// matters (Get, Update, Upload finalize, etc.).
func (h *FileHandler) fileToJSONWithLookup(f *models.File) map[string]interface{} {
	var dupes []uuid.UUID
	if f.Hash != nil && f.SourceFileID == nil {
		dupes, _ = filehash.FindDuplicates(h.db, f.LibraryID, f.ID, *f.Hash)
	}
	return fileToJSON(f, dupes)
}

// fileToJSON serializes a File for single-resource responses.
// Pass duplicateOfFileIds to surface dedup matches in the same library
// (other non-trashed source files sharing this hash). Pass nil to omit.
func fileToJSON(f *models.File, duplicateOfFileIds []uuid.UUID) map[string]interface{} {
	result := map[string]interface{}{
		"id":                     f.ID.String(),
		"libraryId":              f.LibraryID.String(),
		"parentFolderId":         uuidPtr(f.ParentFolderID),
		"name":                   f.Name,
		"kind":                   "file",
		"mimeType":               f.MimeType,
		"size":                   f.Size,
		"duration":               f.Duration,
		"width":                  f.Width,
		"height":                 f.Height,
		"proxyStatus":            f.ProxyStatus,
		"proxyProgress":          f.ProxyProgress,
		"proxyEtaSeconds":        f.ProxyEtaSeconds,
		"transcribeStatus":       f.TranscribeStatus,
		"transcribeProgress":     f.TranscribeProgress,
		"transcribeEtaSeconds":   f.TranscribeEtaSeconds,
		"transcribeError":        f.TranscribeError,
		"transcribeVersion":      f.TranscribeVersion,
		"transcribedVersion":     f.TranscribedVersion,
		"transcriptModel":        f.TranscriptModel,
		"audioDetectStatus":      f.AudioDetectStatus,
		"audioDetectProgress":    f.AudioDetectProgress,
		"audioDetectEtaSeconds":  f.AudioDetectEtaSeconds,
		"audioDetectError":       f.AudioDetectError,
		"audioDetectVersion":     f.AudioDetectVersion,
		"audioDetectedVersion":   f.AudioDetectedVersion,
		"audioDetectModel":       f.AudioDetectModel,
		"waveformStatus":         f.WaveformStatus,
		"waveformProgress":       f.WaveformProgress,
		"waveformError":          f.WaveformError,
		"waveformVersion":        f.WaveformVersion,
		"waveformedVersion":      f.WaveformedVersion,
		"waveformPeaksPerSecond": f.WaveformPeaksPerSecond,
		"thumbnailFileId":        uuidPtr(f.ThumbnailFileID),
		"sourceFileId":           uuidPtr(f.SourceFileID),
		"trashedAt":              timeStr(f.TrashedAt),
		"createdAt":              f.CreatedAt.Format(time.RFC3339Nano),
		"updatedAt":              f.UpdatedAt.Format(time.RFC3339Nano),
	}
	if f.OriginalCreatedAt != nil {
		result["originalCreatedAt"] = f.OriginalCreatedAt.Format(time.RFC3339Nano)
	} else {
		result["originalCreatedAt"] = nil
	}
	result["hash"] = f.Hash
	if duplicateOfFileIds == nil {
		result["duplicateOfFileIds"] = nil
	} else {
		ids := make([]string, len(duplicateOfFileIds))
		for i, id := range duplicateOfFileIds {
			ids[i] = id.String()
		}
		result["duplicateOfFileIds"] = ids
	}
	result["hasDuplicates"] = len(duplicateOfFileIds) > 0
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
