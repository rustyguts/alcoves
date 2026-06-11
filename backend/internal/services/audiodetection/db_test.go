package audiodetection

import (
	"context"
	"errors"
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
	owner := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: uuid.NewString() + "@t.local", DisplayName: "owner"}
	if err := db.Create(&owner).Error; err != nil {
		t.Skipf("could not seed user: %v", err)
	}
	libID = uuid.New()
	lib := models.Library{BaseModel: models.BaseModel{ID: libID}, Name: "lib-" + libID.String()[:8], OwnerID: owner.ID}
	if err := db.Create(&lib).Error; err != nil {
		t.Skipf("could not seed library: %v", err)
	}
	fileID = uuid.New()
	f := models.File{BaseModel: models.BaseModel{ID: fileID}, LibraryID: libID, Name: "clip", MimeType: mimeType}
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

func TestComplete_MatchingVersionReplacesDetections(t *testing.T) {
	db := audioTestDB(t)
	libID, fileID := seedAudioFile(t, db, "audio/wav")
	h := NewTaskHandler(db, nil, &config.Config{}, nil)

	// Simulate a reprocess: a version-1 run already completed (one persisted
	// detection), then the trigger bumped audio_detect_version to 2 and the
	// version-2 run is now finishing.
	if err := db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"audio_detect_version":   2,
		"audio_detected_version": 1,
	}).Error; err != nil {
		t.Fatalf("seed versions: %v", err)
	}
	old := models.AudioDetection{FileID: fileID, LibraryID: libID, Label: "Music", ClassIndex: 137, Score: 0.5, StartSeconds: 0, EndSeconds: 1, Version: 1}
	if err := db.Create(&old).Error; err != nil {
		t.Fatalf("seed old detection: %v", err)
	}

	dets := []models.AudioDetection{{FileID: fileID, LibraryID: libID, Label: "Speech", ClassIndex: 0, Score: 0.9, StartSeconds: 0, EndSeconds: 2, Version: 2}}
	if err := h.complete(fileID, 2, dets, DefaultModelID); err != nil {
		t.Fatalf("complete: %v", err)
	}

	var f models.File
	if err := db.Where("id = ?", fileID).First(&f).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if f.AudioDetectStatus == nil || *f.AudioDetectStatus != "ready" {
		t.Errorf("audio_detect_status = %v, want ready", f.AudioDetectStatus)
	}
	// The worker must never bump audio_detect_version — the trigger side owns it.
	if f.AudioDetectVersion != 2 {
		t.Errorf("audio_detect_version = %d, want 2 (unchanged)", f.AudioDetectVersion)
	}
	if f.AudioDetectedVersion == nil || *f.AudioDetectedVersion != 2 {
		t.Errorf("audio_detected_version = %v, want 2", f.AudioDetectedVersion)
	}
	if f.AudioDetectModel == nil || *f.AudioDetectModel != DefaultModelID {
		t.Errorf("audio_detect_model = %v, want %s", f.AudioDetectModel, DefaultModelID)
	}

	var got []models.AudioDetection
	if err := db.Where("file_id = ?", fileID).Find(&got).Error; err != nil {
		t.Fatalf("query detections: %v", err)
	}
	if len(got) != 1 || got[0].Label != "Speech" || got[0].Version != 2 {
		t.Errorf("detections = %+v, want one Speech row at version 2", got)
	}
}

func TestComplete_SupersededRollsBackStaleWork(t *testing.T) {
	db := audioTestDB(t)
	libID, fileID := seedAudioFile(t, db, "audio/wav")
	h := NewTaskHandler(db, nil, &config.Config{}, nil)

	// A version-1 run is in flight when a reprocess lands: the trigger bumps
	// audio_detect_version to 2 and resets the status to queued. The stale
	// run's completion (targeting version 1) must roll back wholesale.
	if err := db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"audio_detect_status":    "queued",
		"audio_detect_progress":  0,
		"audio_detect_version":   2,
		"audio_detected_version": 1,
	}).Error; err != nil {
		t.Fatalf("seed versions: %v", err)
	}
	keep := models.AudioDetection{FileID: fileID, LibraryID: libID, Label: "Music", ClassIndex: 137, Score: 0.5, StartSeconds: 0, EndSeconds: 1, Version: 1}
	if err := db.Create(&keep).Error; err != nil {
		t.Fatalf("seed existing detection: %v", err)
	}

	stale := []models.AudioDetection{{FileID: fileID, LibraryID: libID, Label: "Speech", ClassIndex: 0, Score: 0.9, StartSeconds: 0, EndSeconds: 2, Version: 1}}
	err := h.complete(fileID, 1, stale, DefaultModelID)
	// run() maps errSuperseded to a clean nil return (no fail()): the discard
	// is logged, never surfaced as a job failure.
	if !errors.Is(err, errSuperseded) {
		t.Fatalf("complete = %v, want errSuperseded", err)
	}

	// The fresh job's queued state and versions must be untouched.
	var f models.File
	if err := db.Where("id = ?", fileID).First(&f).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if f.AudioDetectStatus == nil || *f.AudioDetectStatus != "queued" {
		t.Errorf("audio_detect_status = %v, want queued (untouched)", f.AudioDetectStatus)
	}
	if f.AudioDetectVersion != 2 {
		t.Errorf("audio_detect_version = %d, want 2 (untouched)", f.AudioDetectVersion)
	}
	if f.AudioDetectedVersion == nil || *f.AudioDetectedVersion != 1 {
		t.Errorf("audio_detected_version = %v, want 1 (untouched)", f.AudioDetectedVersion)
	}
	if f.AudioDetectModel != nil {
		t.Errorf("audio_detect_model = %v, want nil (untouched)", f.AudioDetectModel)
	}

	// The delete+insert must have rolled back with the guard miss: the
	// existing detection survives, the stale rows never land.
	var got []models.AudioDetection
	if err := db.Where("file_id = ?", fileID).Find(&got).Error; err != nil {
		t.Fatalf("query detections: %v", err)
	}
	if len(got) != 1 || got[0].ID != keep.ID || got[0].Label != "Music" || got[0].Version != 1 {
		t.Errorf("detections = %+v, want the original Music row at version 1", got)
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
