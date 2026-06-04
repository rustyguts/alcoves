package facedetection

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// bigBody returns a byte slice larger than minModelSize so downloads pass the size gate.
func bigBody() []byte {
	return bytes.Repeat([]byte{0xAB}, minModelSize+1024)
}

// TestDoDownload_Success downloads a valid file to a temp destination.
func TestDoDownload_Success(t *testing.T) {
	body := bigBody()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	if err := doDownload(dest, srv.URL); err != nil {
		t.Fatalf("doDownload error: %v", err)
	}
	info, err := os.Stat(dest)
	if err != nil {
		t.Fatalf("stat dest: %v", err)
	}
	if info.Size() != int64(len(body)) {
		t.Errorf("downloaded size = %d, want %d", info.Size(), len(body))
	}
	// Temp file should be cleaned up (renamed).
	if _, err := os.Stat(dest + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file should not remain")
	}
}

// TestDoDownload_HTTPError returns an error on non-200 status.
func TestDoDownload_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	err := doDownload(dest, srv.URL)
	if err == nil || !strings.Contains(err.Error(), "HTTP 5") {
		t.Fatalf("expected HTTP 5xx error, got %v", err)
	}
}

// TestDoDownload_HTMLResponse rejects an HTML (LFS pointer) response.
func TestDoDownload_HTMLResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html>not a model</html>"))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	err := doDownload(dest, srv.URL)
	if err == nil || !strings.Contains(err.Error(), "HTML") {
		t.Fatalf("expected HTML rejection, got %v", err)
	}
}

// TestDoDownload_TooSmall rejects a downloaded file below minModelSize.
func TestDoDownload_TooSmall(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("tiny"))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	err := doDownload(dest, srv.URL)
	if err == nil || !strings.Contains(err.Error(), "too small") {
		t.Fatalf("expected too-small error, got %v", err)
	}
	// Temp file should be removed.
	if _, err := os.Stat(dest + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file should be removed on too-small download")
	}
}

// TestDoDownload_BadURL returns an error when the request itself fails.
func TestDoDownload_BadURL(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "model.onnx")
	err := doDownload(dest, "http://127.0.0.1:0/nope")
	if err == nil {
		t.Fatal("expected error for unreachable URL")
	}
}

// TestDownloadIfNeeded_ExistingValidFile skips download when a large file already exists.
func TestDownloadIfNeeded_ExistingValidFile(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "model.onnx")
	if err := os.WriteFile(dest, bigBody(), 0o644); err != nil {
		t.Fatalf("write existing file: %v", err)
	}
	// URL points nowhere; should not be contacted because the file is valid.
	if err := downloadIfNeeded(dest, "http://127.0.0.1:0/should-not-be-used"); err != nil {
		t.Fatalf("downloadIfNeeded with valid existing file: %v", err)
	}
}

// TestDownloadIfNeeded_DownloadsWhenMissing downloads when no file exists yet.
func TestDownloadIfNeeded_DownloadsWhenMissing(t *testing.T) {
	body := bigBody()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	if err := downloadIfNeeded(dest, srv.URL); err != nil {
		t.Fatalf("downloadIfNeeded missing: %v", err)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Errorf("expected downloaded file to exist: %v", err)
	}
}

// TestDownloadIfNeeded_NonTransientFails returns immediately on a non-transient error (404).
func TestDownloadIfNeeded_NonTransientFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	start := time.Now()
	err := downloadIfNeeded(dest, srv.URL)
	if err == nil {
		t.Fatal("expected error for 404")
	}
	// Should not retry (no backoff) for a 404 — completes quickly.
	if time.Since(start) > 2*time.Second {
		t.Errorf("non-transient error should not retry, took %v", time.Since(start))
	}
}

// TestDownloadIfNeeded_SmallExistingFileRedownloads re-downloads when the existing file is too small.
func TestDownloadIfNeeded_SmallExistingFileRedownloads(t *testing.T) {
	body := bigBody()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	// Write a too-small existing file.
	if err := os.WriteFile(dest, []byte("small"), 0o644); err != nil {
		t.Fatalf("write small file: %v", err)
	}
	if err := downloadIfNeeded(dest, srv.URL); err != nil {
		t.Fatalf("downloadIfNeeded redownload: %v", err)
	}
	info, _ := os.Stat(dest)
	if info.Size() != int64(len(body)) {
		t.Errorf("redownloaded size = %d, want %d", info.Size(), len(body))
	}
}

// TestEnsureModelsDownloaded_Success downloads both model files to a fresh dir.
func TestEnsureModelsDownloaded_Success(t *testing.T) {
	body := bigBody()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dir := filepath.Join(t.TempDir(), "models")
	// Pre-create both files as valid so EnsureModelsDownloaded short-circuits the real URLs.
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
	// Create a file, then try to use it as a directory path.
	f := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	err := EnsureModelsDownloaded(filepath.Join(f, "models"))
	if err == nil {
		t.Fatal("expected mkdir error when path component is a file")
	}
}

// TestProgressReader_Read passes through bytes and tracks the running total.
func TestProgressReader_Read(t *testing.T) {
	src := bytes.NewReader([]byte("hello world"))
	pr := &progressReader{r: src, total: 11, label: "test"}
	buf := make([]byte, 5)
	n, err := pr.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if n != 5 || string(buf[:n]) != "hello" {
		t.Errorf("read = %q (%d), want %q", buf[:n], n, "hello")
	}
	if pr.read != 5 {
		t.Errorf("progressReader.read = %d, want 5", pr.read)
	}
}

// TestProgressReader_ReadNoTotal exercises the unknown-content-length log branch.
func TestProgressReader_ReadNoTotal(t *testing.T) {
	src := bytes.NewReader(bytes.Repeat([]byte("a"), 100))
	// total=0 and lastReport far in the past so the unknown-total log branch executes.
	pr := &progressReader{r: src, total: 0, label: "nototal", lastReport: time.Now().Add(-time.Hour)}
	buf := make([]byte, 100)
	n, _ := pr.Read(buf)
	if n != 100 {
		t.Errorf("read = %d, want 100", n)
	}
}

// TestProgressReader_ReadWithProgressLog exercises the known-total log branch.
func TestProgressReader_ReadWithProgressLog(t *testing.T) {
	src := bytes.NewReader(bytes.Repeat([]byte("a"), 100))
	pr := &progressReader{r: src, total: 100, label: "withtotal", lastReport: time.Now().Add(-time.Hour)}
	buf := make([]byte, 100)
	n, _ := pr.Read(buf)
	if n != 100 {
		t.Errorf("read = %d, want 100", n)
	}
}

// TestInitONNXRuntime ensures the once-guarded initializer runs without panicking.
// It may succeed or fail depending on whether the ORT shared library is present;
// either way the function must return idempotently.
func TestInitONNXRuntime(t *testing.T) {
	err1 := initONNXRuntime()
	err2 := initONNXRuntime()
	// Second call must return the same cached result.
	if (err1 == nil) != (err2 == nil) {
		t.Errorf("initONNXRuntime not idempotent: %v vs %v", err1, err2)
	}
}
