package handlers

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func setupTusTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}

	// Auto-migrate test tables
	err = db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.File{},
		&models.Folder{},
		&models.LibraryMember{},
	)
	if err != nil {
		t.Fatalf("Failed to migrate: %v", err)
	}

	// CASCADE drops dependent rows in any tables migrated by sibling test
	// files so the unique-email constraint never collides across runs.
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	return db
}

func setupTusTestHandler(t *testing.T) (*TusHandler, *gorm.DB, string) {
	t.Helper()
	db := setupTusTestDB(t)

	// Create temp directory for storage and tus staging
	tempDir := t.TempDir()
	storageDir := filepath.Join(tempDir, "storage")
	os.MkdirAll(storageDir, 0755)

	driver := storage.NewLocalDriver(storageDir, storageDir, storageDir)
	storageSvc := storage.NewService(driver)
	handler := NewTusHandler(db, storageSvc, tempDir, nil, nil, nil, nil)

	return handler, db, tempDir
}

func createTestUserAndLibrary(t *testing.T, db *gorm.DB) (uuid.UUID, uuid.UUID) {
	t.Helper()

	userID := uuid.New()
	user := models.User{
		ID:          userID,
		Email:       "test@example.com",
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

	return userID, libraryID
}

func encodeMetadata(key, value string) string {
	return fmt.Sprintf("%s %s", key, base64.StdEncoding.EncodeToString([]byte(value)))
}

func TestTusOptions(t *testing.T) {
	handler, _, _ := setupTusTestHandler(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodOptions, "/api/tus", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := handler.Options(c); err != nil {
		t.Fatalf("Options failed: %v", err)
	}

	if rec.Code != http.StatusNoContent {
		t.Errorf("Expected status %d, got %d", http.StatusNoContent, rec.Code)
	}

	if v := rec.Header().Get("Tus-Resumable"); v != tusResumableVersion {
		t.Errorf("Expected Tus-Resumable %s, got %s", tusResumableVersion, v)
	}

	if v := rec.Header().Get("Tus-Version"); v != tusResumableVersion {
		t.Errorf("Expected Tus-Version %s, got %s", tusResumableVersion, v)
	}

	if v := rec.Header().Get("Tus-Extension"); !strings.Contains(v, "creation") {
		t.Errorf("Expected Tus-Extension to contain 'creation', got %s", v)
	}
}

func TestTusCreate(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	e := echo.New()

	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "test.txt"),
		encodeMetadata("mimeType", "text/plain"),
	}, ",")

	req := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	req.Header.Set("Tus-Resumable", tusResumableVersion)
	req.Header.Set("Upload-Length", "100")
	req.Header.Set("Upload-Metadata", metadata)
	req.Header.Set("Content-Length", "0")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Create(c); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if rec.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d", http.StatusCreated, rec.Code)
	}

	location := rec.Header().Get("Location")
	if location == "" {
		t.Error("Expected Location header to be set")
	}

	if !strings.HasPrefix(location, "/api/tus/") {
		t.Errorf("Expected Location to start with /api/tus/, got %s", location)
	}

	offset := rec.Header().Get("Upload-Offset")
	if offset != "0" {
		t.Errorf("Expected Upload-Offset 0, got %s", offset)
	}
}

func TestTusCreateWithoutAuth(t *testing.T) {
	handler, _, _ := setupTusTestHandler(t)

	e := echo.New()

	metadata := strings.Join([]string{
		encodeMetadata("libraryId", uuid.New().String()),
		encodeMetadata("filename", "test.txt"),
	}, ",")

	req := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	req.Header.Set("Tus-Resumable", tusResumableVersion)
	req.Header.Set("Upload-Length", "100")
	req.Header.Set("Upload-Metadata", metadata)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := handler.Create(c)
	if err == nil {
		t.Fatal("Expected Create to fail without auth")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}

	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, httpErr.Code)
	}
}

func TestTusCreateMissingMetadata(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, _ := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Missing libraryId
	metadata := encodeMetadata("filename", "test.txt")

	req := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	req.Header.Set("Tus-Resumable", tusResumableVersion)
	req.Header.Set("Upload-Length", "100")
	req.Header.Set("Upload-Metadata", metadata)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, userID.String())

	err := handler.Create(c)
	if err == nil {
		t.Fatal("Expected Create to fail with missing libraryId")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}

	if httpErr.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, httpErr.Code)
	}
}

