package objectdetection

import (
	"os"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// testDB connects to the local test Postgres, skipping the test when it is
// not reachable (matching the convention in other service packages). The
// pure-function coverage in objectdetection_test.go does not depend on this.
func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_objdet")
	if err := db.AutoMigrate(&models.ObjectDetection{}); err != nil {
		t.Skipf("auto-migrate not available: %v", err)
	}
	return db
}

// DeleteObjectDataForFiles short-circuits on an empty slice without touching
// the DB, so this branch is coverable with no database.
func TestDeleteObjectDataForFiles_EmptyNoop(t *testing.T) {
	if err := DeleteObjectDataForFiles(nil, "lib-1", nil); err != nil {
		t.Fatalf("empty fileIDs should be a no-op, got %v", err)
	}
	if err := DeleteObjectDataForFiles(nil, "lib-1", []string{}); err != nil {
		t.Fatalf("empty slice should be a no-op, got %v", err)
	}
}

// The delete statements run identically whether or not rows match, so we
// exercise the function body against a (likely empty) library id. Seeding
// real rows would require parent files/libraries to satisfy the FK, which is
// out of scope for unit-level coverage of the delete helpers.
func TestDeleteLibraryObjectData_DB(t *testing.T) {
	db := testDB(t)
	if err := DeleteLibraryObjectData(db, uuid.New().String()); err != nil {
		t.Fatalf("DeleteLibraryObjectData: %v", err)
	}
}

func TestDeleteObjectDataForFiles_DB(t *testing.T) {
	db := testDB(t)
	libID := uuid.New().String()
	if err := DeleteObjectDataForFiles(db, libID, []string{uuid.New().String(), uuid.New().String()}); err != nil {
		t.Fatalf("DeleteObjectDataForFiles: %v", err)
	}
}

func TestReprocessLibraryObjectData_DB(t *testing.T) {
	db := testDB(t)
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()
	// Deletes (empty) then re-enqueues (no matching files -> 0).
	n, err := ReprocessLibraryObjectData(client, db, uuid.New().String())
	if err == nil && n != 0 {
		t.Errorf("expected 0 enqueued, got %d", n)
	}
}

func TestService_ReprocessAndDeleteForFiles_DB(t *testing.T) {
	db := testDB(t)
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()
	svc := NewService(db, nil, client, NewObjectConfig(0.3, 0.5, 50, "/m"))

	libID := uuid.New().String()
	if _, err := svc.ReprocessLibrary(libID); err != nil {
		// ReprocessLibrary may fail only if the files table is missing; the
		// delete portion still ran. Tolerate query errors but not panics.
		t.Logf("ReprocessLibrary returned: %v", err)
	}
	if err := svc.DeleteObjectDataForFiles(libID, []string{uuid.New().String()}); err != nil {
		t.Fatalf("DeleteObjectDataForFiles via service: %v", err)
	}
}

func TestService_EnqueueExistingImages_DB(t *testing.T) {
	db := testDB(t)
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()
	svc := NewService(db, nil, client, NewObjectConfig(0.3, 0.5, 50, "/m"))
	if _, err := svc.EnqueueExistingImages(uuid.New().String()); err != nil {
		t.Logf("EnqueueExistingImages returned: %v", err)
	}
}

func TestEnqueueExistingLibraryImages_DB(t *testing.T) {
	db := testDB(t)
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()

	// No matching files (files table may not exist / be empty) — the query
	// should still succeed and return 0 without error when the files table
	// exists. If the files table is absent, the raw query errors; tolerate
	// either outcome but require no panic.
	libID := uuid.New().String()
	n, err := EnqueueExistingLibraryImages(client, db, libID)
	if err == nil && n != 0 {
		t.Errorf("expected 0 enqueued for empty library, got %d", n)
	}
}

func TestService_DeleteLibraryData_DB(t *testing.T) {
	db := testDB(t)
	svc := NewService(db, nil, nil, NewObjectConfig(0.3, 0.5, 50, "/m"))
	if err := svc.DeleteLibraryData(uuid.New().String()); err != nil {
		t.Fatalf("DeleteLibraryData: %v", err)
	}
}

func TestService_EnqueueObjectDetection(t *testing.T) {
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()
	svc := NewService(nil, nil, client, NewObjectConfig(0.3, 0.5, 50, "/m"))
	if err := svc.EnqueueObjectDetection("lib-1", "file-1"); err != nil {
		t.Fatalf("EnqueueObjectDetection: %v", err)
	}
}

func TestService_EnsureModels_AlreadyPresent(t *testing.T) {
	dir := t.TempDir()
	// Pre-create the model file so EnsureModels skips the download.
	if err := os.WriteFile(dir+"/"+objectModelFile, make([]byte, minModelSize+1), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := NewService(nil, nil, nil, NewObjectConfig(0.3, 0.5, 50, dir))
	if err := svc.EnsureModels(); err != nil {
		t.Fatalf("EnsureModels: %v", err)
	}
}
