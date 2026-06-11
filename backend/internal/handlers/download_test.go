package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// ---------------------------------------------------------------------------
// recordingProcessor is a mock Processor that records the TransformOptions it
// receives, letting tests assert that the handler passes the right values.
// ---------------------------------------------------------------------------
type recordingProcessor struct {
	mu       sync.Mutex
	calls    []imageproxy.TransformOptions
	srcSizes []int // length of srcData for each call
}

func (r *recordingProcessor) Transform(srcData []byte, opts imageproxy.TransformOptions) ([]byte, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, opts)
	r.srcSizes = append(r.srcSizes, len(srcData))
	// Return a tiny valid response.
	mime := "image/jpeg"
	switch opts.Format {
	case "webp":
		mime = "image/webp"
	case "avif":
		mime = "image/avif"
	case "png":
		mime = "image/png"
	}
	return []byte("transformed"), mime, nil
}

func (r *recordingProcessor) lastCall() (imageproxy.TransformOptions, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) == 0 {
		return imageproxy.TransformOptions{}, false
	}
	return r.calls[len(r.calls)-1], true
}

func (r *recordingProcessor) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func setupProxyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "handlers")

	err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.LibraryMember{}, &models.File{})
	if err != nil {
		t.Fatalf("Failed to migrate: %v", err)
	}

	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	return db
}

func setupProxyTestHandler(t *testing.T, proc imageproxy.Processor) (*FileProxyHandler, *gorm.DB, *storage.Service, string) {
	t.Helper()
	db := setupProxyTestDB(t)

	tempDir := t.TempDir()
	storageDir := filepath.Join(tempDir, "storage")
	os.MkdirAll(storageDir, 0755)

	driver := storage.NewLocalDriver(storageDir, storageDir, storageDir)
	storageSvc := storage.NewService(driver)

	// nil asynq client + nil redis conn → inline transform mode (no queue needed in tests).
	imgSvc := imageproxy.NewService(storageSvc, nil, nil, proc)
	handler := NewFileProxyHandler(db, storageSvc, imgSvc)
	return handler, db, storageSvc, storageDir
}

