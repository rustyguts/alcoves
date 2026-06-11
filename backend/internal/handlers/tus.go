package handlers

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/metadata"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

const tusResumableVersion = "1.0.0"

const (
	tusCleanupInterval = 1 * time.Hour
	// tusUploadMaxAge bounds how long an idle upload survives: in-memory
	// entries by CreatedAt, staging files by mtime. It must comfortably
	// exceed any plausible pause in a resumable upload — multiple API
	// replicas can share one staging volume and the in-memory map is
	// per-process, so a staging file this process doesn't know about may be
	// another replica's (or a pre-restart) in-flight upload and must never
	// be deleted while younger than this.
	tusUploadMaxAge = 24 * time.Hour
)

// tusUpload tracks an in-progress tus upload.
type tusUpload struct {
	ID           string
	Offset       int64
	Size         int64 // Upload-Length; -1 if deferred
	LibraryID    string
	Filename     string
	MimeType     string
	FolderID     *uuid.UUID
	UserID       uuid.UUID
	LastModified *int64 // epoch ms from client
	CreatedAt    time.Time
	mu           sync.Mutex
}

// TusHandler implements the tus v1.0.0 core protocol with the
// creation extension. Uploads are written to a staging directory
// and moved to permanent storage on completion.
type TusHandler struct {
	db      *gorm.DB
	fileSvc *files.Service // configured for ingest; owns finalize (hash/store/record/jobs)
	dataDir string         // staging directory for incomplete uploads

	mu      sync.RWMutex
	uploads map[string]*tusUpload

	stopCleanup chan struct{}
}

func NewTusHandler(db *gorm.DB, storageSvc *storage.Service, dataDir string, faceSvc *facedetection.Service, objSvc *objectdetection.Service, videoSvc *videoproxy.Service, waveformSvc *waveform.Service, transcribeSvc *transcribe.Service, audioDetectSvc *audiodetection.Service, metadataSvc *metadata.Service, activitySvc *activity.Service) *TusHandler {
	tusDir := filepath.Join(dataDir, ".tus-uploads")
	if err := os.MkdirAll(tusDir, 0o755); err != nil {
		log.Printf("Failed to create tus staging directory %s: %v", tusDir, err)
	}

	// The upload-finalize pipeline lives in files.Service.IngestStream so it is
	// shared with the MCP upload path. Wire the same async services the tus
	// handler used to call directly.
	fileSvc := files.NewServiceWithIngest(db, files.IngestDeps{
		Storage:     storageSvc,
		Face:        faceSvc,
		Object:      objSvc,
		Video:       videoSvc,
		Waveform:    waveformSvc,
		Transcribe:  transcribeSvc,
		AudioDetect: audioDetectSvc,
		Metadata:    metadataSvc,
		Activity:    activitySvc,
	})

	h := &TusHandler{
		db:          db,
		fileSvc:     fileSvc,
		dataDir:     tusDir,
		uploads:     make(map[string]*tusUpload),
		stopCleanup: make(chan struct{}),
	}

	// Clean staging files abandoned long enough to be considered dead
	// (age-based, so other replicas' in-flight uploads are untouched)
	h.cleanAgedStagingFiles()

	// Start periodic cleanup
	go h.cleanupLoop()

	return h
}

// RegisterRoutes mounts tus endpoints at /api/tus.
// Note: these are mounted on the top-level /api group, not under /libraries,
// because the tus protocol requires the path to match what is returned in
// the Location header.
func (h *TusHandler) RegisterRoutes(g *echo.Group) {
	tus := g.Group("/tus")
	tus.POST("", h.Create)
	tus.POST("/", h.Create)
	tus.HEAD("/:id", h.Head)
	tus.PATCH("/:id", h.Patch)
	tus.OPTIONS("", h.Options)
	tus.OPTIONS("/", h.Options)
	tus.OPTIONS("/:id", h.Options)
}

// Options responds with tus server capabilities.
func (h *TusHandler) Options(c echo.Context) error {
	h.setTusHeaders(c)
	c.Response().Header().Set("Tus-Extension", "creation,creation-with-upload")
	return c.NoContent(http.StatusNoContent)
}