func TestTusCreateInvalidLibrary(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, _ := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Use non-existent library ID
	fakeLibraryID := uuid.New().String()
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", fakeLibraryID),
		encodeMetadata("filename", "test.txt"),
	}, ",")

	req := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	req.Header.Set("Tus-Resumable", tusResumableVersion)
	req.Header.Set("Upload-Length", "100")
	req.Header.Set("Upload-Metadata", metadata)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, userID.String())

	err := handler.Create(c)
	if err == nil {
		t.Fatal("Expected Create to fail with invalid library")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}

	if httpErr.Code != http.StatusNotFound {
		t.Errorf("Expected status %d, got %d", http.StatusNotFound, httpErr.Code)
	}
}

func TestTusHead(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Create an upload first
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "test.txt"),
	}, ",")

	createReq := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	createReq.Header.Set("Tus-Resumable", tusResumableVersion)
	createReq.Header.Set("Upload-Length", "100")
	createReq.Header.Set("Upload-Metadata", metadata)
	createRec := httptest.NewRecorder()
	createCtx := e.NewContext(createReq, createRec)
	createCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Create(createCtx); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	location := createRec.Header().Get("Location")
	uploadID := strings.TrimPrefix(location, "/api/tus/")

	// Now HEAD the upload
	headReq := httptest.NewRequest(http.MethodHead, "/api/tus/"+uploadID, nil)
	headReq.Header.Set("Tus-Resumable", tusResumableVersion)
	headRec := httptest.NewRecorder()
	headCtx := e.NewContext(headReq, headRec)
	headCtx.SetParamNames("id")
	headCtx.SetParamValues(uploadID)
	headCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Head(headCtx); err != nil {
		t.Fatalf("Head failed: %v", err)
	}

	if headRec.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, headRec.Code)
	}

	if offset := headRec.Header().Get("Upload-Offset"); offset != "0" {
		t.Errorf("Expected Upload-Offset 0, got %s", offset)
	}

	if length := headRec.Header().Get("Upload-Length"); length != "100" {
		t.Errorf("Expected Upload-Length 100, got %s", length)
	}
}

func TestTusPatch(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Create an upload
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "test.txt"),
		encodeMetadata("mimeType", "text/plain"),
	}, ",")

	createReq := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	createReq.Header.Set("Tus-Resumable", tusResumableVersion)
	createReq.Header.Set("Upload-Length", "11")
	createReq.Header.Set("Upload-Metadata", metadata)
	createRec := httptest.NewRecorder()
	createCtx := e.NewContext(createReq, createRec)
	createCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Create(createCtx); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	location := createRec.Header().Get("Location")
	uploadID := strings.TrimPrefix(location, "/api/tus/")

	// PATCH with data
	data := []byte("Hello World")
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/tus/"+uploadID, bytes.NewReader(data))
	patchReq.Header.Set("Tus-Resumable", tusResumableVersion)
	patchReq.Header.Set("Upload-Offset", "0")
	patchReq.Header.Set("Content-Type", "application/offset+octet-stream")
	patchRec := httptest.NewRecorder()
	patchCtx := e.NewContext(patchReq, patchRec)
	patchCtx.SetParamNames("id")
	patchCtx.SetParamValues(uploadID)
	patchCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Patch(patchCtx); err != nil {
		t.Fatalf("Patch failed: %v", err)
	}

	if patchRec.Code != http.StatusNoContent {
		t.Errorf("Expected status %d, got %d", http.StatusNoContent, patchRec.Code)
	}

	if offset := patchRec.Header().Get("Upload-Offset"); offset != "11" {
		t.Errorf("Expected Upload-Offset 11, got %s", offset)
	}

	// Verify file was created in database
	var file models.File
	err := db.Where("library_id = ? AND name = ?", libraryID, "test.txt").First(&file).Error
	if err != nil {
		t.Errorf("Expected file to be created in database: %v", err)
	}
}

