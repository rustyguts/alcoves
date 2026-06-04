package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func newIngestService(t *testing.T) (*Service, *gorm.DB, *storage.Service) {
	t.Helper()
	db := setupListingTestDB(t)
	// Fully isolate from rows other packages left in the shared test DB.
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")
	root := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	st := storage.NewService(driver)
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	svc := NewServiceWithIngest(db, IngestDeps{Storage: st})
	return svc, db, st
}

func TestIngestStream_CreatesFileWithHash(t *testing.T) {
	svc, db, st := newIngestService(t)
	fx := seedListingLibrary(t, db)

	content := "hello mcp world"
	res, err := svc.IngestStream(context.Background(), IngestParams{
		LibraryID: fx.LibraryID, OwnerID: fx.UserID, Name: "hello.txt", MimeType: "text/plain",
	}, strings.NewReader(content))
	if err != nil {
		t.Fatalf("IngestStream: %v", err)
	}

	if res.File.Size != int64(len(content)) {
		t.Fatalf("size = %d, want %d", res.File.Size, len(content))
	}
	sum := sha256.Sum256([]byte(content))
	if res.File.Hash == nil || *res.File.Hash != hex.EncodeToString(sum[:]) {
		t.Fatalf("hash mismatch: %v", res.File.Hash)
	}
	if ok, _ := st.FileExists(fx.LibraryID.String(), res.File.ID.String()); !ok {
		t.Fatalf("blob not stored")
	}

	var f models.File
	if err := db.Where("id = ?", res.File.ID).First(&f).Error; err != nil {
		t.Fatalf("file row not found: %v", err)
	}
	if f.Name != "hello.txt" || f.OwnerID == nil || *f.OwnerID != fx.UserID {
		t.Fatalf("file row fields wrong: name=%s owner=%v", f.Name, f.OwnerID)
	}
}

func TestIngestStream_Dedup(t *testing.T) {
	svc, db, _ := newIngestService(t)
	fx := seedListingLibrary(t, db)
	content := "duplicate me"

	r1, err := svc.IngestStream(context.Background(), IngestParams{
		LibraryID: fx.LibraryID, OwnerID: fx.UserID, Name: "a.txt", MimeType: "text/plain",
	}, strings.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	if r1.DuplicateCount != 0 {
		t.Fatalf("first upload DuplicateCount = %d, want 0", r1.DuplicateCount)
	}

	r2, err := svc.IngestStream(context.Background(), IngestParams{
		LibraryID: fx.LibraryID, OwnerID: fx.UserID, Name: "b.txt", MimeType: "text/plain",
	}, strings.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	if r2.DuplicateCount != 1 {
		t.Fatalf("second upload DuplicateCount = %d, want 1", r2.DuplicateCount)
	}
}

func TestIngestStream_ContextCanceledNoRow(t *testing.T) {
	svc, db, _ := newIngestService(t)
	fx := seedListingLibrary(t, db)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // canceled before the copy starts

	_, err := svc.IngestStream(ctx, IngestParams{
		LibraryID: fx.LibraryID, OwnerID: fx.UserID, Name: "x.txt", MimeType: "text/plain",
	}, strings.NewReader("some data"))
	if err == nil {
		t.Fatalf("expected error for canceled context")
	}

	var count int64
	db.Model(&models.File{}).Where("library_id = ?", fx.LibraryID).Count(&count)
	if count != 0 {
		t.Fatalf("expected 0 file rows after canceled ingest, got %d", count)
	}
}

func TestIngestStream_NotConfigured(t *testing.T) {
	db := setupListingTestDB(t)
	svc := NewService(db) // read-only, no ingest deps
	_, err := svc.IngestStream(context.Background(), IngestParams{}, strings.NewReader("x"))
	if err == nil {
		t.Fatalf("expected error when ingest is not configured")
	}
}
