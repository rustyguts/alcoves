package modelfetch

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

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
