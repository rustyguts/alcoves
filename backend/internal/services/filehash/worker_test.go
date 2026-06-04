package filehash

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// newLocalStorage builds a storage.Service backed by a temp local driver.
func newLocalStorage(t *testing.T) *storage.Service {
	t.Helper()
	root := t.TempDir()
	driver := storage.NewLocalDriver(root+"/files", root+"/avatars", root+"/cache")
	if err := driver.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	return storage.NewService(driver)
}

func TestNewFileHashTask(t *testing.T) {
	task, err := NewFileHashTask("lib-1", "file-1")
	if err != nil {
		t.Fatalf("NewFileHashTask: %v", err)
	}
	if task.Type() != TaskTypeFileHash {
		t.Fatalf("expected task type %q, got %q", TaskTypeFileHash, task.Type())
	}
	var p FileHashPayload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("payload unmarshal: %v", err)
	}
	if p.LibraryID != "lib-1" || p.FileID != "file-1" {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestNewTaskHandler(t *testing.T) {
	db := setupDedupDB(t)
	st := newLocalStorage(t)
	h := NewTaskHandler(db, st)
	if h == nil || h.db != db || h.storage != st {
		t.Fatal("NewTaskHandler did not wire dependencies")
	}
}

func TestProcessTask_HashesFile(t *testing.T) {
	db := setupDedupDB(t)
	st := newLocalStorage(t)
	owner, lib := mkLibrary(t, db)

	fileID := mkFile(t, db, lib, owner, nil, nil, false)

	// Write the blob into local storage so the worker can stream it.
	content := []byte("the quick brown fox")
	if err := st.StoreFile(lib.String(), fileID.String(), content); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	expected := sha256.Sum256(content)
	expectedHex := hex.EncodeToString(expected[:])

	task := mustTask(t, lib.String(), fileID.String())
	h := NewTaskHandler(db, st)
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Fatalf("ProcessTask: %v", err)
	}

	var got models.File
	if err := db.First(&got, "id = ?", fileID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Hash == nil || *got.Hash != expectedHex {
		t.Fatalf("expected hash %s, got %v", expectedHex, got.Hash)
	}
}

func TestProcessTask_InvalidPayload(t *testing.T) {
	db := setupDedupDB(t)
	st := newLocalStorage(t)
	h := NewTaskHandler(db, st)

	bad := asynq.NewTask(TaskTypeFileHash, []byte("not json"))
	if err := h.ProcessTask(context.Background(), bad); err == nil {
		t.Fatal("expected error for invalid payload")
	}
}

func TestProcessTask_FileNotFound(t *testing.T) {
	db := setupDedupDB(t)
	st := newLocalStorage(t)
	_, lib := mkLibrary(t, db)
	h := NewTaskHandler(db, st)

	// Nonexistent file -> handler returns nil (skips gracefully).
	task := mustTask(t, lib.String(), uuid.New().String())
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Fatalf("expected nil for missing file, got %v", err)
	}
}

func TestProcessTask_AlreadyHashed(t *testing.T) {
	db := setupDedupDB(t)
	st := newLocalStorage(t)
	owner, lib := mkLibrary(t, db)

	existing := "preexisting"
	fileID := mkFile(t, db, lib, owner, &existing, nil, false)

	task := mustTask(t, lib.String(), fileID.String())
	h := NewTaskHandler(db, st)
	// No blob is written; if it tried to read storage it'd fail. It must skip.
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Fatalf("expected nil for already-hashed file, got %v", err)
	}

	var got models.File
	db.First(&got, "id = ?", fileID)
	if got.Hash == nil || *got.Hash != existing {
		t.Fatalf("hash should be unchanged, got %v", got.Hash)
	}
}

func TestProcessTask_StorageMissingBlob(t *testing.T) {
	db := setupDedupDB(t)
	st := newLocalStorage(t)
	owner, lib := mkLibrary(t, db)

	// File row exists, no hash, but no blob stored -> OpenFileReadStream fails.
	fileID := mkFile(t, db, lib, owner, nil, nil, false)
	task := mustTask(t, lib.String(), fileID.String())
	h := NewTaskHandler(db, st)
	if err := h.ProcessTask(context.Background(), task); err == nil {
		t.Fatal("expected error when blob is missing from storage")
	}
}

func TestProcessTask_DBError(t *testing.T) {
	db := setupDedupDB(t)
	st := newLocalStorage(t)
	_, lib := mkLibrary(t, db)

	// Drop the files table so the worker's SELECT fails with a real DB error
	// (not ErrRecordNotFound), exercising the error-return branch.
	if err := db.Migrator().DropTable("files"); err != nil {
		t.Skipf("Skipping: could not drop files table: %v", err)
	}
	t.Cleanup(func() { _ = db.AutoMigrate(&models.File{}) })

	task := mustTask(t, lib.String(), uuid.New().String())
	h := NewTaskHandler(db, st)
	if err := h.ProcessTask(context.Background(), task); err == nil {
		t.Fatal("expected DB error when files table is missing")
	}
}

func mustTask(t *testing.T, libID, fileID string) *asynq.Task {
	t.Helper()
	task, err := NewFileHashTask(libID, fileID)
	if err != nil {
		t.Fatalf("NewFileHashTask: %v", err)
	}
	return task
}

// ensure gorm import is referenced even if other helpers shift.
var _ = gorm.ErrRecordNotFound
