package facedetection

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

// TestNewFaceDetectTask builds a task with a correct type and JSON payload.
func TestNewFaceDetectTask(t *testing.T) {
	task, err := NewFaceDetectTask("lib-1", "file-1")
	if err != nil {
		t.Fatalf("NewFaceDetectTask: %v", err)
	}
	if task.Type() != TaskTypeFaceDetect {
		t.Errorf("task type = %q, want %q", task.Type(), TaskTypeFaceDetect)
	}
	var p FaceDetectPayload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p.LibraryID != "lib-1" || p.FileID != "file-1" {
		t.Errorf("payload = %+v, want lib-1/file-1", p)
	}
}

// TestNewService_And_Accessors constructs the service and its task handler.
func TestNewService_And_Accessors(t *testing.T) {
	store := newTestStorage(t)
	client := newAsynqClient(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")

	svc := NewService(nil, store, client, cfg)
	if svc == nil {
		t.Fatal("NewService returned nil")
	}
	if h := svc.NewTaskHandler(); h == nil {
		t.Error("NewTaskHandler returned nil")
	}
}

// TestService_EnqueueFaceDetection enqueues a single task via the service.
func TestService_EnqueueFaceDetection(t *testing.T) {
	store := newTestStorage(t)
	client := newAsynqClient(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	svc := NewService(nil, store, client, cfg)

	if err := svc.EnqueueFaceDetection("lib-1", "file-1"); err != nil {
		t.Fatalf("EnqueueFaceDetection: %v", err)
	}
}

// TestService_EnqueueExistingImages delegates to the bulk enqueue helper.
func TestService_EnqueueExistingImages(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	client := newAsynqClient(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	svc := NewService(db, store, client, cfg)
	lib := mustLibrary(t, db)

	insertFile(t, db, lib, "image/jpeg", false)

	n, err := svc.EnqueueExistingImages(lib)
	if err != nil {
		t.Fatalf("EnqueueExistingImages: %v", err)
	}
	if n != 1 {
		t.Errorf("enqueued = %d, want 1", n)
	}
}

// TestService_DeleteLibraryData delegates to DeleteLibraryFaceData.
func TestService_DeleteLibraryData(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	client := newAsynqClient(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	svc := NewService(db, store, client, cfg)
	lib := newLibraryID()

	insertFace(t, db, lib, uuid.New(), nil, 80, unitEmbedding(0, 5))
	if err := svc.DeleteLibraryData(lib); err != nil {
		t.Fatalf("DeleteLibraryData: %v", err)
	}
}

// TestService_ReprocessLibrary delegates to ReprocessLibraryFaceData.
func TestService_ReprocessLibrary(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	client := newAsynqClient(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	svc := NewService(db, store, client, cfg)
	lib := mustLibrary(t, db)

	insertFile(t, db, lib, "image/jpeg", false)
	n, err := svc.ReprocessLibrary(lib)
	if err != nil {
		t.Fatalf("ReprocessLibrary: %v", err)
	}
	if n != 1 {
		t.Errorf("re-enqueued = %d, want 1", n)
	}
}

// TestService_DeleteFaceDataForFiles delegates to the cleanup helper.
func TestService_DeleteFaceDataForFiles(t *testing.T) {
	db := faceTestDB(t)
	store := newTestStorage(t)
	client := newAsynqClient(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	svc := NewService(db, store, client, cfg)
	lib := newLibraryID()

	fileID := uuid.New()
	insertFace(t, db, lib, fileID, nil, 80, unitEmbedding(0, 5))
	if err := svc.DeleteFaceDataForFiles(lib, []string{fileID.String()}); err != nil {
		t.Fatalf("DeleteFaceDataForFiles: %v", err)
	}
}

// TestWorkerNewTaskHandler constructs a worker TaskHandler directly.
func TestWorkerNewTaskHandler(t *testing.T) {
	store := newTestStorage(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	h := NewTaskHandler(nil, store, cfg)
	if h == nil {
		t.Fatal("NewTaskHandler returned nil")
	}
}

// TestProcessTask_InvalidPayload rejects malformed JSON without touching the DB.
func TestProcessTask_InvalidPayload(t *testing.T) {
	store := newTestStorage(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	h := NewTaskHandler(nil, store, cfg)

	task := asynq.NewTask(TaskTypeFaceDetect, []byte("not-json"))
	err := h.ProcessTask(context.Background(), task)
	if err == nil {
		t.Fatal("expected error for invalid payload")
	}
}

// TestProcessTask_FileNotFound returns nil (don't retry) when the file is missing.
func TestProcessTask_FileNotFound(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	h := NewTaskHandler(db, store, cfg)

	payload, _ := json.Marshal(FaceDetectPayload{LibraryID: newLibraryID(), FileID: uuid.New().String()})
	task := asynq.NewTask(TaskTypeFaceDetect, payload)
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Errorf("expected nil for missing file (no retry), got %v", err)
	}
}

// TestProcessTask_NonImageSkipped returns nil for a non-image file.
func TestProcessTask_NonImageSkipped(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	h := NewTaskHandler(db, store, cfg)
	lib := mustLibrary(t, db)

	fileID := insertFile(t, db, lib, "video/mp4", false)
	payload, _ := json.Marshal(FaceDetectPayload{LibraryID: lib, FileID: fileID.String()})
	task := asynq.NewTask(TaskTypeFaceDetect, payload)
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Errorf("expected nil for non-image file, got %v", err)
	}
}

// TestProcessTask_AlreadyHasDetections short-circuits when detections exist.
func TestProcessTask_AlreadyHasDetections(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	h := NewTaskHandler(db, store, cfg)
	lib := mustLibrary(t, db)

	fileID := insertFile(t, db, lib, "image/jpeg", false)
	insertFace(t, db, lib, fileID, nil, 80, unitEmbedding(0, 5))

	payload, _ := json.Marshal(FaceDetectPayload{LibraryID: lib, FileID: fileID.String()})
	task := asynq.NewTask(TaskTypeFaceDetect, payload)
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Errorf("expected nil when detections already exist, got %v", err)
	}
}