// createProxyTestData creates a user (owner), library, file and stores the file bytes.
// Returns (libraryID, fileID, ownerUserID).
func createProxyTestData(t *testing.T, db *gorm.DB, storageSvc *storage.Service, mimeType string, fileContent []byte) (string, string, uuid.UUID) {
	t.Helper()

	userID := uuid.New()
	user := models.User{
		BaseModel:   models.BaseModel{ID: userID},
		Email:       fmt.Sprintf("%s@test.com", userID.String()[:8]),
		DisplayName: "Test User",
		Role:        "owner",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	libraryID := uuid.New()
	library := models.Library{
		BaseModel: models.BaseModel{ID: libraryID},
		OwnerID:   userID,
		Name:      "Test Library",
	}
	if err := db.Create(&library).Error; err != nil {
		t.Fatalf("Failed to create test library: %v", err)
	}

	fileID := uuid.New()
	file := models.File{
		BaseModel: models.BaseModel{ID: fileID},
		LibraryID: libraryID,
		Name:      "test-image.jpg",
		MimeType:  mimeType,
		Size:      int64(len(fileContent)),
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	if err := storageSvc.StoreFile(libraryID.String(), fileID.String(), fileContent); err != nil {
		t.Fatalf("Failed to store test file: %v", err)
	}

	return libraryID.String(), fileID.String(), userID
}

// makeProxyRequest issues a proxy request as the given user.
func makeProxyRequest(handler *FileProxyHandler, libraryID, fileID string, queryString string, userID uuid.UUID) (*httptest.ResponseRecorder, error) {
	e := echo.New()
	url := fmt.Sprintf("/api/files/proxy/%s/%s/image.jpg", libraryID, fileID)
	if queryString != "" {
		url += "?" + queryString
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues(fmt.Sprintf("%s/%s/image.jpg", libraryID, fileID))
	// Simulate what AuthMiddleware sets on a valid session.
	c.Set(middleware.ContextKeyUserID, userID.String())

	err := handler.Serve(c)
	return rec, err
}

// makeProxyRequestAnon issues a proxy request without an authenticated session.
func makeProxyRequestAnon(handler *FileProxyHandler, libraryID, fileID string, queryString string) (*httptest.ResponseRecorder, error) {
	e := echo.New()
	url := fmt.Sprintf("/api/files/proxy/%s/%s/image.jpg", libraryID, fileID)
	if queryString != "" {
		url += "?" + queryString
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues(fmt.Sprintf("%s/%s/image.jpg", libraryID, fileID))
	// No user ID set — simulates a request with no valid session.

	err := handler.Serve(c)
	return rec, err
}

// ---------------------------------------------------------------------------
// parseTransformOptions tests
// ---------------------------------------------------------------------------

func TestParseTransformOptions_AllParams(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy?width=640&height=480&quality=75&format=webp", nil)
	c := e.NewContext(req, httptest.NewRecorder())

	opts := parseTransformOptions(c)

	if opts.Width != 640 {
		t.Errorf("Expected width 640, got %d", opts.Width)
	}
	if opts.Height != 480 {
		t.Errorf("Expected height 480, got %d", opts.Height)
	}
	if opts.Quality != 75 {
		t.Errorf("Expected quality 75, got %d", opts.Quality)
	}
	if opts.Format != "webp" {
		t.Errorf("Expected format webp, got %s", opts.Format)
	}
}

func TestParseTransformOptions_NoParams(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy", nil)
	c := e.NewContext(req, httptest.NewRecorder())

	opts := parseTransformOptions(c)

	if opts.Width != 0 || opts.Height != 0 || opts.Quality != 0 || opts.Format != "" {
		t.Errorf("Expected all zero values, got %+v", opts)
	}
}

func TestParseTransformOptions_WidthOnly(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy?width=200", nil)
	c := e.NewContext(req, httptest.NewRecorder())

	opts := parseTransformOptions(c)

	if opts.Width != 200 {
		t.Errorf("Expected width 200, got %d", opts.Width)
	}
	if opts.Height != 0 {
		t.Errorf("Expected height 0, got %d", opts.Height)
	}
}

func TestParseTransformOptions_InvalidWidth(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy?width=abc", nil)
	c := e.NewContext(req, httptest.NewRecorder())

	opts := parseTransformOptions(c)

	if opts.Width != 0 {
		t.Errorf("Expected width 0 for invalid input, got %d", opts.Width)
	}
}

func TestParseTransformOptions_NegativeWidth(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy?width=-100", nil)
	c := e.NewContext(req, httptest.NewRecorder())

	opts := parseTransformOptions(c)

	if opts.Width != 0 {
		t.Errorf("Expected width 0 for negative input, got %d", opts.Width)
	}
}

func TestParseTransformOptions_ZeroWidth(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy?width=0", nil)
	c := e.NewContext(req, httptest.NewRecorder())

	opts := parseTransformOptions(c)

	if opts.Width != 0 {
		t.Errorf("Expected width 0, got %d", opts.Width)
	}
}

func TestParseTransformOptions_QualityBounds(t *testing.T) {
	tests := []struct {
		query    string
		expected int
	}{
		{"quality=0", 0},
		{"quality=1", 1},
		{"quality=100", 100},
		{"quality=101", 0},
		{"quality=-5", 0},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/proxy?"+tt.query, nil)
			c := e.NewContext(req, httptest.NewRecorder())

			opts := parseTransformOptions(c)
			if opts.Quality != tt.expected {
				t.Errorf("For %s: expected quality %d, got %d", tt.query, tt.expected, opts.Quality)
			}
		})
	}
}

func TestParseTransformOptions_AllFormats(t *testing.T) {
	for _, f := range []string{"jpeg", "webp", "avif", "png"} {
		t.Run(f, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/proxy?format="+f, nil)
			c := e.NewContext(req, httptest.NewRecorder())

			opts := parseTransformOptions(c)
			if opts.Format != f {
				t.Errorf("Expected format %s, got %s", f, opts.Format)
			}
		})
	}
}

func TestParseTransformOptions_InvalidFormat(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/proxy?format=gif", nil)
	c := e.NewContext(req, httptest.NewRecorder())

	opts := parseTransformOptions(c)

	if opts.Format != "" {
		t.Errorf("Expected empty format for unsupported value, got %s", opts.Format)
	}
}

// ---------------------------------------------------------------------------
// isImageMime tests
// ---------------------------------------------------------------------------

func TestIsImageMime(t *testing.T) {
	tests := []struct {
		mime     string
		expected bool
	}{
		{"image/jpeg", true},
		{"image/png", true},
		{"image/webp", true},
		{"image/avif", true},
		{"image/gif", true},
		{"text/plain", false},
		{"video/mp4", false},
		{"application/octet-stream", false},
	}

	for _, tt := range tests {
		t.Run(tt.mime, func(t *testing.T) {
			if got := isImageMime(tt.mime); got != tt.expected {
				t.Errorf("isImageMime(%q) = %v, want %v", tt.mime, got, tt.expected)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// NeedsTransform tests
// ---------------------------------------------------------------------------

func TestNeedsTransform(t *testing.T) {
	tests := []struct {
		name     string
		opts     imageproxy.TransformOptions
		expected bool
	}{
		{"empty options", imageproxy.TransformOptions{}, false},
		{"only default format", imageproxy.TransformOptions{Format: "jpeg"}, false},
		{"width set", imageproxy.TransformOptions{Width: 100}, true},
		{"height set", imageproxy.TransformOptions{Height: 100}, true},
		{"quality set", imageproxy.TransformOptions{Quality: 80}, true},
		{"webp format", imageproxy.TransformOptions{Format: "webp"}, true},
		{"avif format", imageproxy.TransformOptions{Format: "avif"}, true},
		{"png format", imageproxy.TransformOptions{Format: "png"}, true},
		{"all set", imageproxy.TransformOptions{Width: 640, Height: 480, Quality: 75, Format: "webp"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := imageproxy.NeedsTransform(tt.opts); got != tt.expected {
				t.Errorf("NeedsTransform(%+v) = %v, want %v", tt.opts, got, tt.expected)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Handler integration tests (mock processor verifies opts reach Transform)
// ---------------------------------------------------------------------------

func TestServe_WidthHeightQualityFormat_ReachProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("fake-image-bytes")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "width=640&height=480&quality=75&format=webp", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	if proc.callCount() != 1 {
		t.Fatalf("Expected processor to be called once, got %d", proc.callCount())
	}

	opts, _ := proc.lastCall()
	if opts.Width != 640 {
		t.Errorf("Expected width 640, got %d", opts.Width)
	}
	if opts.Height != 480 {
		t.Errorf("Expected height 480, got %d", opts.Height)
	}
	if opts.Quality != 75 {
		t.Errorf("Expected quality 75, got %d", opts.Quality)
	}
	if opts.Format != "webp" {
		t.Errorf("Expected format webp, got %s", opts.Format)
	}

	// Verify response content type
	if ct := rec.Header().Get("Content-Type"); ct != "image/webp" {
		t.Errorf("Expected Content-Type image/webp, got %s", ct)
	}
}

func TestServe_WidthOnly_ReachesProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("fake-image-bytes")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	_, err := makeProxyRequest(handler, libID, fileID, "width=320", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	if proc.callCount() != 1 {
		t.Fatalf("Expected processor called once, got %d", proc.callCount())
	}

	opts, _ := proc.lastCall()
	if opts.Width != 320 {
		t.Errorf("Expected width 320, got %d", opts.Width)
	}
	if opts.Height != 0 {
		t.Errorf("Expected height 0, got %d", opts.Height)
	}
}

func TestServe_QualityOnly_ReachesProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("fake-image-bytes")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	_, err := makeProxyRequest(handler, libID, fileID, "quality=50", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	if proc.callCount() != 1 {
		t.Fatalf("Expected processor called once, got %d", proc.callCount())
	}

	opts, _ := proc.lastCall()
	if opts.Quality != 50 {
		t.Errorf("Expected quality 50, got %d", opts.Quality)
	}
}

func TestServe_FormatAvif_ReachesProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("fake-image-bytes")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "format=avif", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	opts, _ := proc.lastCall()
	if opts.Format != "avif" {
		t.Errorf("Expected format avif, got %s", opts.Format)
	}

	if ct := rec.Header().Get("Content-Type"); ct != "image/avif" {
		t.Errorf("Expected Content-Type image/avif, got %s", ct)
	}
}

func TestServe_FormatPng_ReachesProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("fake-image-bytes")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/png", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "format=png&width=100", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	opts, _ := proc.lastCall()
	if opts.Format != "png" {
		t.Errorf("Expected format png, got %s", opts.Format)
	}
	if opts.Width != 100 {
		t.Errorf("Expected width 100, got %d", opts.Width)
	}

	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Expected Content-Type image/png, got %s", ct)
	}
}

func TestServe_NoParams_SkipsProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("fake-image-bytes")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	if proc.callCount() != 0 {
		t.Errorf("Expected processor NOT to be called without transform params, got %d calls", proc.callCount())
	}

	// Should serve original data.
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
	if rec.Body.String() != string(imageData) {
		t.Errorf("Expected original file content, got %q", rec.Body.String())
	}
}

func TestServe_FormatJpegOnly_SkipsProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("fake-image-bytes")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	// format=jpeg alone does not trigger transform (NeedsTransform returns false)
	_, err := makeProxyRequest(handler, libID, fileID, "format=jpeg", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	if proc.callCount() != 0 {
		t.Errorf("Expected processor NOT called for format=jpeg only, got %d calls", proc.callCount())
	}
}

func TestServe_NonImageMime_SkipsProcessor(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	pdfData := []byte("fake-pdf-content")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "application/pdf", pdfData)

	_, err := makeProxyRequest(handler, libID, fileID, "width=640&format=webp", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	if proc.callCount() != 0 {
		t.Errorf("Expected processor NOT called for non-image mime, got %d calls", proc.callCount())
	}
}

func TestServe_NilProcessor_ServesOriginal(t *testing.T) {
	handler, db, storageSvc, _ := setupProxyTestHandler(t, nil)

	imageData := []byte("original-image-data")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "width=640&format=webp", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	// With nil processor, should fall through to streaming original.
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
	if rec.Body.String() != string(imageData) {
		t.Errorf("Expected original content, got %q", rec.Body.String())
	}
}

func TestServe_ProcessorReceivesOriginalFileBytes(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("specific-content-12345")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	_, err := makeProxyRequest(handler, libID, fileID, "width=100", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}

	if proc.callCount() != 1 {
		t.Fatalf("Expected 1 call, got %d", proc.callCount())
	}

	proc.mu.Lock()
	srcSize := proc.srcSizes[0]
	proc.mu.Unlock()

	if srcSize != len(imageData) {
		t.Errorf("Expected processor to receive %d bytes, got %d", len(imageData), srcSize)
	}
}

func TestServe_CacheControlHeader(t *testing.T) {
	proc := &recordingProcessor{}
	handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

	imageData := []byte("image-data")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	// With transform — handler marks transformed images immutable (deterministic content for a cache key).
	rec, err := makeProxyRequest(handler, libID, fileID, "width=100", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Expected Cache-Control header, got %q", cc)
	}

	// Without transform — original file path emits its own Cache-Control.
	rec2, err := makeProxyRequest(handler, libID, fileID, "", ownerID)
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}
	if cc := rec2.Header().Get("Cache-Control"); cc == "" {
		t.Errorf("Expected non-empty Cache-Control header on original, got %q", cc)
	}
}

func TestServe_InvalidPath_Returns404(t *testing.T) {
	proc := &recordingProcessor{}
	handler, _, _, _ := setupProxyTestHandler(t, proc)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/files/proxy/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues("")

	err := handler.Serve(c)
	if err == nil {
		t.Fatal("Expected error for empty path")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Errorf("Expected 404, got %d", httpErr.Code)
	}
}

func TestServe_NonexistentFile_Returns404(t *testing.T) {
	proc := &recordingProcessor{}
	handler, _, _, _ := setupProxyTestHandler(t, proc)

	fakeLib := uuid.New().String()
	fakeFile := uuid.New().String()
	someUserID := uuid.New()

	_, err := makeProxyRequest(handler, fakeLib, fakeFile, "width=100", someUserID)
	if err == nil {
		t.Fatal("Expected error for nonexistent file")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Errorf("Expected 404, got %d", httpErr.Code)
	}
}

func TestServe_MultipleFormats_CorrectMIME(t *testing.T) {
	tests := []struct {
		format       string
		expectedMIME string
	}{
		{"webp", "image/webp"},
		{"avif", "image/avif"},
		{"png", "image/png"},
	}

	for _, tt := range tests {
		t.Run(tt.format, func(t *testing.T) {
			proc := &recordingProcessor{}
			handler, db, storageSvc, _ := setupProxyTestHandler(t, proc)

			imageData := []byte("img-bytes")
			libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

			rec, err := makeProxyRequest(handler, libID, fileID, "format="+tt.format, ownerID)
			if err != nil {
				t.Fatalf("Serve returned error: %v", err)
			}

			if ct := rec.Header().Get("Content-Type"); ct != tt.expectedMIME {
				t.Errorf("Expected Content-Type %s, got %s", tt.expectedMIME, ct)
			}

			opts, ok := proc.lastCall()
			if !ok {
				t.Fatal("Expected processor to be called")
			}
			if opts.Format != tt.format {
				t.Errorf("Expected format %s passed to processor, got %s", tt.format, opts.Format)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Auth + membership enforcement tests
// ---------------------------------------------------------------------------

// TestServe_NoSession_Returns401 verifies that an unauthenticated request
// (no user ID in context) is rejected with 401.
func TestServe_NoSession_Returns401(t *testing.T) {
	handler, db, storageSvc, _ := setupProxyTestHandler(t, nil)

	imageData := []byte("secret-file")
	libID, fileID, _ := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	_, err := makeProxyRequestAnon(handler, libID, fileID, "")
	if err == nil {
		t.Fatal("Expected error for unauthenticated request")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 Unauthorized, got %d", httpErr.Code)
	}
}

// TestServe_OwnerCanAccess_Returns200 verifies that the library owner gets 200.
func TestServe_OwnerCanAccess_Returns200(t *testing.T) {
	handler, db, storageSvc, _ := setupProxyTestHandler(t, nil)

	imageData := []byte("owner-file")
	libID, fileID, ownerID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "", ownerID)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("Expected 200 for owner, got %d", rec.Code)
	}
}

// TestServe_NonMember_Returns404 verifies that a user who is not a member of
// the library receives 404 (library not found from their perspective).
func TestServe_NonMember_Returns404(t *testing.T) {
	handler, db, storageSvc, _ := setupProxyTestHandler(t, nil)

	imageData := []byte("private-file")
	libID, fileID, _ := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	// Create a second, unrelated user who has no membership in the library.
	otherUserID := uuid.New()
	otherUser := models.User{
		BaseModel:   models.BaseModel{ID: otherUserID},
		Email:       fmt.Sprintf("%s@other.com", otherUserID.String()[:8]),
		DisplayName: "Other User",
		Role:        "user",
	}
	if err := db.Create(&otherUser).Error; err != nil {
		t.Fatalf("Failed to create other user: %v", err)
	}

	_, err := makeProxyRequest(handler, libID, fileID, "", otherUserID)
	if err == nil {
		t.Fatal("Expected error for non-member request")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for non-member, got %d", httpErr.Code)
	}
}

// TestParseTransformOptions_DimensionClamped verifies that width and height
// values exceeding maxTransformDimension are clamped to 4096.
func TestParseTransformOptions_DimensionClamped(t *testing.T) {
	tests := []struct {
		query          string
		expectedWidth  int
		expectedHeight int
	}{
		{"width=5000", maxTransformDimension, 0},
		{"height=99999", 0, maxTransformDimension},
		{"width=4096", maxTransformDimension, 0},
		{"width=4097", maxTransformDimension, 0},
		{"width=1024&height=8192", 1024, maxTransformDimension},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/proxy?"+tt.query, nil)
			c := e.NewContext(req, httptest.NewRecorder())

			opts := parseTransformOptions(c)
			if opts.Width != tt.expectedWidth {
				t.Errorf("width: expected %d, got %d", tt.expectedWidth, opts.Width)
			}
			if opts.Height != tt.expectedHeight {
				t.Errorf("height: expected %d, got %d", tt.expectedHeight, opts.Height)
			}
		})
	}
}

func TestSafeZipName(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"photo.jpg", "photo.jpg"},
		{"a/b/c.txt", "c.txt"},
		{"../../../../etc/passwd", "passwd"},
		{"..\\..\\windows\\system32\\cmd.exe", "cmd.exe"},
		{"/.ssh/authorized_keys", "authorized_keys"},
		{"..", "file"},
		{"", "file"},
		{"/", "file"},
		{"....//evil", "evil"},
	}
	for _, tc := range cases {
		if got := safeZipName(tc.in); got != tc.want {
			t.Errorf("safeZipName(%q) = %q, want %q", tc.in, got, tc.want)
		}
		if strings.Contains(safeZipName(tc.in), "..") || strings.ContainsAny(safeZipName(tc.in), "/\\") {
			t.Errorf("safeZipName(%q) = %q still contains traversal", tc.in, safeZipName(tc.in))
		}
	}
}
