package imageproxy_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// stubProcessor is a mock Processor that returns fixed bytes without libvips.
type stubProcessor struct {
	out []byte
	err error
}

func (p *stubProcessor) Transform(_ []byte, opts imageproxy.TransformOptions) ([]byte, string, error) {
	return p.out, imageproxy.MIMEForOpts(opts), p.err
}

// newTestEnv wires up a miniredis server, local storage, and an imageproxy.Service.
// It returns the service, a direct redis client for controlling signals in tests,
// and a cleanup function.
func newTestEnv(t *testing.T, proc imageproxy.Processor) (*imageproxy.Service, *redis.Client, *storage.Service, func()) {
	t.Helper()

	mr := miniredis.RunT(t)
	redisConnOpt := asynq.RedisClientOpt{Addr: mr.Addr()}

	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	storageSvc := storage.NewService(driver)
	if err := storageSvc.EnsureReady(); err != nil {
		t.Fatalf("storage setup: %v", err)
	}

	asynqClient := asynq.NewClient(redisConnOpt)
	svc := imageproxy.NewService(storageSvc, asynqClient, redisConnOpt, proc)

	// Direct redis client for publishing signals from the "worker" side in tests.
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	cleanup := func() {
		rc.Close()
		asynqClient.Close()
	}
	return svc, rc, storageSvc, cleanup
}

// writeSourceFile creates a fake source file so ReadFileBuffer succeeds.
func writeSourceFile(t *testing.T, storageSvc *storage.Service, libraryID, fileID string) {
	t.Helper()
	if err := storageSvc.StoreFile(libraryID, fileID, []byte("fake-image-data")); err != nil {
		t.Fatalf("writeSourceFile: %v", err)
	}
}

// simulateWorker runs in a goroutine, waits for delay, then acts as a worker would:
// write result to Redis result key + NFS cache, then publish the signal.
func simulateWorker(rc *redis.Client, storageSvc *storage.Service, svc *imageproxy.Service, libraryID, fileID string, opts imageproxy.TransformOptions, delay time.Duration, signal string, resultBytes []byte) {
	time.Sleep(delay)
	ctx := context.Background()
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)

	if signal == "ok" {
		_ = storageSvc.StoreCacheBuffer(cacheKey, resultBytes)
		_ = rc.Set(ctx, "imageproxy:bytes:"+cacheKey, resultBytes, 10*time.Minute).Err()
	}
	_ = rc.Publish(ctx, "imageproxy:done:"+cacheKey, signal).Err()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestServeTransform_NFSCacheHit verifies the fast path: if the NFS cache
// already holds the result, ServeTransform returns it immediately without
// touching the queue.
func TestServeTransform_NFSCacheHit(t *testing.T) {
	svc, _, storageSvc, cleanup := newTestEnv(t, &stubProcessor{out: []byte("fresh"), err: nil})
	defer cleanup()

	libraryID, fileID := "lib1", "file1"
	opts := imageproxy.TransformOptions{Width: 100, Format: "webp"}
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)

	// Pre-populate the NFS cache.
	if err := storageSvc.StoreCacheBuffer(cacheKey, []byte("cached-result")); err != nil {
		t.Fatal(err)
	}

	data, mime, err := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(data) != "cached-result" {
		t.Errorf("got %q, want %q", data, "cached-result")
	}
	if mime != "image/webp" {
		t.Errorf("got mime %q, want image/webp", mime)
	}
}

