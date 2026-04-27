package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
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
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}

	err = db.AutoMigrate(&models.User{}, &models.Library{}, &models.File{})
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

func createProxyTestData(t *testing.T, db *gorm.DB, storageSvc *storage.Service, mimeType string, fileContent []byte) (string, string) {
	t.Helper()

	userID := uuid.New()
	user := models.User{
		ID:          userID,
		Email:       fmt.Sprintf("%s@test.com", userID.String()[:8]),
		DisplayName: "Test User",
		Role:        "owner",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	libraryID := uuid.New()
	library := models.Library{
		ID:      libraryID,
		OwnerID: userID,
		Name:    "Test Library",
	}
	if err := db.Create(&library).Error; err != nil {
		t.Fatalf("Failed to create test library: %v", err)
	}

	fileID := uuid.New()
	file := models.File{
		ID:        fileID,
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

	return libraryID.String(), fileID.String()
}

func makeProxyRequest(handler *FileProxyHandler, libraryID, fileID string, queryString string) (*httptest.ResponseRecorder, error) {
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "width=640&height=480&quality=75&format=webp")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	_, err := makeProxyRequest(handler, libID, fileID, "width=320")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	_, err := makeProxyRequest(handler, libID, fileID, "quality=50")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "format=avif")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/png", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "format=png&width=100")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	// format=jpeg alone does not trigger transform (NeedsTransform returns false)
	_, err := makeProxyRequest(handler, libID, fileID, "format=jpeg")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "application/pdf", pdfData)

	_, err := makeProxyRequest(handler, libID, fileID, "width=640&format=webp")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	rec, err := makeProxyRequest(handler, libID, fileID, "width=640&format=webp")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	_, err := makeProxyRequest(handler, libID, fileID, "width=100")
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
	libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

	// With transform — handler marks transformed images immutable (deterministic content for a cache key).
	rec, err := makeProxyRequest(handler, libID, fileID, "width=100")
	if err != nil {
		t.Fatalf("Serve returned error: %v", err)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Expected Cache-Control header, got %q", cc)
	}

	// Without transform — original file path emits its own Cache-Control.
	rec2, err := makeProxyRequest(handler, libID, fileID, "")
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

	_, err := makeProxyRequest(handler, fakeLib, fakeFile, "width=100")
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
			libID, fileID := createProxyTestData(t, db, storageSvc, "image/jpeg", imageData)

			rec, err := makeProxyRequest(handler, libID, fileID, "format="+tt.format)
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
