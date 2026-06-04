package facedetection

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// ensureFilesTable makes sure a usable files table exists for the bulk-enqueue
// query. The shared test database already provides the canonical files table
// (with extra NOT NULL columns that have defaults); if it is somehow absent we
// create a minimal stand-in. We never drop the real table.
func ensureFilesTable(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS files (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			library_id UUID NOT NULL,
			name TEXT NOT NULL DEFAULT 'test',
			mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
			trashed_at TIMESTAMPTZ
		)
	`).Error; err != nil {
		t.Skipf("Skipping: cannot ensure files table: %v", err)
	}
}

// mustLibrary creates a real user + library so files can satisfy the
// fk_files_library foreign key, returning the library ID as a string.
func mustLibrary(t *testing.T, db *gorm.DB) string {
	t.Helper()
	u := models.User{Email: uuid.New().String() + "@example.com", DisplayName: "t", Role: "member"}
	if err := db.Create(&u).Error; err != nil {
		t.Skipf("Skipping: cannot create user: %v", err)
	}
	lib := models.Library{Name: "test-lib", OwnerID: u.ID}
	if err := db.Create(&lib).Error; err != nil {
		t.Skipf("Skipping: cannot create library: %v", err)
	}
	t.Cleanup(func() {
		db.Exec("DELETE FROM files WHERE library_id = ?", lib.ID)
		db.Exec("DELETE FROM libraries WHERE id = ?", lib.ID)
		db.Exec("DELETE FROM users WHERE id = ?", u.ID)
	})
	return lib.ID.String()
}

func insertFile(t *testing.T, db *gorm.DB, libraryID string, mime string, trashed bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if trashed {
		if err := db.Exec(`INSERT INTO files (id, library_id, name, mime_type, trashed_at) VALUES (?, ?, ?, ?, NOW())`, id, libraryID, "test", mime).Error; err != nil {
			t.Fatalf("insertFile trashed: %v", err)
		}
	} else {
		if err := db.Exec(`INSERT INTO files (id, library_id, name, mime_type) VALUES (?, ?, ?, ?)`, id, libraryID, "test", mime).Error; err != nil {
			t.Fatalf("insertFile: %v", err)
		}
	}
	return id
}

func newAsynqClient(t *testing.T) *asynq.Client {
	t.Helper()
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// TestEnqueueExistingLibraryImages enqueues only the un-detected, non-trashed images.
func TestEnqueueExistingLibraryImages(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	client := newAsynqClient(t)
	lib := mustLibrary(t, db)

	// Image with no detection -> should enqueue.
	insertFile(t, db, lib, "image/jpeg", false)
	insertFile(t, db, lib, "image/png", false)
	// Non-image -> skip.
	insertFile(t, db, lib, "video/mp4", false)
	// Trashed image -> skip.
	insertFile(t, db, lib, "image/jpeg", true)
	// Image that already has a detection -> skip.
	withDetection := insertFile(t, db, lib, "image/jpeg", false)
	insertFace(t, db, lib, withDetection, nil, 80, unitEmbedding(0, 5))

	n, err := EnqueueExistingLibraryImages(client, db, lib)
	if err != nil {
		t.Fatalf("EnqueueExistingLibraryImages: %v", err)
	}
	if n != 2 {
		t.Errorf("enqueued = %d, want 2", n)
	}
}

// TestEnqueueExistingLibraryImages_Empty handles a library with no eligible files.
func TestEnqueueExistingLibraryImages_Empty(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	client := newAsynqClient(t)

	n, err := EnqueueExistingLibraryImages(client, db, newLibraryID())
	if err != nil {
		t.Fatalf("EnqueueExistingLibraryImages(empty): %v", err)
	}
	if n != 0 {
		t.Errorf("enqueued = %d, want 0", n)
	}
}

// TestDeleteLibraryFaceData removes all detections and people for a library.
func TestDeleteLibraryFaceData(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	lib := newLibraryID()

	person := insertPerson(t, db, lib, 1)
	insertFace(t, db, lib, uuid.New(), &person, 90, unitEmbedding(0, 5))
	// Another library's data should be untouched.
	otherLib := newLibraryID()
	otherPerson := insertPerson(t, db, otherLib, 1)
	insertFace(t, db, otherLib, uuid.New(), &otherPerson, 90, unitEmbedding(0, 5))

	if err := DeleteLibraryFaceData(db, store, lib); err != nil {
		t.Fatalf("DeleteLibraryFaceData: %v", err)
	}

	var faces, people int64
	db.Model(&models.FaceDetection{}).Where("library_id = ?", lib).Count(&faces)
	db.Model(&models.Person{}).Where("library_id = ?", lib).Count(&people)
	if faces != 0 || people != 0 {
		t.Errorf("library data not fully deleted: faces=%d people=%d", faces, people)
	}
	// Other library untouched.
	if !personExists(t, db, otherPerson) {
		t.Errorf("other library's person should be preserved")
	}
}

// TestReprocessLibraryFaceData deletes existing data then re-enqueues images.
func TestReprocessLibraryFaceData(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	client := newAsynqClient(t)
	lib := mustLibrary(t, db)

	// One existing detection + person to be wiped.
	person := insertPerson(t, db, lib, 1)
	existingFile := insertFile(t, db, lib, "image/jpeg", false)
	insertFace(t, db, lib, existingFile, &person, 90, unitEmbedding(0, 5))
	// One fresh image with no detection.
	insertFile(t, db, lib, "image/png", false)

	n, err := ReprocessLibraryFaceData(client, db, store, lib)
	if err != nil {
		t.Fatalf("ReprocessLibraryFaceData: %v", err)
	}
	// After deletion both files have no detections -> both enqueued.
	if n != 2 {
		t.Errorf("re-enqueued = %d, want 2", n)
	}
	if personExists(t, db, person) {
		t.Errorf("person should have been deleted during reprocess")
	}
}
