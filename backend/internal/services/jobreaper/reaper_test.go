package jobreaper

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

func specByName(t *testing.T, name string) spec {
	t.Helper()
	for _, sp := range specs {
		if sp.name == name {
			return sp
		}
	}
	t.Fatalf("no spec named %q", name)
	return spec{}
}

func TestSelectOrphans(t *testing.T) {
	candidates := []string{"a", "b", "c", "d"}
	live := map[string]struct{}{"b": {}, "d": {}}

	got := selectOrphans(candidates, live)
	if len(got) != 2 || got[0] != "a" || got[1] != "c" {
		t.Fatalf("selectOrphans = %v, want [a c]", got)
	}

	// Nothing live → everything is an orphan.
	if all := selectOrphans(candidates, map[string]struct{}{}); len(all) != 4 {
		t.Fatalf("empty live set should orphan all 4, got %v", all)
	}
	// All live → nothing reaped.
	allLive := map[string]struct{}{"a": {}, "b": {}, "c": {}, "d": {}}
	if none := selectOrphans(candidates, allLive); len(none) != 0 {
		t.Fatalf("fully-live set should orphan none, got %v", none)
	}
}

func TestPayloadID(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		field   string
		want    string
	}{
		{"file id", `{"libraryId":"lib","fileId":"f1"}`, "fileId", "f1"},
		{"moment id", `{"momentId":"m1","fileId":"f1","libraryId":"lib"}`, "momentId", "m1"},
		{"missing field", `{"libraryId":"lib"}`, "fileId", ""},
		{"non-string field", `{"fileId":42}`, "fileId", ""},
		{"empty payload", ``, "fileId", ""},
		{"garbage", `not json`, "fileId", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := payloadID([]byte(c.payload), c.field); got != c.want {
				t.Fatalf("payloadID(%q,%q) = %q, want %q", c.payload, c.field, got, c.want)
			}
		})
	}
}

