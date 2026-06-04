package metadata

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// newTestHandler wires a TaskHandler against the shared test DB and a local
// storage driver rooted at a throwaway temp dir (so blobs are absent unless a
// test writes them).
func newTestHandler(t *testing.T) (*TaskHandler, *gorm.DB, uuid.UUID) {
	t.Helper()
	db, libID := setupMetadataTestDB(t)
	dir := t.TempDir()
	storageSvc := storage.NewService(storage.NewLocalDriver(dir, dir, dir))
	return NewTaskHandler(db, storageSvc, &config.Config{}), db, libID
}

func TestRun_TransientStorageErrorDoesNotBurnAttempt(t *testing.T) {
	h, db, libID := newTestHandler(t)

	// Image row with no blob on disk → ReadFileBuffer fails (infrastructure).
	f := models.File{LibraryID: libID, Name: "missing.jpg", MimeType: "image/jpeg", Size: 1}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := h.run(context.Background(), libID.String(), f.ID.String()); err == nil {
		t.Fatal("expected a transient error from the missing blob")
	}

	var got models.File
	if err := db.First(&got, "id = ?", f.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.MetadataAttempts != 0 {
		t.Fatalf("transient failure burned an attempt: metadata_attempts = %d, want 0", got.MetadataAttempts)
	}
	if got.MetadataStatus == nil || *got.MetadataStatus != "failed" {
		t.Fatalf("metadata_status = %v, want failed", got.MetadataStatus)
	}
}

func TestFailVsFailTransient_AttemptCounter(t *testing.T) {
	h, db, libID := newTestHandler(t)

	mk := func(name string) uuid.UUID {
		f := models.File{LibraryID: libID, Name: name, MimeType: "image/jpeg", Size: 1}
		if err := db.Create(&f).Error; err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return f.ID
	}
	counted := mk("counted.jpg")
	transient := mk("transient.jpg")

	_ = h.fail(counted.String(), context.DeadlineExceeded)
	_ = h.failTransient(transient.String(), context.DeadlineExceeded)

	attempts := func(id uuid.UUID) int {
		var f models.File
		if err := db.First(&f, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		return f.MetadataAttempts
	}
	if got := attempts(counted); got != 1 {
		t.Fatalf("fail(): metadata_attempts = %d, want 1", got)
	}
	if got := attempts(transient); got != 0 {
		t.Fatalf("failTransient(): metadata_attempts = %d, want 0", got)
	}
}

func TestComplete_VersionGuard(t *testing.T) {
	h, db, libID := newTestHandler(t)

	f := models.File{LibraryID: libID, Name: "v.jpg", MimeType: "image/jpeg", Size: 1, MetadataVersion: 2}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create: %v", err)
	}

	when := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	ex := extracted{CapturedAt: &when, GpsLat: f64(12.5), GpsLon: f64(-7.25)}

	// Stale version → no-op.
	if h.complete(f.ID.String(), 1, ex) {
		t.Fatal("complete() with a stale version should return false")
	}
	var afterStale models.File
	_ = db.First(&afterStale, "id = ?", f.ID).Error
	if afterStale.CapturedAt != nil || afterStale.MetadataExtractedVersion != nil {
		t.Fatalf("stale complete() wrote data: captured_at=%v extracted=%v", afterStale.CapturedAt, afterStale.MetadataExtractedVersion)
	}

	// Matching version → applied.
	if !h.complete(f.ID.String(), 2, ex) {
		t.Fatal("complete() with the matching version should return true")
	}
	var afterMatch models.File
	_ = db.First(&afterMatch, "id = ?", f.ID).Error
	if afterMatch.CapturedAt == nil || !afterMatch.CapturedAt.Equal(when) {
		t.Fatalf("captured_at = %v, want %v", afterMatch.CapturedAt, when)
	}
	if afterMatch.MetadataExtractedVersion == nil || *afterMatch.MetadataExtractedVersion != 2 {
		t.Fatalf("metadata_extracted_version = %v, want 2", afterMatch.MetadataExtractedVersion)
	}
	if afterMatch.MetadataStatus == nil || *afterMatch.MetadataStatus != "ready" {
		t.Fatalf("metadata_status = %v, want ready", afterMatch.MetadataStatus)
	}
}

func f64(v float64) *float64 { return &v }
