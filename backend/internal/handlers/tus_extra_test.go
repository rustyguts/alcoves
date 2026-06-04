package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

func wiredTusHandler(t *testing.T) (*TusHandler, *gorm.DB) {
	t.Helper()
	db := setupTusTestDB(t)
	tempDir := t.TempDir()
	storageDir := filepath.Join(tempDir, "storage")
	os.MkdirAll(storageDir, 0o755)
	driver := storage.NewLocalDriver(storageDir, storageDir, storageDir)
	st := storage.NewService(driver)

	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })
	activitySvc := activity.NewService(db, activity.NewHub(), activity.NewBus(nil))
	cfg := &config.Config{}
	settingsSvc, _ := settings.NewService(db)
	faceSvc := facedetection.NewService(db, st, client, &facedetection.FaceConfig{})
	objSvc := objectdetection.NewService(db, st, client, &objectdetection.ObjectConfig{})
	videoSvc := videoproxy.NewService(db, st, client, activitySvc)
	waveformSvc := waveform.NewService(db, st, client, cfg, activitySvc)
	transcribeSvc := transcribe.NewService(db, st, client, cfg, activitySvc, settingsSvc)
	audioDetectSvc := audiodetection.NewService(db, st, client, cfg, settingsSvc)

	h := NewTusHandler(db, st, tempDir, faceSvc, objSvc, videoSvc, waveformSvc, transcribeSvc, audioDetectSvc, activitySvc)
	return h, db
}

func uploadOneShotMime(t *testing.T, handler *TusHandler, userID, libraryID uuid.UUID, filename, mime string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", filename),
		encodeMetadata("mimeType", mime),
	}, ",")
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/tus", bytes.NewReader(data))
	req.Header.Set("Tus-Resumable", tusResumableVersion)
	req.Header.Set("Upload-Length", fmt.Sprintf("%d", len(data)))
	req.Header.Set("Upload-Metadata", metadata)
	req.Header.Set("Content-Type", "application/offset+octet-stream")
	rec := httptest.NewRecorder()
	ctx := e.NewContext(req, rec)
	ctx.Set(middleware.ContextKeyUserID, userID.String())
	if err := handler.Create(ctx); err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	return rec
}

func TestTus_FinishUpload_Video(t *testing.T) {
	h, db := wiredTusHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)
	rec := uploadOneShotMime(t, h, userID, libraryID, "clip.mp4", "video/mp4", []byte("fake-video-bytes"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rec.Code)
	}
	// File should be created with proxy_status set (queued or not_needed).
	var f models.File
	if err := db.Where("library_id = ? AND name = ?", libraryID, "clip.mp4").First(&f).Error; err != nil {
		t.Fatalf("file not created: %v", err)
	}
	if f.ProxyStatus == nil {
		t.Fatalf("expected proxy_status to be set for video upload")
	}
}

func TestTus_FinishUpload_ImageWithDetection(t *testing.T) {
	h, db := wiredTusHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)
	// Enable both detection features so the enqueue branches run.
	db.Model(&models.Library{}).Where("id = ?", libraryID).Updates(map[string]any{
		"face_recognition_enabled": true,
		"object_detection_enabled": true,
	})
	rec := uploadOneShotMime(t, h, userID, libraryID, "photo.jpg", "image/jpeg", []byte("fake-image-bytes"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rec.Code)
	}
	var f models.File
	if err := db.Where("library_id = ? AND name = ?", libraryID, "photo.jpg").First(&f).Error; err != nil {
		t.Fatalf("file not created: %v", err)
	}
}

func TestTus_FinishUpload_LastModified(t *testing.T) {
	h, db := wiredTusHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "ts.txt"),
		encodeMetadata("mimeType", "text/plain"),
		encodeMetadata("lastModified", "1700000000000"),
	}, ",")
	e := echo.New()
	data := []byte("hello")
	req := httptest.NewRequest(http.MethodPost, "/api/tus", bytes.NewReader(data))
	req.Header.Set("Tus-Resumable", tusResumableVersion)
	req.Header.Set("Upload-Length", fmt.Sprintf("%d", len(data)))
	req.Header.Set("Upload-Metadata", metadata)
	req.Header.Set("Content-Type", "application/offset+octet-stream")
	rec := httptest.NewRecorder()
	ctx := e.NewContext(req, rec)
	ctx.Set(middleware.ContextKeyUserID, userID.String())
	if err := h.Create(ctx); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rec.Code)
	}
	var f models.File
	db.Where("library_id = ? AND name = ?", libraryID, "ts.txt").First(&f)
	if f.OriginalCreatedAt == nil {
		t.Fatalf("expected OriginalCreatedAt set from lastModified")
	}
}