// TestServeTransform_InlineFallback verifies that when no queue is configured
// (nil asynq client), transforms run inline via the processor.
func TestServeTransform_InlineFallback(t *testing.T) {
	proc := &stubProcessor{out: []byte("inline-result")}

	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	storageSvc := storage.NewService(driver)
	_ = storageSvc.EnsureReady()

	svc := imageproxy.NewService(storageSvc, nil, nil, proc)

	libraryID, fileID := "lib1", "file1"
	writeSourceFile(t, storageSvc, libraryID, fileID)

	opts := imageproxy.TransformOptions{Width: 200, Format: "jpeg"}
	data, mime, err := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(data) != "inline-result" {
		t.Errorf("got %q, want %q", data, "inline-result")
	}
	if mime != "image/jpeg" {
		t.Errorf("got mime %q, want image/jpeg", mime)
	}

	// Second call should hit NFS cache (no processor call needed).
	proc.out = []byte("should-not-be-called")
	data2, _, err2 := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	if err2 != nil {
		t.Fatalf("second call error: %v", err2)
	}
	if string(data2) != "inline-result" {
		t.Errorf("second call: got %q, want cached %q", data2, "inline-result")
	}
}

// TestServeTransform_WorkerPublishesOK verifies the primary queue path:
// the worker writes the result to Redis + NFS and publishes "ok",
// and the waiting ServeTransform returns the correct bytes.
func TestServeTransform_WorkerPublishesOK(t *testing.T) {
	proc := &stubProcessor{out: []byte("queue-result")}
	svc, rc, storageSvc, cleanup := newTestEnv(t, proc)
	defer cleanup()

	libraryID, fileID := "lib1", "file1"
	writeSourceFile(t, storageSvc, libraryID, fileID)

	opts := imageproxy.TransformOptions{Width: 300, Format: "webp"}
	result := []byte("transformed-webp")

	// Simulate the worker: after 50ms, write result and signal.
	go simulateWorker(rc, storageSvc, svc, libraryID, fileID, opts, 50*time.Millisecond, "ok", result)

	start := time.Now()
	data, mime, err := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(data) != "transformed-webp" {
		t.Errorf("got %q, want %q", data, "transformed-webp")
	}
	if mime != "image/webp" {
		t.Errorf("got mime %q, want image/webp", mime)
	}
	if elapsed > 2*time.Second {
		t.Errorf("took too long: %v (expected ~50ms)", elapsed)
	}
}

// TestServeTransform_WorkerPublishesError verifies fast failure: when the worker
// publishes an error signal, ServeTransform returns immediately with an error
// instead of waiting for the full 30s timeout.
func TestServeTransform_WorkerPublishesError(t *testing.T) {
	svc, rc, storageSvc, cleanup := newTestEnv(t, &stubProcessor{})
	defer cleanup()

	libraryID, fileID := "lib1", "file1"
	writeSourceFile(t, storageSvc, libraryID, fileID)

	opts := imageproxy.TransformOptions{Width: 400, Format: "jpeg"}

	// Simulate worker failure after 50ms.
	go simulateWorker(rc, storageSvc, svc, libraryID, fileID, opts, 50*time.Millisecond, "error:libvips exploded", nil)

	start := time.Now()
	_, _, err := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "libvips exploded") {
		t.Errorf("error message %q does not contain expected text", err.Error())
	}
	if elapsed > 2*time.Second {
		t.Errorf("fast failure too slow: %v (expected ~50ms, not 30s timeout)", elapsed)
	}
}

// TestServeTransform_ContextCancellation verifies that cancelling the caller's
// context unblocks ServeTransform immediately.
func TestServeTransform_ContextCancellation(t *testing.T) {
	svc, _, storageSvc, cleanup := newTestEnv(t, &stubProcessor{})
	defer cleanup()

	libraryID, fileID := "lib1", "file1"
	writeSourceFile(t, storageSvc, libraryID, fileID)

	opts := imageproxy.TransformOptions{Width: 500, Format: "png"}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, _, err := svc.ServeTransform(ctx, libraryID, fileID, opts)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected error after context cancel, got nil")
	}
	if elapsed > 2*time.Second {
		t.Errorf("context cancel too slow: %v", elapsed)
	}
}

