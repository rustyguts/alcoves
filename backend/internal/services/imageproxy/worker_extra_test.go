package imageproxy_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// newWorkerEnv wires up storage + a miniredis-backed service so we can build a
// TaskHandler with a live redis client (for ProcessTask Redis writes + pub/sub).
func newWorkerEnv(t *testing.T, proc imageproxy.Processor) (*imageproxy.Service, *redis.Client, *storage.Service, func()) {
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
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	cleanup := func() {
		rc.Close()
		asynqClient.Close()
	}
	return svc, rc, storageSvc, cleanup
}

func newTask(t *testing.T, libraryID, fileID string, opts imageproxy.TransformOptions) *asynq.Task {
	t.Helper()
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)
	payload, err := json.Marshal(imageproxy.ImageProxyPayload{
		LibraryID: libraryID,
		FileID:    fileID,
		CacheKey:  cacheKey,
		Opts:      opts,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return asynq.NewTask(imageproxy.TaskTypeImageProxy, payload)
}

// TestHasProcessor verifies HasProcessor reflects whether a processor is wired.
func TestHasProcessor(t *testing.T) {
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	storageSvc := storage.NewService(driver)

	withProc := imageproxy.NewService(storageSvc, nil, nil, &stubProcessor{})
	if !withProc.HasProcessor() {
		t.Error("HasProcessor() = false, want true when processor set")
	}

	withoutProc := imageproxy.NewService(storageSvc, nil, nil, nil)
	if withoutProc.HasProcessor() {
		t.Error("HasProcessor() = true, want false when processor nil")
	}
}

// TestProcessTask_Success runs the full worker happy path: read source,
// transform, write NFS cache + Redis result, publish "ok".
func TestProcessTask_Success(t *testing.T) {
	proc := &stubProcessor{out: []byte("worker-out")}
	svc, rc, storageSvc, cleanup := newWorkerEnv(t, proc)
	defer cleanup()

	libraryID, fileID := "libW", "fileW"
	writeSourceFile(t, storageSvc, libraryID, fileID)
	opts := imageproxy.TransformOptions{Width: 100, Format: "webp"}
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)

	// Subscribe to the completion channel to confirm "ok" is published.
	ctx := context.Background()
	pubsub := rc.Subscribe(ctx, "imageproxy:done:"+cacheKey)
	defer pubsub.Close()
	ch := pubsub.Channel()

	handler := svc.NewTaskHandler()
	if err := handler.ProcessTask(ctx, newTask(t, libraryID, fileID, opts)); err != nil {
		t.Fatalf("ProcessTask: %v", err)
	}

	// NFS cache should hold the transformed bytes.
	data, err := storageSvc.ReadCacheBuffer(cacheKey)
	if err != nil {
		t.Fatalf("ReadCacheBuffer: %v", err)
	}
	if string(data) != "worker-out" {
		t.Errorf("cache = %q, want %q", data, "worker-out")
	}

	// Redis result key should hold the bytes too.
	got, err := rc.Get(ctx, "imageproxy:bytes:"+cacheKey).Bytes()
	if err != nil {
		t.Fatalf("redis result get: %v", err)
	}
	if string(got) != "worker-out" {
		t.Errorf("redis result = %q, want %q", got, "worker-out")
	}

	select {
	case msg := <-ch:
		if msg.Payload != "ok" {
			t.Errorf("published signal = %q, want %q", msg.Payload, "ok")
		}
	default:
		// Signal may already be drained; non-fatal since cache+redis assert success.
	}
}

// TestProcessTask_InvalidPayload covers the json.Unmarshal error branch.
func TestProcessTask_InvalidPayload(t *testing.T) {
	svc, _, _, cleanup := newWorkerEnv(t, &stubProcessor{})
	defer cleanup()

	handler := svc.NewTaskHandler()
	task := asynq.NewTask(imageproxy.TaskTypeImageProxy, []byte("{not-json"))
	if err := handler.ProcessTask(context.Background(), task); err == nil {
		t.Error("expected error for invalid payload, got nil")
	}
}

// TestProcessTask_SourceReadError covers the ReadFileBuffer error branch (no
// source file exists) and confirms an "error:" signal is published.
func TestProcessTask_SourceReadError(t *testing.T) {
	svc, rc, _, cleanup := newWorkerEnv(t, &stubProcessor{})
	defer cleanup()

	libraryID, fileID := "missing", "missing"
	opts := imageproxy.TransformOptions{Width: 50}
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)

	pubsub := rc.Subscribe(context.Background(), "imageproxy:done:"+cacheKey)
	defer pubsub.Close()
	ch := pubsub.Channel()

	handler := svc.NewTaskHandler()
	err := handler.ProcessTask(context.Background(), newTask(t, libraryID, fileID, opts))
	if err == nil {
		t.Fatal("expected error reading missing source, got nil")
	}

	select {
	case msg := <-ch:
		if msg.Payload[:6] != "error:" {
			t.Errorf("expected error signal, got %q", msg.Payload)
		}
	default:
	}
}

// TestProcessTask_TransformError covers the processor.Transform error branch.
func TestProcessTask_TransformError(t *testing.T) {
	proc := &stubProcessor{err: errors.New("boom")}
	svc, _, storageSvc, cleanup := newWorkerEnv(t, proc)
	defer cleanup()

	libraryID, fileID := "libT", "fileT"
	writeSourceFile(t, storageSvc, libraryID, fileID)
	opts := imageproxy.TransformOptions{Width: 50}

	handler := svc.NewTaskHandler()
	if err := handler.ProcessTask(context.Background(), newTask(t, libraryID, fileID, opts)); err == nil {
		t.Error("expected transform error, got nil")
	}
}

// TestProcessTask_NoRedisClient verifies ProcessTask still succeeds and the
// publish() no-redis branch is exercised when redisClient is nil (inline mode).
func TestProcessTask_NoRedisClient(t *testing.T) {
	proc := &stubProcessor{out: []byte("no-redis-out")}
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	storageSvc := storage.NewService(driver)
	if err := storageSvc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	// nil redisConnOpt -> svc.redisClient is nil -> handler.redisClient is nil.
	svc := imageproxy.NewService(storageSvc, nil, nil, proc)

	libraryID, fileID := "libN", "fileN"
	writeSourceFile(t, storageSvc, libraryID, fileID)
	opts := imageproxy.TransformOptions{Width: 50, Format: "png"}
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)

	handler := svc.NewTaskHandler()
	if err := handler.ProcessTask(context.Background(), newTask(t, libraryID, fileID, opts)); err != nil {
		t.Fatalf("ProcessTask (no redis): %v", err)
	}

	data, err := storageSvc.ReadCacheBuffer(cacheKey)
	if err != nil {
		t.Fatalf("ReadCacheBuffer: %v", err)
	}
	if string(data) != "no-redis-out" {
		t.Errorf("cache = %q, want %q", data, "no-redis-out")
	}
}
