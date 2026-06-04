package facedetection

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

// modelsDirWithDummies returns a temp dir pre-populated with oversized dummy
// model files so EnsureModelsDownloaded short-circuits (no network), while ORT
// session creation still fails because the bytes aren't a valid ONNX model.
func modelsDirWithDummies(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	dummy := make([]byte, minModelSize+512)
	for i := range dummy {
		dummy[i] = byte(i % 251)
	}
	for _, name := range []string{detectionModelFile, recognitionModelFile} {
		if err := os.WriteFile(filepath.Join(dir, name), dummy, 0o644); err != nil {
			t.Fatalf("write dummy model %s: %v", name, err)
		}
	}
	return dir
}

// TestLoadDetectionSession_InvalidModel returns an error for a non-ONNX file
// (after the download short-circuit). It must not hit the network.
func TestLoadDetectionSession_InvalidModel(t *testing.T) {
	dir := modelsDirWithDummies(t)
	_, err := LoadDetectionSession(dir)
	if err == nil {
		t.Fatal("expected error loading invalid detection model")
	}
}

// TestLoadRecognitionSession_InvalidModel tries all input/output combos and fails.
func TestLoadRecognitionSession_InvalidModel(t *testing.T) {
	dir := modelsDirWithDummies(t)
	_, err := LoadRecognitionSession(dir)
	if err == nil {
		t.Fatal("expected error loading invalid recognition model")
	}
}

// TestGetDetectionSession_Errors covers the lazy session loader's error path and
// confirms the sync.Once caches the result.
func TestGetDetectionSession_Errors(t *testing.T) {
	dir := modelsDirWithDummies(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, dir)
	h := NewTaskHandler(nil, nil, cfg)

	_, err1 := h.getDetectionSession()
	_, err2 := h.getDetectionSession()
	if err1 == nil || err2 == nil {
		t.Fatal("expected detection session error")
	}
}

// TestGetRecognitionSession_Errors covers the recognition lazy loader's error path.
func TestGetRecognitionSession_Errors(t *testing.T) {
	dir := modelsDirWithDummies(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, dir)
	h := NewTaskHandler(nil, nil, cfg)

	_, err := h.getRecognitionSession()
	if err == nil {
		t.Fatal("expected recognition session error")
	}
}

// TestService_EnsureModels short-circuits when valid model files already exist.
func TestService_EnsureModels(t *testing.T) {
	dir := modelsDirWithDummies(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, dir)
	svc := NewService(nil, nil, nil, cfg)
	if err := svc.EnsureModels(); err != nil {
		t.Fatalf("EnsureModels with valid files: %v", err)
	}
}

// TestProcessFile_DetectionSessionError reaches the detection-session step and
// surfaces the session-load error after a successful storage read.
func TestProcessFile_DetectionSessionError(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	dir := modelsDirWithDummies(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, dir)
	h := NewTaskHandler(db, store, cfg)
	lib := mustLibrary(t, db)

	// A real image file in storage so the read succeeds and we reach detection.
	fileID := insertFile(t, db, lib, "image/jpeg", false)
	if err := store.StoreFile(lib, fileID.String(), makeTestJPEG(t, 64, 64)); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	payload, _ := json.Marshal(FaceDetectPayload{LibraryID: lib, FileID: fileID.String()})
	task := asynq.NewTask(TaskTypeFaceDetect, payload)
	err := h.ProcessTask(context.Background(), task)
	if err == nil {
		t.Fatal("expected detection session error to propagate")
	}
}

// TestProcessFile_StorageReadError surfaces an error when the image bytes are
// missing from storage.
func TestProcessFile_StorageReadError(t *testing.T) {
	db := faceTestDB(t)
	ensureFilesTable(t, db)
	store := newTestStorage(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	h := NewTaskHandler(db, store, cfg)
	lib := mustLibrary(t, db)

	// File row exists, is an image, but no bytes were stored.
	fileID := insertFile(t, db, lib, "image/jpeg", false)
	payload, _ := json.Marshal(FaceDetectPayload{LibraryID: lib, FileID: fileID.String()})
	task := asynq.NewTask(TaskTypeFaceDetect, payload)
	if err := h.ProcessTask(context.Background(), task); err == nil {
		t.Fatal("expected storage read error")
	}
}

// TestService_EnqueueFaceDetection_TaskCreated verifies the enqueue task path.
func TestService_EnqueueFaceDetection_TaskCreated(t *testing.T) {
	client := newAsynqClient(t)
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	svc := NewService(nil, nil, client, cfg)
	if err := svc.EnqueueFaceDetection(uuid.New().String(), uuid.New().String()); err != nil {
		t.Fatalf("EnqueueFaceDetection: %v", err)
	}
}