// Create handles POST /api/tus — creates a new upload.
func (h *TusHandler) Create(c echo.Context) error {
	h.setTusHeaders(c)

	if err := h.checkTusVersion(c); err != nil {
		return err
	}

	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	// Parse Upload-Length (required for our implementation)
	uploadLengthStr := c.Request().Header.Get("Upload-Length")
	if uploadLengthStr == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Upload-Length header is required")
	}
	uploadLength, err := strconv.ParseInt(uploadLengthStr, 10, 64)
	if err != nil || uploadLength < 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid Upload-Length")
	}

	// Parse metadata
	meta := parseTusMetadata(c.Request().Header.Get("Upload-Metadata"))
	libraryID := meta["libraryId"]
	filename := meta["filename"]
	mimeType := meta["mimeType"]
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	if libraryID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Missing libraryId in Upload-Metadata")
	}
	if filename == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Missing filename in Upload-Metadata")
	}

	// Validate library access — user must be admin.
	// The library access middleware only applies to /api/libraries/* paths.
	// Since tus is at /api/tus, we need to check access manually.
	libUUID, err := uuid.Parse(libraryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid libraryId")
	}
	libraryAccess := h.checkLibraryAdmin(userID, libUUID)
	if libraryAccess != nil {
		return libraryAccess
	}

	var folderID *uuid.UUID
	if fid := meta["folderId"]; fid != "" {
		parsed, err := uuid.Parse(fid)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid folderId")
		}
		folderID = &parsed

		// Verify folder belongs to library
		var count int64
		h.db.Model(&models.Folder{}).Where("id = ? AND library_id = ?", parsed, libUUID).Count(&count)
		if count == 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "Folder not found in library")
		}
	}

	var lastModified *int64
	if lm := meta["lastModified"]; lm != "" {
		v, err := strconv.ParseInt(lm, 10, 64)
		if err == nil {
			lastModified = &v
		}
	}

	// Create the upload
	uploadID := uuid.New().String()
	upload := &tusUpload{
		ID:           uploadID,
		Offset:       0,
		Size:         uploadLength,
		LibraryID:    libraryID,
		Filename:     filename,
		MimeType:     mimeType,
		FolderID:     folderID,
		UserID:       userID,
		LastModified: lastModified,
		CreatedAt:    time.Now(),
	}

	// Create the staging file
	stagingPath := h.stagingPath(uploadID)
	if err := os.MkdirAll(h.dataDir, 0o755); err != nil {
		log.Printf("Failed to ensure tus staging directory %s: %v", h.dataDir, err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to prepare upload directory")
	}
	f, err := os.Create(stagingPath)
	if err != nil {
		log.Printf("Failed to create tus upload file %s: %v", stagingPath, err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create upload file")
	}

	// If creation-with-upload: the POST body may contain initial data
	var bytesReceived int64
	if c.Request().ContentLength > 0 || c.Request().Header.Get("Content-Type") == "application/offset+octet-stream" {
		bytesReceived, err = io.Copy(f, c.Request().Body)
		if err != nil {
			f.Close()
			os.Remove(stagingPath)
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to write upload data")
		}
		upload.Offset = bytesReceived
	}
	f.Close()

	h.mu.Lock()
	h.uploads[uploadID] = upload
	h.mu.Unlock()

	// If upload is already complete (small file sent in creation request)
	if upload.Offset >= upload.Size {
		dupCount, err := h.finishUpload(upload)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to finalize upload")
		}
		setDuplicateHeader(c, dupCount)
	}

	location := fmt.Sprintf("/api/tus/%s", uploadID)
	c.Response().Header().Set("Location", location)
	c.Response().Header().Set("Upload-Offset", strconv.FormatInt(upload.Offset, 10))

	return c.NoContent(http.StatusCreated)
}

// Head handles HEAD /api/tus/:id — returns current upload offset.
func (h *TusHandler) Head(c echo.Context) error {
	h.setTusHeaders(c)

	_, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	upload := h.getUpload(c.Param("id"))
	if upload == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Upload not found")
	}

	upload.mu.Lock()
	offset := upload.Offset
	size := upload.Size
	upload.mu.Unlock()

	c.Response().Header().Set("Upload-Offset", strconv.FormatInt(offset, 10))
	c.Response().Header().Set("Upload-Length", strconv.FormatInt(size, 10))
	c.Response().Header().Set("Cache-Control", "no-store")

	return c.NoContent(http.StatusOK)
}

