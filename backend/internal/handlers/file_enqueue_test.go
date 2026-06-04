package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
)

// TestFile_Upload_ImageWithDetectionEnabled exercises the maybeEnqueueFaceDetection
// and maybeEnqueueObjectDetection "enabled" branches by uploading an image to a
// library that has both detection features turned on.
func TestFile_Upload_ImageWithDetectionEnabled(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	db.Model(&models.Library{}).Where("id = ?", fix.LibraryID).Updates(map[string]any{
		"face_recognition_enabled": true,
		"object_detection_enabled": true,
	})
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("image-bytes"))
	req.Header.Set("X-Upload-Name", "pic.jpg")
	req.Header.Set("X-Upload-Mime-Type", "image/jpeg")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

// TestFile_BulkTranscribe_Explicit exercises bulkResolveFiles with an explicit
// fileIds list (the q.Where("id IN ?") branch).
func TestFile_BulkTranscribe_Explicit(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	v := mkVideo(t, db, fix)
	mkVideo(t, db, fix) // not in the explicit list -> excluded
	body := `{"fileIds":["` + v.String() + `"]}`
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.BulkTranscribe(c); err != nil {
		t.Fatalf("BulkTranscribe: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d", rec.Code)
	}
}

// TestFile_BulkTranscribe_BadBody covers the bulkResolveFiles bind-error path.
func TestFile_BulkTranscribe_BadBody(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{bad`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if httpCode(t, h.BulkTranscribe(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}
