package metadata

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func tTime() *time.Time { now := time.Now(); return &now }

func setupMetadataTestDB(t *testing.T) (*gorm.DB, uuid.UUID) {
	t.Helper()

	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.File{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Exec("DELETE FROM files")
	db.Exec("DELETE FROM libraries")
	db.Exec("DELETE FROM users")

	userID := uuid.New()
	db.Create(&models.User{ID: userID, Email: userID.String()[:8] + "@t.com", DisplayName: "U", Role: "owner"})
	libID := uuid.New()
	db.Create(&models.Library{ID: libID, Name: "L", OwnerID: userID})
	return db, libID
}

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

func TestScanPendingMetadata(t *testing.T) {
	db, libID := setupMetadataTestDB(t)

	mk := func(name, mime string, f models.File) uuid.UUID {
		f.LibraryID = libID
		f.Name = name
		f.MimeType = mime
		f.Size = 1
		if err := db.Create(&f).Error; err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return f.ID
	}

	// Eligible: never extracted, under the cap, not in flight.
	wantInclude := mk("pending.jpg", "image/jpeg", models.File{})
	// Eligible: a previously-failed file under the cap is retryable.
	wantRetry := mk("failed.mp4", "video/mp4", models.File{MetadataAttempts: 1, MetadataStatus: strPtr("failed")})

	// Excluded cases.
	mk("exhausted.jpg", "image/jpeg", models.File{MetadataAttempts: maxMetadataAttempts}) // 3-strike cap
	mk("done.jpg", "image/jpeg", models.File{MetadataExtractedVersion: intPtr(1)})        // already extracted
	mk("doc.txt", "text/plain", models.File{})                                            // not media
	mk("inflight.jpg", "image/jpeg", models.File{MetadataStatus: strPtr("queued")})       // in flight (fresh)
	mk("trashed.jpg", "image/jpeg", models.File{TrashedAt: tTime()})                      // trashed

	derivedSrc := uuid.New()
	mk("derived.jpg", "image/jpeg", models.File{SourceFileID: &derivedSrc}) // derived

	rows, err := scanPendingMetadata(db, 100)
	if err != nil {
		t.Fatal(err)
	}

	got := map[string]bool{}
	for _, r := range rows {
		got[r.ID] = true
	}
	if len(got) != 2 || !got[wantInclude.String()] || !got[wantRetry.String()] {
		t.Fatalf("scan returned %d rows %v, want exactly {%s, %s}", len(rows), got, wantInclude, wantRetry)
	}
}
