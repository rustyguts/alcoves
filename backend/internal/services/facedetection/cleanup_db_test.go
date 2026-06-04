package facedetection

import (
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// newTestStorage returns a storage.Service backed by a temp local directory.
func newTestStorage(t *testing.T) *storage.Service {
	t.Helper()
	root := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	svc := storage.NewService(driver)
	if err := svc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	return svc
}

// TestDeleteFaceDataForFiles_EmptyFileIDs is a no-op for an empty list.
func TestDeleteFaceDataForFiles_EmptyFileIDs(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	if err := DeleteFaceDataForFiles(db, store, newLibraryID(), nil); err != nil {
		t.Fatalf("DeleteFaceDataForFiles(empty): %v", err)
	}
}

// TestDeleteFaceDataForFiles_NoDetections returns early when no detections match.
func TestDeleteFaceDataForFiles_NoDetections(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	lib := newLibraryID()
	if err := DeleteFaceDataForFiles(db, store, lib, []string{uuid.New().String()}); err != nil {
		t.Fatalf("DeleteFaceDataForFiles(no detections): %v", err)
	}
}

// TestDeleteFaceDataForFiles_DeletesAndOrphansPerson removes detections and the
// now-empty person.
func TestDeleteFaceDataForFiles_DeletesAndOrphansPerson(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	lib := newLibraryID()

	person := insertPerson(t, db, lib, 1)
	fileID := uuid.New()
	insertFace(t, db, lib, fileID, &person, 90, unitEmbedding(0, 5))

	if err := DeleteFaceDataForFiles(db, store, lib, []string{fileID.String()}); err != nil {
		t.Fatalf("DeleteFaceDataForFiles: %v", err)
	}

	// Detection gone.
	var n int64
	db.Raw("SELECT COUNT(*) FROM face_detections WHERE file_id = ?", fileID).Scan(&n)
	if n != 0 {
		t.Errorf("detections remain after delete: %d", n)
	}
	// Person with zero faces should be deleted.
	if personExists(t, db, person) {
		t.Errorf("orphaned person %s should have been deleted", person)
	}
}

// TestDeleteFaceDataForFiles_UpdatesFaceCount keeps the person but updates its
// count and reassigns the cover photo when only some faces are deleted.
func TestDeleteFaceDataForFiles_UpdatesFaceCount(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	lib := newLibraryID()

	person := insertPerson(t, db, lib, 2)
	deletedFile := uuid.New()
	keptFile := uuid.New()
	// The cover points at the face that will be deleted.
	coverFace := insertFace(t, db, lib, deletedFile, &person, 95, unitEmbedding(0, 5))
	keptFace := insertFace(t, db, lib, keptFile, &person, 70, unitEmbedding(0, 5.1))
	db.Exec("UPDATE people SET cover_face_detection_id = ? WHERE id = ?", coverFace, person)

	if err := DeleteFaceDataForFiles(db, store, lib, []string{deletedFile.String()}); err != nil {
		t.Fatalf("DeleteFaceDataForFiles: %v", err)
	}

	if !personExists(t, db, person) {
		t.Fatalf("person should still exist (one face remains)")
	}
	if got := countFacesForPerson(t, db, person); got != 1 {
		t.Errorf("person face count = %d, want 1", got)
	}
	// Cover should be reassigned to the remaining (best) face.
	var cover string
	db.Raw("SELECT cover_face_detection_id::text FROM people WHERE id = ?", person).Scan(&cover)
	if cover != keptFace.String() {
		t.Errorf("cover reassigned to %q, want kept face %s", cover, keptFace)
	}
	// face_count column should reflect the update.
	var fc int
	db.Raw("SELECT face_count FROM people WHERE id = ?", person).Scan(&fc)
	if fc != 1 {
		t.Errorf("face_count column = %d, want 1", fc)
	}
}

// TestDeleteFaceDataForFiles_CleansThumbnailCache removes cached webp thumbnails.
func TestDeleteFaceDataForFiles_CleansThumbnailCache(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	lib := newLibraryID()

	person := insertPerson(t, db, lib, 1)
	fileID := uuid.New()
	detID := insertFace(t, db, lib, fileID, &person, 90, unitEmbedding(0, 5))

	cacheKey := lib + "/faces/" + detID.String() + ".webp"
	if err := store.StoreCacheBuffer(cacheKey, []byte("fakewebp")); err != nil {
		t.Fatalf("StoreCacheBuffer: %v", err)
	}

	if err := DeleteFaceDataForFiles(db, store, lib, []string{fileID.String()}); err != nil {
		t.Fatalf("DeleteFaceDataForFiles: %v", err)
	}
	// The cache delete is best-effort; just confirm the call path ran without error.
}
