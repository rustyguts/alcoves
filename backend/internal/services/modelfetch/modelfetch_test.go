package modelfetch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func sha256hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func TestFetchToFile_Success(t *testing.T) {
	body := []byte("model-payload-bytes")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	if err := FetchToFile(context.Background(), srv.URL, dest, Options{}); err != nil {
		t.Fatalf("FetchToFile: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read dest: %v", err)
	}
	if string(got) != string(body) {
		t.Errorf("content = %q, want %q", got, body)
	}
	// .part temp must be renamed away.
	if _, err := os.Stat(dest + ".part"); !os.IsNotExist(err) {
		t.Error("expected .part temp to be gone")
	}
}

func TestFetchToFile_IdempotentSkipsServer(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write(make([]byte, 4096))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	if err := os.WriteFile(dest, make([]byte, 4096), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := FetchToFile(context.Background(), srv.URL, dest, Options{MinSize: 1024}); err != nil {
		t.Fatalf("FetchToFile: %v", err)
	}
	if n := atomic.LoadInt32(&hits); n != 0 {
		t.Errorf("server hit %d times, expected 0 (idempotent skip)", n)
	}
}

func TestFetchToFile_5xxThenSuccessRetries(t *testing.T) {
	var hits int32
	body := []byte("eventually-ok")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable) // first attempt → transient
			return
		}
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	// MaxAttempts=2 → one 503 (1s backoff) then success.
	if err := FetchToFile(context.Background(), srv.URL, dest, Options{MaxAttempts: 2}); err != nil {
		t.Fatalf("FetchToFile: %v", err)
	}
	if n := atomic.LoadInt32(&hits); n != 2 {
		t.Errorf("server hit %d times, expected 2 (one retry)", n)
	}
	got, _ := os.ReadFile(dest)
	if string(got) != string(body) {
		t.Errorf("content = %q", got)
	}
}

func TestFetchToFile_4xxPermanentNoRetry(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	err := FetchToFile(context.Background(), srv.URL, dest, Options{MaxAttempts: 6})
	if err == nil {
		t.Fatal("expected error for 404")
	}
	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Errorf("server hit %d times, expected 1 (no retry on 4xx)", n)
	}
}

func TestFetchToFile_RejectHTML(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html>LFS pointer</html>"))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	err := FetchToFile(context.Background(), srv.URL, dest, Options{RejectHTML: true})
	if err == nil || !strings.Contains(err.Error(), "HTML") {
		t.Fatalf("expected HTML rejection, got %v", err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Error("dest should not be created on HTML rejection")
	}
}

func TestFetchToFile_MinSizePermanent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("tiny"))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	err := FetchToFile(context.Background(), srv.URL, dest, Options{MinSize: 1024})
	if err == nil || !strings.Contains(err.Error(), "too small") {
		t.Fatalf("expected too-small error, got %v", err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Error("dest should not be created on undersized download")
	}
	if _, err := os.Stat(dest + ".part"); !os.IsNotExist(err) {
		t.Error(".part temp should be removed")
	}
}

func TestFetchToFile_CtxCanceled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("never-reached"))
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before the call

	dest := filepath.Join(t.TempDir(), "model.onnx")
	start := time.Now()
	err := FetchToFile(ctx, srv.URL, dest, Options{})
	if err == nil {
		t.Fatal("expected error from canceled context")
	}
	if time.Since(start) > 2*time.Second {
		t.Errorf("canceled fetch should return promptly, took %v", time.Since(start))
	}
}

// TestFetchToFile_SHA256MatchSkipsServer reuses a cached file whose hash matches
// without contacting the server.
func TestFetchToFile_SHA256MatchSkipsServer(t *testing.T) {
	body := make([]byte, 4096)
	for i := range body {
		body[i] = byte(i)
	}
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	if err := os.WriteFile(dest, body, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := FetchToFile(context.Background(), srv.URL, dest, Options{SHA256: sha256hex(body)}); err != nil {
		t.Fatalf("FetchToFile: %v", err)
	}
	if n := atomic.LoadInt32(&hits); n != 0 {
		t.Errorf("server hit %d times, expected 0 (hash-match skip)", n)
	}
}

// TestFetchToFile_SHA256WrongCacheRedownloads re-downloads when an existing file
// is the right size but the wrong contents — the stale-model bug this guards.
func TestFetchToFile_SHA256WrongCacheRedownloads(t *testing.T) {
	good := make([]byte, 4096)
	for i := range good {
		good[i] = 0xAB
	}
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write(good)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "model.onnx")
	// Existing file passes any size gate but is the wrong model (wrong hash).
	stale := make([]byte, 4096)
	for i := range stale {
		stale[i] = 0xCD
	}
	if err := os.WriteFile(dest, stale, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := FetchToFile(context.Background(), srv.URL, dest, Options{SHA256: sha256hex(good)}); err != nil {
		t.Fatalf("FetchToFile: %v", err)
	}
	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Errorf("server hit %d times, expected 1 (wrong-hash redownload)", n)
	}
	got, _ := os.ReadFile(dest)
	if sha256hex(got) != sha256hex(good) {
		t.Errorf("stale file was not replaced")
	}
}

// TestFetchToFile_SHA256MismatchPermanent treats a downloaded file whose hash
// doesn't match as a permanent error, leaving no dest or temp file behind.
func TestFetchToFile_SHA256MismatchPermanent(t *testing.T) {
	body := make([]byte, 4096)
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dir := t.TempDir()
	dest := filepath.Join(dir, "model.onnx")
	err := FetchToFile(context.Background(), srv.URL, dest, Options{SHA256: "deadbeef", MaxAttempts: 6})
	if err == nil || !strings.Contains(err.Error(), "hash mismatch") {
		t.Fatalf("expected hash mismatch error, got %v", err)
	}
	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Errorf("server hit %d times, expected 1 (no retry on hash mismatch)", n)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Errorf("dest should not exist on hash mismatch")
	}
	if leftovers, _ := filepath.Glob(filepath.Join(dir, "*.part")); len(leftovers) > 0 {
		t.Errorf("temp files should be removed on hash mismatch, found: %v", leftovers)
	}
}

// TestFetchToFile_ConcurrentSameDest runs many hash-verified downloads to the same
// destination at once — the shared-NFS scenario. A unique temp file per download
// means they can't clobber each other, so every one succeeds and no scratch remains.
func TestFetchToFile_ConcurrentSameDest(t *testing.T) {
	body := make([]byte, 8192)
	for i := range body {
		body[i] = byte(i)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dir := t.TempDir()
	dest := filepath.Join(dir, "model.onnx")

	const n = 8
	errs := make(chan error, n)
	var wg sync.WaitGroup
	for range n {
		wg.Go(func() {
			errs <- FetchToFile(context.Background(), srv.URL, dest, Options{SHA256: sha256hex(body)})
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent FetchToFile error: %v", err)
		}
	}
	got, _ := os.ReadFile(dest)
	if sha256hex(got) != sha256hex(body) {
		t.Errorf("final file hash mismatch")
	}
	if leftovers, _ := filepath.Glob(filepath.Join(dir, "*.part")); len(leftovers) > 0 {
		t.Errorf("temp files should not remain, found: %v", leftovers)
	}
}