func TestTusPatchResume(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Create an upload
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "resume-test.txt"),
	}, ",")

	createReq := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	createReq.Header.Set("Tus-Resumable", tusResumableVersion)
	createReq.Header.Set("Upload-Length", "20")
	createReq.Header.Set("Upload-Metadata", metadata)
	createRec := httptest.NewRecorder()
	createCtx := e.NewContext(createReq, createRec)
	createCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Create(createCtx); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	location := createRec.Header().Get("Location")
	uploadID := strings.TrimPrefix(location, "/api/tus/")

	// PATCH first part
	firstPart := []byte("FirstPart")
	patch1Req := httptest.NewRequest(http.MethodPatch, "/api/tus/"+uploadID, bytes.NewReader(firstPart))
	patch1Req.Header.Set("Tus-Resumable", tusResumableVersion)
	patch1Req.Header.Set("Upload-Offset", "0")
	patch1Req.Header.Set("Content-Type", "application/offset+octet-stream")
	patch1Rec := httptest.NewRecorder()
	patch1Ctx := e.NewContext(patch1Req, patch1Rec)
	patch1Ctx.SetParamNames("id")
	patch1Ctx.SetParamValues(uploadID)
	patch1Ctx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Patch(patch1Ctx); err != nil {
		t.Fatalf("First patch failed: %v", err)
	}

	if offset := patch1Rec.Header().Get("Upload-Offset"); offset != "9" {
		t.Errorf("Expected Upload-Offset 9, got %s", offset)
	}

	// PATCH second part (resume from offset 9)
	secondPart := []byte("SecondPart")
	patch2Req := httptest.NewRequest(http.MethodPatch, "/api/tus/"+uploadID, bytes.NewReader(secondPart))
	patch2Req.Header.Set("Tus-Resumable", tusResumableVersion)
	patch2Req.Header.Set("Upload-Offset", "9")
	patch2Req.Header.Set("Content-Type", "application/offset+octet-stream")
	patch2Rec := httptest.NewRecorder()
	patch2Ctx := e.NewContext(patch2Req, patch2Rec)
	patch2Ctx.SetParamNames("id")
	patch2Ctx.SetParamValues(uploadID)
	patch2Ctx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Patch(patch2Ctx); err != nil {
		t.Fatalf("Second patch failed: %v", err)
	}

	if offset := patch2Rec.Header().Get("Upload-Offset"); offset != "19" {
		t.Errorf("Expected Upload-Offset 19, got %s", offset)
	}
}

func TestTusPatchOffsetMismatch(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Create an upload
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "test.txt"),
	}, ",")

	createReq := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	createReq.Header.Set("Tus-Resumable", tusResumableVersion)
	createReq.Header.Set("Upload-Length", "100")
	createReq.Header.Set("Upload-Metadata", metadata)
	createRec := httptest.NewRecorder()
	createCtx := e.NewContext(createReq, createRec)
	createCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Create(createCtx); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	location := createRec.Header().Get("Location")
	uploadID := strings.TrimPrefix(location, "/api/tus/")

	// PATCH with wrong offset
	data := []byte("test")
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/tus/"+uploadID, bytes.NewReader(data))
	patchReq.Header.Set("Tus-Resumable", tusResumableVersion)
	patchReq.Header.Set("Upload-Offset", "50") // Wrong offset
	patchReq.Header.Set("Content-Type", "application/offset+octet-stream")
	patchRec := httptest.NewRecorder()
	patchCtx := e.NewContext(patchReq, patchRec)
	patchCtx.SetParamNames("id")
	patchCtx.SetParamValues(uploadID)
	patchCtx.Set(middleware.ContextKeyUserID, userID.String())

	err := handler.Patch(patchCtx)
	if err == nil {
		t.Fatal("Expected Patch to fail with offset mismatch")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}

	if httpErr.Code != http.StatusConflict {
		t.Errorf("Expected status %d, got %d", http.StatusConflict, httpErr.Code)
	}
}

func TestTusPatchWrongContentType(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Create an upload
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "test.txt"),
	}, ",")

	createReq := httptest.NewRequest(http.MethodPost, "/api/tus", nil)
	createReq.Header.Set("Tus-Resumable", tusResumableVersion)
	createReq.Header.Set("Upload-Length", "100")
	createReq.Header.Set("Upload-Metadata", metadata)
	createRec := httptest.NewRecorder()
	createCtx := e.NewContext(createReq, createRec)
	createCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Create(createCtx); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	location := createRec.Header().Get("Location")
	uploadID := strings.TrimPrefix(location, "/api/tus/")

	// PATCH with wrong content type
	data := []byte("test")
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/tus/"+uploadID, bytes.NewReader(data))
	patchReq.Header.Set("Tus-Resumable", tusResumableVersion)
	patchReq.Header.Set("Upload-Offset", "0")
	patchReq.Header.Set("Content-Type", "text/plain") // Wrong content type
	patchRec := httptest.NewRecorder()
	patchCtx := e.NewContext(patchReq, patchRec)
	patchCtx.SetParamNames("id")
	patchCtx.SetParamValues(uploadID)
	patchCtx.Set(middleware.ContextKeyUserID, userID.String())

	err := handler.Patch(patchCtx)
	if err == nil {
		t.Fatal("Expected Patch to fail with wrong content type")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}

	if httpErr.Code != http.StatusUnsupportedMediaType {
		t.Errorf("Expected status %d, got %d", http.StatusUnsupportedMediaType, httpErr.Code)
	}
}

