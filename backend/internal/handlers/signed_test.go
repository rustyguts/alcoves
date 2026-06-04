package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/signing"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func setupSignedTest(t *testing.T) (*SignedHandler, *gorm.DB, *storage.Service, *signing.Signer, uuid.UUID, uuid.UUID) {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.Folder{}, &models.File{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	root := t.TempDir()
	driver := storage.NewLocalDriver(filepath.Join(root, "files"), filepath.Join(root, "avatars"), filepath.Join(root, "cache"))
	st := storage.NewService(driver)
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	ingestSvc := files.NewServiceWithIngest(db, files.IngestDeps{Storage: st})
	signer := signing.New("signed-handler-test-secret")
	h := NewSignedHandler(db, st, ingestSvc, signer)

	userID := uuid.New()
	db.Create(&models.User{ID: userID, Email: "signed@test.com", DisplayName: "Signed", Role: "member"})
	libID := uuid.New()
	db.Create(&models.Library{ID: libID, Name: "Signed Lib", OwnerID: userID})

	return h, db, st, signer, userID, libID
}

func TestSignedUpload_StreamsToIngest(t *testing.T) {
	h, db, st, signer, userID, libID := setupSignedTest(t)

	content := bytes.Repeat([]byte("z"), 2<<20) // 2 MiB
	token := signer.SignUpload(signing.UploadClaims{
		LibraryID: libID, OwnerID: userID, Name: "blob.bin", MimeType: "application/octet-stream",
	}, time.Now().Add(time.Hour))

	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/api/files/upload-signed?token="+token, bytes.NewReader(content))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := h.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}

	var f models.File
	if err := db.Where("library_id = ? AND name = ?", libID, "blob.bin").First(&f).Error; err != nil {
		t.Fatalf("file row not created: %v", err)
	}
	if f.Size != int64(len(content)) {
		t.Fatalf("size = %d, want %d", f.Size, len(content))
	}
	sum := sha256.Sum256(content)
	if f.Hash == nil || *f.Hash != hex.EncodeToString(sum[:]) {
		t.Fatalf("hash mismatch")
	}
	if ok, _ := st.FileExists(libID.String(), f.ID.String()); !ok {
		t.Fatalf("blob missing")
	}
}

func TestSignedUpload_InvalidToken(t *testing.T) {
	h, _, _, _, _, _ := setupSignedTest(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/api/files/upload-signed?token=garbage", bytes.NewReader([]byte("x")))
	c := e.NewContext(req, httptest.NewRecorder())
	err := h.Upload(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusForbidden {
		t.Fatalf("expected 403 HTTPError, got %v", err)
	}
}

func TestSignedUpload_ExceedsMaxSize(t *testing.T) {
	h, db, _, signer, userID, libID := setupSignedTest(t)
	token := signer.SignUpload(signing.UploadClaims{
		LibraryID: libID, OwnerID: userID, Name: "big.bin", MimeType: "application/octet-stream", MaxSize: 8,
	}, time.Now().Add(time.Hour))

	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/api/files/upload-signed?token="+token, bytes.NewReader(bytes.Repeat([]byte("a"), 1000)))
	c := e.NewContext(req, httptest.NewRecorder())
	err := h.Upload(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %v", err)
	}
	var count int64
	db.Model(&models.File{}).Where("library_id = ?", libID).Count(&count)
	if count != 0 {
		t.Fatalf("no file should be created when over max size, got %d", count)
	}
}

func TestSignedDownload_RangeAndFull(t *testing.T) {
	h, _, st, signer, _, libID := setupSignedTest(t)

	content := []byte("0123456789abcdef")
	fileID := uuid.New()
	if _, err := st.StoreFileStream(libID.String(), fileID.String(), bytes.NewReader(content)); err != nil {
		t.Fatal(err)
	}
	// Minimal File row so the handler's metadata lookup succeeds.
	h.db.Create(&models.File{ID: fileID, LibraryID: libID, Name: "f.txt", MimeType: "text/plain", Size: int64(len(content))})

	token := signer.SignDownload(libID, fileID, time.Now().Add(time.Hour))

	// Range request → 206 with the requested slice.
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/files/signed?token="+token, nil)
	req.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	if err := h.Download(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Download(range): %v", err)
	}
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want 206", rec.Code)
	}
	if got := rec.Body.String(); got != "0123" {
		t.Fatalf("range body = %q, want 0123", got)
	}
	if cr := rec.Header().Get("Content-Range"); cr != "bytes 0-3/16" {
		t.Fatalf("Content-Range = %q", cr)
	}

	// Full request → 200 with all bytes.
	req2 := httptest.NewRequest(http.MethodGet, "/api/files/signed?token="+token, nil)
	rec2 := httptest.NewRecorder()
	if err := h.Download(e.NewContext(req2, rec2)); err != nil {
		t.Fatalf("Download(full): %v", err)
	}
	if rec2.Code != http.StatusOK || rec2.Body.String() != string(content) {
		t.Fatalf("full download wrong: code=%d body=%q", rec2.Code, rec2.Body.String())
	}
}

func TestSignedDownload_InvalidToken(t *testing.T) {
	h, _, _, _, _, _ := setupSignedTest(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/files/signed?token=nope", nil)
	err := h.Download(e.NewContext(req, httptest.NewRecorder()))
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %v", err)
	}
}
