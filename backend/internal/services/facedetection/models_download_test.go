package facedetection

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// bigBody returns a byte slice larger than minModelSize so downloads pass the size gate.
func bigBody() []byte {
	return bytes.Repeat([]byte{0xAB}, minModelSize+1024)
}

// bigBodyHash is the SHA-256 of bigBody(), used as the "expected" hash in tests.
func bigBodyHash() string {
	sum := sha256.Sum256(bigBody())
	return hex.EncodeToString(sum[:])
}

// TestEnsureModelsDownloaded_Success short-circuits when both model files already
// exist at a valid size with a matching hash (modelfetch's pre-stat path). The
// expected hashes are pointed at the fixture content so EnsureModelsDownloaded
// never contacts the real model URLs.
func TestEnsureModelsDownloaded_Success(t *testing.T) {
	body := bigBody()
	origDet, origRec := detectionModelSHA256, recognitionModelSHA256
	detectionModelSHA256 = bigBodyHash()
	recognitionModelSHA256 = bigBodyHash()
	defer func() { detectionModelSHA256, recognitionModelSHA256 = origDet, origRec }()

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

// The once-guarded ONNX runtime initializer moved to
// internal/services/onnxinit; its idempotence/concurrency tests live there.