// setupReaperTestDB scopes the reaper's global, library-agnostic queries to
// their own PostgreSQL schema so concurrent test packages don't pollute the scan.
func setupReaperTestDB(t *testing.T) (*gorm.DB, uuid.UUID) {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_jobreaper")
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.File{}, &models.Moment{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Exec("DELETE FROM moments")
	db.Exec("DELETE FROM files")
	db.Exec("DELETE FROM libraries")
	db.Exec("DELETE FROM users")

	userID := uuid.New()
	db.Create(&models.User{ID: userID, Email: userID.String()[:8] + "@t.com", DisplayName: "U", Role: "owner"})
	libID := uuid.New()
	db.Create(&models.Library{ID: libID, Name: "L", OwnerID: userID})
	return db, libID
}

// backdate forces updated_at older than the grace window so a row qualifies as a
// candidate; GORM stamps updated_at = now() on create.
func backdate(t *testing.T, db *gorm.DB, table, id string) {
	t.Helper()
	if err := db.Exec(
		"UPDATE "+table+" SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = ?", id,
	).Error; err != nil {
		t.Fatalf("backdate %s/%s: %v", table, id, err)
	}
}

func TestCandidatesAndMarkFailed_Files(t *testing.T) {
	db, libID := setupReaperTestDB(t)
	svc := NewService(db, nil) // inspector unused by candidates/markFailed
	sp := specByName(t, "transcribe")

	mk := func(name string, f models.File) uuid.UUID {
		f.LibraryID = libID
		f.Name = name
		f.MimeType = "video/mp4"
		f.Size = 1
		if err := db.Create(&f).Error; err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return f.ID
	}
	now := time.Now()

	// Stale + non-terminal → candidate.
	stuck := mk("stuck.mp4", models.File{TranscribeStatus: strPtr("processing"), TranscribeProgress: intPtr(40)})
	backdate(t, db, "files", stuck.String())
	queuedStale := mk("queued.mp4", models.File{TranscribeStatus: strPtr("queued")})
	backdate(t, db, "files", queuedStale.String())

	// Excluded cases.
	mk("fresh.mp4", models.File{TranscribeStatus: strPtr("processing")})            // within grace
	mk("done.mp4", models.File{TranscribeStatus: strPtr("ready")})                  // terminal
	mk("failed.mp4", models.File{TranscribeStatus: strPtr("failed")})               // terminal
	trashed := mk("trashed.mp4", models.File{TranscribeStatus: strPtr("processing"), TrashedAt: &now}) // trashed
	backdate(t, db, "files", trashed.String())

	got, err := svc.candidates(sp)
	if err != nil {
		t.Fatalf("candidates: %v", err)
	}
	set := map[string]bool{}
	for _, id := range got {
		set[id] = true
	}
	if len(set) != 2 || !set[stuck.String()] || !set[queuedStale.String()] {
		t.Fatalf("candidates = %v, want {%s, %s}", got, stuck, queuedStale)
	}

	// markFailed transitions the two stale non-terminal rows (the status-guard
	// behaviour for already-terminal rows is covered by TestMarkFailed_StatusGuard).
	n, err := svc.markFailed(sp, []string{stuck.String(), queuedStale.String()})
	if err != nil {
		t.Fatalf("markFailed: %v", err)
	}
	if n != 2 {
		t.Fatalf("markFailed affected %d rows, want 2", n)
	}

	var reaped models.File
	if err := db.First(&reaped, "id = ?", stuck).Error; err != nil {
		t.Fatal(err)
	}
	if reaped.TranscribeStatus == nil || *reaped.TranscribeStatus != "failed" {
		t.Fatalf("status = %v, want failed", reaped.TranscribeStatus)
	}
	if reaped.TranscribeError == nil || *reaped.TranscribeError != orphanReason {
		t.Fatalf("error = %v, want %q", reaped.TranscribeError, orphanReason)
	}
	if reaped.TranscribeProgress != nil {
		t.Fatalf("progress = %v, want nil (cleared)", *reaped.TranscribeProgress)
	}
}

func TestMarkFailed_StatusGuard(t *testing.T) {
	db, libID := setupReaperTestDB(t)
	svc := NewService(db, nil)
	sp := specByName(t, "transcribe")

	// A row that finished between scan and update must NOT be overwritten.
	done := models.File{LibraryID: libID, Name: "won-the-race.mp4", MimeType: "video/mp4", Size: 1, TranscribeStatus: strPtr("ready")}
	if err := db.Create(&done).Error; err != nil {
		t.Fatal(err)
	}

	n, err := svc.markFailed(sp, []string{done.ID.String()})
	if err != nil {
		t.Fatalf("markFailed: %v", err)
	}
	if n != 0 {
		t.Fatalf("status guard failed: affected %d rows, want 0", n)
	}
	var after models.File
	db.First(&after, "id = ?", done.ID)
	if after.TranscribeStatus == nil || *after.TranscribeStatus != "ready" {
		t.Fatalf("terminal row was clobbered: %v", after.TranscribeStatus)
	}
}

func TestCandidatesAndMarkFailed_Moments(t *testing.T) {
	db, libID := setupReaperTestDB(t)
	svc := NewService(db, nil)
	sp := specByName(t, "moment-export")

	// A moment needs an owning file.
	file := models.File{LibraryID: libID, Name: "src.mp4", MimeType: "video/mp4", Size: 1}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	userID := uuid.New()
	db.Create(&models.User{ID: userID, Email: userID.String()[:8] + "@t.com", DisplayName: "C", Role: "viewer"})

	m := models.Moment{
		FileID: file.ID, LibraryID: libID, CreatedByID: userID,
		Name: "clip", StartSeconds: 0, EndSeconds: 5,
		ExportStatus: strPtr("processing"), ExportProgress: intPtr(10),
	}
	if err := db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	backdate(t, db, "moments", m.ID.String())

	got, err := svc.candidates(sp)
	if err != nil {
		t.Fatalf("candidates: %v", err)
	}
	if len(got) != 1 || got[0] != m.ID.String() {
		t.Fatalf("candidates = %v, want {%s}", got, m.ID)
	}

	if _, err := svc.markFailed(sp, got); err != nil {
		t.Fatalf("markFailed: %v", err)
	}
	var after models.Moment
	db.First(&after, "id = ?", m.ID)
	if after.ExportStatus == nil || *after.ExportStatus != "failed" {
		t.Fatalf("status = %v, want failed", after.ExportStatus)
	}
	if after.ExportProgress != nil {
		t.Fatalf("progress = %v, want nil", *after.ExportProgress)
	}
}