func TestParseTusMetadata(t *testing.T) {
	tests := []struct {
		name     string
		header   string
		expected map[string]string
	}{
		{
			name:     "empty header",
			header:   "",
			expected: map[string]string{},
		},
		{
			name:   "single key-value",
			header: fmt.Sprintf("filename %s", base64.StdEncoding.EncodeToString([]byte("test.txt"))),
			expected: map[string]string{
				"filename": "test.txt",
			},
		},
		{
			name: "multiple key-values",
			header: fmt.Sprintf("filename %s,mimeType %s",
				base64.StdEncoding.EncodeToString([]byte("test.txt")),
				base64.StdEncoding.EncodeToString([]byte("text/plain"))),
			expected: map[string]string{
				"filename": "test.txt",
				"mimeType": "text/plain",
			},
		},
		{
			name:   "key without value",
			header: "emptyKey",
			expected: map[string]string{
				"emptyKey": "",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseTusMetadata(tt.header)
			if len(result) != len(tt.expected) {
				t.Errorf("Expected %d keys, got %d", len(tt.expected), len(result))
			}
			for k, v := range tt.expected {
				if result[k] != v {
					t.Errorf("Expected %s=%s, got %s=%s", k, v, k, result[k])
				}
			}
		})
	}
}

func TestTusCreationWithUpload(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	e := echo.New()

	// Create an upload with initial data (creation-with-upload)
	data := []byte("Small file")
	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", "small.txt"),
		encodeMetadata("mimeType", "text/plain"),
	}, ",")

	createReq := httptest.NewRequest(http.MethodPost, "/api/tus", bytes.NewReader(data))
	createReq.Header.Set("Tus-Resumable", tusResumableVersion)
	createReq.Header.Set("Upload-Length", "10")
	createReq.Header.Set("Upload-Metadata", metadata)
	createReq.Header.Set("Content-Type", "application/offset+octet-stream")
	createRec := httptest.NewRecorder()
	createCtx := e.NewContext(createReq, createRec)
	createCtx.Set(middleware.ContextKeyUserID, userID.String())

	if err := handler.Create(createCtx); err != nil {
		t.Fatalf("Create with upload failed: %v", err)
	}

	if createRec.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d", http.StatusCreated, createRec.Code)
	}

	// Verify file was created immediately (upload complete in one request)
	var file models.File
	err := db.Where("library_id = ? AND name = ?", libraryID, "small.txt").First(&file).Error
	if err != nil {
		t.Errorf("Expected file to be created in database: %v", err)
	}

	if file.Size != 10 {
		t.Errorf("Expected file size 10, got %d", file.Size)
	}
}

func TestTusCleanOrphanedStagingFiles(t *testing.T) {
	handler, _, tempDir := setupTusTestHandler(t)
	defer handler.Stop()

	tusDir := filepath.Join(tempDir, ".tus-uploads")

	// Create orphaned staging files (no corresponding in-memory upload)
	orphan1 := filepath.Join(tusDir, "orphan-1")
	orphan2 := filepath.Join(tusDir, "orphan-2")
	if err := os.WriteFile(orphan1, []byte("data"), 0644); err != nil {
		t.Fatalf("Failed to create orphan1: %v", err)
	}
	if err := os.WriteFile(orphan2, []byte("data"), 0644); err != nil {
		t.Fatalf("Failed to create orphan2: %v", err)
	}

	// Verify files exist
	if _, err := os.Stat(orphan1); err != nil {
		t.Fatalf("Expected orphan1 to exist: %v", err)
	}

	handler.cleanOrphanedStagingFiles()

	// Verify orphaned files are removed
	if _, err := os.Stat(orphan1); !os.IsNotExist(err) {
		t.Error("Expected orphan1 to be removed")
	}
	if _, err := os.Stat(orphan2); !os.IsNotExist(err) {
		t.Error("Expected orphan2 to be removed")
	}
}

