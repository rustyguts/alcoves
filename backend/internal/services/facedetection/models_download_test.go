package facedetection

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// bigBody returns a byte slice larger than minModelSize so downloads pass the size gate.
func bigBody() []byte {
	return bytes.Repeat([]byte{0xAB}, minModelSize+1024)
}

// TestEnsureModelsDownloaded_Success short-circuits when both model files
// already exist at a valid size (modelfetch's pre-stat path).
func TestEnsureModelsDownloaded_Success(t *testing.T) {
	body := bigBody()
	dir := filepath.Join(t.TempDir(), "models")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	for _, name := range []string{detectionModelFile, recognitionModelFile} {
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := EnsureModelsDownloaded(dir); err != nil {
		t.Fatalf("EnsureModelsDownloaded: %v", err)
	}
}

// TestEnsureModelsDownloaded_MkdirError fails when the path can't be created.
func TestEnsureModelsDownloaded_MkdirError(t *testing.T) {
	f := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	err := EnsureModelsDownloaded(filepath.Join(f, "models"))
	if err == nil {
		t.Fatal("expected mkdir error when path component is a file")
	}
}

// TestInitONNXRuntime ensures the once-guarded initializer runs without panicking.
// It may succeed or fail depending on whether the ORT shared library is present;
// either way the function must return idempotently.
func TestInitONNXRuntime(t *testing.T) {
	err1 := initONNXRuntime()
	err2 := initONNXRuntime()
	if (err1 == nil) != (err2 == nil) {
		t.Errorf("initONNXRuntime not idempotent: %v vs %v", err1, err2)
	}
}