// TestServeTransform_Timeout verifies that when no worker ever signals,
// ServeTransform returns a timeout error (not hang forever).
// Uses a short context deadline to avoid slowing the test suite.
func TestServeTransform_Timeout(t *testing.T) {
	svc, _, storageSvc, cleanup := newTestEnv(t, &stubProcessor{})
	defer cleanup()

	libraryID, fileID := "lib1", "file1"
	writeSourceFile(t, storageSvc, libraryID, fileID)

	opts := imageproxy.TransformOptions{Width: 600, Format: "avif"}

	// 200ms deadline — much shorter than the real 30s transformTimeout.
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, _, err := svc.ServeTransform(ctx, libraryID, fileID, opts)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	if elapsed > 2*time.Second {
		t.Errorf("timeout not respected: %v", elapsed)
	}
}

// TestServeTransform_ConcurrentRequests verifies that multiple goroutines
// waiting on the same image all receive the result when the worker signals once.
func TestServeTransform_ConcurrentRequests(t *testing.T) {
	proc := &stubProcessor{out: []byte("concurrent-result")}
	svc, rc, storageSvc, cleanup := newTestEnv(t, proc)
	defer cleanup()

	libraryID, fileID := "lib1", "file1"
	writeSourceFile(t, storageSvc, libraryID, fileID)

	opts := imageproxy.TransformOptions{Width: 700, Format: "webp"}
	result := []byte("concurrent-result-webp")

	const workers = 5
	results := make([][]byte, workers)
	errs := make([]error, workers)
	var wg sync.WaitGroup

	for i := range workers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], _, errs[i] = svc.ServeTransform(context.Background(), libraryID, fileID, opts)
		}(i)
	}

	// Give goroutines time to subscribe, then simulate a single worker.
	time.Sleep(100 * time.Millisecond)
	simulateWorker(rc, storageSvc, svc, libraryID, fileID, opts, 0, "ok", result)

	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: unexpected error: %v", i, err)
		}
		if string(results[i]) != "concurrent-result-webp" {
			t.Errorf("goroutine %d: got %q, want %q", i, results[i], "concurrent-result-webp")
		}
	}
}

// TestServeTransform_ResultCachedAfterFirstRequest verifies that a second request
// for the same transform hits the NFS cache and never re-enqueues a job.
func TestServeTransform_ResultCachedAfterFirstRequest(t *testing.T) {
	proc := &stubProcessor{out: []byte("first-result")}
	svc, rc, storageSvc, cleanup := newTestEnv(t, proc)
	defer cleanup()

	libraryID, fileID := "lib1", "file1"
	writeSourceFile(t, storageSvc, libraryID, fileID)

	opts := imageproxy.TransformOptions{Width: 800, Format: "jpeg"}
	result := []byte("cached-jpeg")

	// First request — worker signals.
	go simulateWorker(rc, storageSvc, svc, libraryID, fileID, opts, 30*time.Millisecond, "ok", result)
	data1, _, err1 := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	if err1 != nil {
		t.Fatalf("first request: %v", err1)
	}
	if string(data1) != "cached-jpeg" {
		t.Errorf("first request: got %q, want %q", data1, "cached-jpeg")
	}

	// Verify NFS cache file was written by the simulated worker.
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)
	exists, _ := storageSvc.CacheExists(cacheKey)
	if !exists {
		t.Fatal("NFS cache file should exist after first request")
	}

	// Second request — should hit NFS cache instantly; delete the source file
	// to prove the queue is never hit.
	_ = os.Remove(filepath.Join(t.TempDir(), "files", libraryID, fileID, "blob"))

	start := time.Now()
	data2, _, err2 := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	if err2 != nil {
		t.Fatalf("second request: %v", err2)
	}
	if string(data2) != "cached-jpeg" {
		t.Errorf("second request: got %q, want %q", data2, "cached-jpeg")
	}
	if time.Since(start) > 100*time.Millisecond {
		t.Errorf("second request took too long — expected NFS cache hit")
	}
}