func TestTusCleanStaleUploads(t *testing.T) {
	handler, _, _ := setupTusTestHandler(t)
	defer handler.Stop()

	// Add a "stale" upload with CreatedAt 25 hours ago
	staleID := "stale-upload-1"
	handler.mu.Lock()
	handler.uploads[staleID] = &tusUpload{
		ID:        staleID,
		CreatedAt: time.Now().Add(-25 * time.Hour),
		Size:      100,
	}
	handler.mu.Unlock()

	// Create corresponding staging file
	stagingPath := handler.stagingPath(staleID)
	if err := os.WriteFile(stagingPath, []byte("data"), 0644); err != nil {
		t.Fatalf("Failed to create stale staging file: %v", err)
	}

	// Add a "fresh" upload
	freshID := "fresh-upload-1"
	handler.mu.Lock()
	handler.uploads[freshID] = &tusUpload{
		ID:        freshID,
		CreatedAt: time.Now(),
		Size:      100,
	}
	handler.mu.Unlock()

	freshStaging := handler.stagingPath(freshID)
	if err := os.WriteFile(freshStaging, []byte("data"), 0644); err != nil {
		t.Fatalf("Failed to create fresh staging file: %v", err)
	}

	handler.cleanStaleUploads()

	// Stale upload should be removed from map and disk
	handler.mu.RLock()
	_, staleExists := handler.uploads[staleID]
	_, freshExists := handler.uploads[freshID]
	handler.mu.RUnlock()

	if staleExists {
		t.Error("Expected stale upload to be removed from map")
	}
	if !freshExists {
		t.Error("Expected fresh upload to remain in map")
	}

	if _, err := os.Stat(stagingPath); !os.IsNotExist(err) {
		t.Error("Expected stale staging file to be removed")
	}
	if _, err := os.Stat(freshStaging); err != nil {
		t.Error("Expected fresh staging file to remain")
	}
}

func TestTusStop(t *testing.T) {
	handler, _, _ := setupTusTestHandler(t)
	// Verify Stop doesn't panic and can be called
	handler.Stop()
}

// uploadOneShot drives a creation-with-upload TUS request that finalizes in a
// single round-trip, returning the response recorder so the caller can inspect
// status + headers (in particular X-Alcoves-Duplicate-Count).
func uploadOneShot(t *testing.T, handler *TusHandler, e *echo.Echo, userID, libraryID uuid.UUID, filename string, data []byte) *httptest.ResponseRecorder {
	t.Helper()

	metadata := strings.Join([]string{
		encodeMetadata("libraryId", libraryID.String()),
		encodeMetadata("filename", filename),
		encodeMetadata("mimeType", "text/plain"),
	}, ",")

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

func TestTusFinishUploadDuplicateHeader(t *testing.T) {
	handler, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)

	// Second library owned by same user — used to verify dedup is per-library.
	otherLibrary := models.Library{ID: uuid.New(), OwnerID: userID, Name: "Other"}
	if err := db.Create(&otherLibrary).Error; err != nil {
		t.Fatalf("create other library: %v", err)
	}

	e := echo.New()
	payload := []byte("identical-bytes")

	rec1 := uploadOneShot(t, handler, e, userID, libraryID, "first.txt", payload)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first upload: expected 201, got %d", rec1.Code)
	}
	if got := rec1.Header().Get("X-Alcoves-Duplicate-Count"); got != "" {
		t.Fatalf("first upload should not flag dupes, got %q", got)
	}

	rec2 := uploadOneShot(t, handler, e, userID, libraryID, "second.txt", payload)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("second upload: expected 201, got %d", rec2.Code)
	}
	if got := rec2.Header().Get("X-Alcoves-Duplicate-Count"); got != "1" {
		t.Fatalf("second upload should flag 1 dupe, got %q", got)
	}

	rec3 := uploadOneShot(t, handler, e, userID, libraryID, "third.txt", payload)
	if got := rec3.Header().Get("X-Alcoves-Duplicate-Count"); got != "2" {
		t.Fatalf("third upload should flag 2 dupes, got %q", got)
	}

	// Same payload, different library — should NOT flag.
	rec4 := uploadOneShot(t, handler, e, userID, otherLibrary.ID, "in-other-lib.txt", payload)
	if got := rec4.Header().Get("X-Alcoves-Duplicate-Count"); got != "" {
		t.Fatalf("upload in other library should not flag dupes, got %q", got)
	}

	// Different payload in the original library — should NOT flag.
	rec5 := uploadOneShot(t, handler, e, userID, libraryID, "other-bytes.txt", []byte("different"))
	if got := rec5.Header().Get("X-Alcoves-Duplicate-Count"); got != "" {
		t.Fatalf("upload with unique content should not flag dupes, got %q", got)
	}
}