// Patch handles PATCH /api/tus/:id — appends data to the upload.
func (h *TusHandler) Patch(c echo.Context) error {
	h.setTusHeaders(c)

	if err := h.checkTusVersion(c); err != nil {
		return err
	}

	_, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	contentType := c.Request().Header.Get("Content-Type")
	if contentType != "application/offset+octet-stream" {
		return echo.NewHTTPError(http.StatusUnsupportedMediaType, "Content-Type must be application/offset+octet-stream")
	}

	upload := h.getUpload(c.Param("id"))
	if upload == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Upload not found")
	}

	offsetStr := c.Request().Header.Get("Upload-Offset")
	if offsetStr == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Upload-Offset header is required")
	}
	clientOffset, err := strconv.ParseInt(offsetStr, 10, 64)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid Upload-Offset")
	}

	upload.mu.Lock()
	defer upload.mu.Unlock()

	if clientOffset != upload.Offset {
		return echo.NewHTTPError(http.StatusConflict, "Upload-Offset mismatch")
	}

	// Open the staging file and seek to the current offset
	stagingPath := h.stagingPath(upload.ID)
	f, err := os.OpenFile(stagingPath, os.O_WRONLY, 0o644)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to open upload file")
	}
	defer f.Close()

	if _, err := f.Seek(upload.Offset, io.SeekStart); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to seek in upload file")
	}

	bytesWritten, err := io.Copy(f, c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to write upload data")
	}

	upload.Offset += bytesWritten

	c.Response().Header().Set("Upload-Offset", strconv.FormatInt(upload.Offset, 10))

	// Check if upload is complete
	if upload.Offset >= upload.Size {
		// Unlock before finishUpload since it doesn't need the upload mutex
		upload.mu.Unlock()
		dupCount, err := h.finishUpload(upload)
		if err != nil {
			upload.mu.Lock() // re-lock for deferred unlock
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to finalize upload")
		}
		setDuplicateHeader(c, dupCount)
		upload.mu.Lock() // re-lock for deferred unlock
	}

	return c.NoContent(http.StatusNoContent)
}

// finishUpload moves the completed upload to permanent storage and creates
// the database record. Called when offset reaches the declared upload size.
// Returns the number of existing files in the library that share this hash
// (i.e. how many duplicates the new upload collided with).
func (h *TusHandler) finishUpload(upload *tusUpload) (int, error) {
	stagingPath := h.stagingPath(upload.ID)
	defer func() {
		os.Remove(stagingPath)
		h.mu.Lock()
		delete(h.uploads, upload.ID)
		h.mu.Unlock()
	}()

	f, err := os.Open(stagingPath)
	if err != nil {
		return 0, fmt.Errorf("failed to open staging file: %w", err)
	}
	defer f.Close()

	libUUID, _ := uuid.Parse(upload.LibraryID)
	params := files.IngestParams{
		LibraryID: libUUID,
		OwnerID:   upload.UserID,
		FolderID:  upload.FolderID,
		Name:      upload.Filename,
		MimeType:  upload.MimeType,
	}
	if upload.LastModified != nil {
		t := time.UnixMilli(*upload.LastModified)
		params.OriginalCreatedAt = &t
	}

	res, err := h.fileSvc.IngestStream(context.Background(), params, f)
	if err != nil {
		return 0, err
	}
	return res.DuplicateCount, nil
}

// setDuplicateHeader writes the X-Alcoves-Duplicate-Count response header when
// the upload collided with at least one existing file.
func setDuplicateHeader(c echo.Context, dupCount int) {
	if dupCount > 0 {
		c.Response().Header().Set("X-Alcoves-Duplicate-Count", strconv.Itoa(dupCount))
	}
}

// setTusHeaders sets standard tus response headers.
func (h *TusHandler) setTusHeaders(c echo.Context) {
	c.Response().Header().Set("Tus-Resumable", tusResumableVersion)
	c.Response().Header().Set("Tus-Version", tusResumableVersion)
}

func (h *TusHandler) checkTusVersion(c echo.Context) error {
	v := c.Request().Header.Get("Tus-Resumable")
	if v != "" && v != tusResumableVersion {
		return echo.NewHTTPError(http.StatusPreconditionFailed, "Unsupported tus version")
	}
	return nil
}

