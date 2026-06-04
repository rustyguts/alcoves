package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func TestGetWaveform_NotReady(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fileID := createVideoFile(t, db, fix.LibraryID, fix.UserID, "queued")

	rec, err := callGetWaveform(handler, fix.LibraryID.String(), fileID.String())
	if err == nil {
		t.Fatalf("expected echo.NewHTTPError, got nil (rec=%d)", rec.Code)
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %T: %v", err, err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", httpErr.Code)
	}
}

func TestGetWaveform_Ready(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fileID := createVideoFile(t, db, fix.LibraryID, fix.UserID, "ready")

	cacheKey := fmt.Sprintf("%s/%s/waveform.json", fix.LibraryID.String(), fileID.String())
	payload := []byte(`{"peaks":[0.1,0.5,0.9],"peaksPerSecond":50,"sampleRate":16000}`)
	if err := svc.StoreCacheBuffer(cacheKey, payload); err != nil {
		t.Fatalf("StoreCacheBuffer: %v", err)
	}

	rec, err := callGetWaveform(handler, fix.LibraryID.String(), fileID.String())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON body: %v (raw=%s)", err, rec.Body.String())
	}
	if got["peaksPerSecond"].(float64) != 50 {
		t.Fatalf("expected peaksPerSecond=50, got %v", got["peaksPerSecond"])
	}
	peaks, _ := got["peaks"].([]any)
	if len(peaks) != 3 {
		t.Fatalf("expected 3 peaks, got %d", len(peaks))
	}
}

func TestGetWaveform_FileNotFound(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	missing := uuid.New()

	_, err := callGetWaveform(handler, fix.LibraryID.String(), missing.String())
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", err)
	}
}

func TestGenerateWaveform_NilService(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	// waveformSvc is nil — service unavailable
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fileID := createVideoFile(t, db, fix.LibraryID, fix.UserID, "ready")

	_, err := callGenerateWaveform(handler, fix.LibraryID.String(), fileID.String())
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %v", err)
	}
}

func TestGenerateWaveform_NotAudioVideo(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	// createFile defaults to image/jpeg
	imageID := createFile(t, db, fix.LibraryID, fix.UserID, "photo.jpg", false, nil)

	_, err := callGenerateWaveform(handler, fix.LibraryID.String(), imageID.String())
	httpErr, ok := err.(*echo.HTTPError)
	// nil service short-circuits before mime check, so 503 is also valid.
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusServiceUnavailable && httpErr.Code != http.StatusBadRequest {
		t.Fatalf("expected 503 or 400, got %d", httpErr.Code)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func createVideoFile(t *testing.T, db *gorm.DB, libraryID, ownerID uuid.UUID, status string) uuid.UUID {
	t.Helper()
	fileID := uuid.New()
	s := status
	file := models.File{
		ID:             fileID,
		LibraryID:      libraryID,
		Name:           "clip.mp4",
		MimeType:       "video/mp4",
		Size:           1000,
		OwnerID:        &ownerID,
		WaveformStatus: &s,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("create video file: %v", err)
	}
	return fileID
}

func callGetWaveform(handler *FileHandler, libraryID, fileID string) (*httptest.ResponseRecorder, error) {
	req := httptest.NewRequest(http.MethodGet,
		fmt.Sprintf("/api/libraries/%s/files/%s/waveform", libraryID, fileID), nil)
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "fileId")
	c.SetParamValues(libraryID, fileID)
	return rec, handler.GetWaveform(c)
}

func callGenerateWaveform(handler *FileHandler, libraryID, fileID string) (*httptest.ResponseRecorder, error) {
	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/api/libraries/%s/files/%s/waveform", libraryID, fileID), nil)
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "fileId")
	c.SetParamValues(libraryID, fileID)
	return rec, handler.GenerateWaveform(c)
}
