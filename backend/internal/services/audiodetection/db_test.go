package audiodetection

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// audioTestDB connects to the local test Postgres, skipping when unavailable.
func audioTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_auddet")
	if err := db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.Folder{},
		&models.File{},
		&models.AudioDetection{},
	); err != nil {
		t.Skipf("auto-migrate not available: %v", err)
	}
	return db
}

func seedAudioFile(t *testing.T, db *gorm.DB, mimeType string) (libID, fileID uuid.UUID) {
	t.Helper()
	owner := models.User{ID: uuid.New(), Email: uuid.NewString() + "@t.local", DisplayName: "owner"}
	if err := db.Create(&owner).Error; err != nil {
		t.Skipf("could not seed user: %v", err)
	}
	libID = uuid.New()
	lib := models.Library{ID: libID, Name: "lib-" + libID.String()[:8], OwnerID: owner.ID}
	if err := db.Create(&lib).Error; err != nil {
		t.Skipf("could not seed library: %v", err)
	}
	fileID = uuid.New()
	f := models.File{ID: fileID, LibraryID: libID, Name: "clip", MimeType: mimeType}
	if err := db.Create(&f).Error; err != nil {
		t.Skipf("could not seed file: %v", err)
	}
	return libID, fileID
}

func TestListByFile_DB(t *testing.T) {
	db := audioTestDB(t)
	svc := NewService(db, nil, nil, &config.Config{}, nil)
	out, err := svc.ListByFile(uuid.New().String(), uuid.New().String())
	if err != nil {
		t.Fatalf("ListByFile: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected no detections for fresh file, got %d", len(out))
	}
}

func TestSetStateAndFail_DB(t *testing.T) {
	db := audioTestDB(t)
	_, fileID := seedAudioFile(t, db, "video/mp4")
	h := NewTaskHandler(db, nil, &config.Config{}, nil)

	zero := 0
	h.setState(fileID.String(), ptr("processing"), &zero, nil, nil)
	var f models.File
	if err := db.Where("id = ?", fileID).First(&f).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if f.AudioDetectStatus == nil || *f.AudioDetectStatus != "processing" {
		t.Errorf("status not set to processing: %v", f.AudioDetectStatus)
	}

	h.fail(fileID.String(), os.ErrInvalid)
	if err := db.Where("id = ?", fileID).First(&f).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if f.AudioDetectStatus == nil || *f.AudioDetectStatus != "failed" {
		t.Errorf("status not set to failed: %v", f.AudioDetectStatus)
	}
	if f.AudioDetectError == nil || *f.AudioDetectError == "" {
		t.Errorf("error message not recorded: %v", f.AudioDetectError)
	}
}

func TestRun_FileNotFoundSkips(t *testing.T) {
	db := audioTestDB(t)
	h := NewTaskHandler(db, nil, &config.Config{}, nil)
	// Nonexistent file id -> gorm.ErrRecordNotFound -> returns nil (skip).
	if err := h.run(context.Background(), uuid.New().String(), uuid.New().String()); err != nil {
		t.Fatalf("expected nil for missing file, got %v", err)
	}
}

func TestRun_NonAudioVideoSkips(t *testing.T) {
	db := audioTestDB(t)
	libID, fileID := seedAudioFile(t, db, "image/png")
	h := NewTaskHandler(db, nil, &config.Config{}, nil)
	// image/* is neither audio/ nor video/ -> early skip, returns nil.
	if err := h.run(context.Background(), libID.String(), fileID.String()); err != nil {
		t.Fatalf("expected nil for non-audio/video file, got %v", err)
	}
}

func TestCopySourceToTemp_OpenError(t *testing.T) {
	// A local storage driver pointed at an empty dir has no blobs, so
	// OpenFileReadStream fails — exercising copySourceToTemp's error branch
	// without needing real media.
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	st := storage.NewService(driver)
	h := NewTaskHandler(nil, st, &config.Config{}, nil)

	err := h.copySourceToTemp("lib-x", "file-x", filepath.Join(dir, "out"))
	if err == nil {
		t.Fatal("expected error opening a nonexistent source blob")
	}
}

func TestCopySourceToTemp_Success(t *testing.T) {
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	st := storage.NewService(driver)
	want := []byte("synthetic-media-bytes")
	if err := st.StoreFile("lib-y", "file-y", want); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	h := NewTaskHandler(nil, st, &config.Config{}, nil)
	out := filepath.Join(dir, "out")
	if err := h.copySourceToTemp("lib-y", "file-y", out); err != nil {
		t.Fatalf("copySourceToTemp: %v", err)
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read copied file: %v", err)
	}
	if string(got) != string(want) {
		t.Errorf("copied bytes = %q, want %q", got, want)
	}
}

func TestCopySourceToTemp_CreateDestError(t *testing.T) {
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	st := storage.NewService(driver)
	if err := st.StoreFile("lib-z", "file-z", []byte("data")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	h := NewTaskHandler(nil, st, &config.Config{}, nil)
	// Destination path under a nonexistent directory -> os.Create fails.
	err := h.copySourceToTemp("lib-z", "file-z", filepath.Join(dir, "missing-dir", "out"))
	if err == nil {
		t.Fatal("expected create error for unwritable destination path")
	}
}