func (h *TusHandler) getUpload(id string) *tusUpload {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.uploads[id]
}

func (h *TusHandler) stagingPath(id string) string {
	return filepath.Join(h.dataDir, id)
}

// checkLibraryAdmin verifies the user has admin access to the library.
// Returns nil if the user is authorized, or an HTTP error if not.
func (h *TusHandler) checkLibraryAdmin(userID, libraryID uuid.UUID) error {
	// Check if user is the library owner
	var library models.Library
	if err := h.db.Where("id = ?", libraryID).First(&library).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Library not found")
	}
	if library.OwnerID == userID {
		return nil
	}

	// Check membership
	var member models.LibraryMember
	if err := h.db.Where("library_id = ? AND user_id = ?", libraryID, userID).First(&member).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Library not found")
	}
	if member.Role != "owner" && member.Role != "admin" {
		return echo.NewHTTPError(http.StatusForbidden, "Library admin access required")
	}

	return nil
}

// Stop stops the cleanup goroutine.
func (h *TusHandler) Stop() {
	close(h.stopCleanup)
}

// cleanupLoop periodically removes stale uploads.
func (h *TusHandler) cleanupLoop() {
	ticker := time.NewTicker(tusCleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			h.cleanStaleUploads()
		case <-h.stopCleanup:
			return
		}
	}
}

// cleanStaleUploads removes in-memory upload entries older than tusUploadMaxAge
// and their corresponding staging files.
func (h *TusHandler) cleanStaleUploads() {
	h.mu.Lock()
	var staleIDs []string
	for id, upload := range h.uploads {
		if time.Since(upload.CreatedAt) > tusUploadMaxAge {
			staleIDs = append(staleIDs, id)
		}
	}
	for _, id := range staleIDs {
		delete(h.uploads, id)
	}
	h.mu.Unlock()

	for _, id := range staleIDs {
		stagingPath := h.stagingPath(id)
		if err := os.Remove(stagingPath); err != nil && !os.IsNotExist(err) {
			log.Printf("Failed to remove stale tus staging file %s: %v", stagingPath, err)
		}
	}

	if len(staleIDs) > 0 {
		log.Printf("Cleaned up %d stale tus uploads", len(staleIDs))
	}

	h.cleanAgedStagingFiles()
}

// cleanAgedStagingFiles removes staging files whose mtime is older than
// tusUploadMaxAge. Deletion is age-based — NOT map-membership-based — because
// the staging directory can be shared by multiple API replicas (one RWX
// volume) while the upload map is per-process, and a restart empties the map
// entirely. A file absent from this process's map may be another replica's
// (or a pre-restart) in-flight upload and must not be deleted while young.
// Any in-memory entry for a deleted file is pruned so the map stays coherent.
func (h *TusHandler) cleanAgedStagingFiles() {
	entries, err := os.ReadDir(h.dataDir)
	if err != nil {
		log.Printf("Failed to read tus staging directory %s: %v", h.dataDir, err)
		return
	}

	removed := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if time.Since(info.ModTime()) <= tusUploadMaxAge {
			continue
		}
		id := entry.Name()
		stagingPath := filepath.Join(h.dataDir, id)
		if err := os.Remove(stagingPath); err != nil && !os.IsNotExist(err) {
			log.Printf("Failed to remove aged tus staging file %s: %v", stagingPath, err)
			continue
		}
		removed++
		h.mu.Lock()
		delete(h.uploads, id)
		h.mu.Unlock()
	}

	if removed > 0 {
		log.Printf("Cleaned up %d aged tus staging files", removed)
	}
}

// parseTusMetadata parses the Upload-Metadata header.
// Format: key1 base64val1,key2 base64val2,...
func parseTusMetadata(header string) map[string]string {
	result := make(map[string]string)
	if header == "" {
		return result
	}

	pairs := strings.Split(header, ",")
	for _, pair := range pairs {
		pair = strings.TrimSpace(pair)
		parts := strings.SplitN(pair, " ", 2)
		if len(parts) == 0 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		if len(parts) == 2 {
			decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(parts[1]))
			if err == nil {
				result[key] = string(decoded)
			}
		} else {
			result[key] = ""
		}
	}
	return result
}
