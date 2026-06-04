package imageproxy_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// TestMIMEForOpts covers every branch of MIMEForOpts.
func TestMIMEForOpts(t *testing.T) {
	cases := []struct {
		format string
		want   string
	}{
		{"webp", "image/webp"},
		{"avif", "image/avif"},
		{"png", "image/png"},
		{"jpeg", "image/jpeg"},
		{"", "image/jpeg"},
		{"unknown", "image/jpeg"},
	}
	for _, tc := range cases {
		got := imageproxy.MIMEForOpts(imageproxy.TransformOptions{Format: tc.format})
		if got != tc.want {
			t.Errorf("MIMEForOpts(%q) = %q, want %q", tc.format, got, tc.want)
		}
	}
}

// TestTransformInline_SourceReadError exercises the inline-transform read error
// branch: no queue configured and the source file is missing.
func TestTransformInline_SourceReadError(t *testing.T) {
	proc := &stubProcessor{out: []byte("x")}
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	storageSvc := storage.NewService(driver)
	_ = storageSvc.EnsureReady()

	svc := imageproxy.NewService(storageSvc, nil, nil, proc)

	// No source file written -> ReadFileBuffer fails inside transformInline.
	_, _, err := svc.ServeTransform(context.Background(), "nolib", "nofile", imageproxy.TransformOptions{Width: 10})
	if err == nil {
		t.Fatal("expected error reading missing source inline, got nil")
	}
}

// TestTransformInline_TransformError exercises the inline transform error
// branch: source exists but the processor returns an error.
func TestTransformInline_TransformError(t *testing.T) {
	proc := &stubProcessor{err: errors.New("inline boom")}
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	storageSvc := storage.NewService(driver)
	_ = storageSvc.EnsureReady()

	svc := imageproxy.NewService(storageSvc, nil, nil, proc)
	writeSourceFile(t, storageSvc, "lib", "file")

	_, _, err := svc.ServeTransform(context.Background(), "lib", "file", imageproxy.TransformOptions{Width: 10})
	if err == nil {
		t.Fatal("expected inline transform error, got nil")
	}
}

// TestServeTransform_OkSignalReadsFromNFSAfterRedisExpiry exercises the
// readNFSCacheWithRetry path: the worker publishes "ok" and writes the NFS
// cache, but NEVER writes the Redis result key, forcing ServeTransform to fall
// back to NFS after the "ok" signal.
func TestServeTransform_OkSignalReadsFromNFSAfterRedisExpiry(t *testing.T) {
	proc := &stubProcessor{out: []byte("nfs-fallback")}
	svc, rc, storageSvc, cleanup := newTestEnv(t, proc)
	defer cleanup()

	libraryID, fileID := "libF", "fileF"
	writeSourceFile(t, storageSvc, libraryID, fileID)
	opts := imageproxy.TransformOptions{Width: 123, Format: "webp"}
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)
	result := []byte("nfs-only-result")

	// Simulate a worker that writes ONLY the NFS cache (no Redis result key)
	// then publishes "ok". ServeTransform must fall back to NFS via retry.
	go func() {
		time.Sleep(50 * time.Millisecond)
		_ = storageSvc.StoreCacheBuffer(cacheKey, result)
		// Intentionally do NOT set imageproxy:bytes:<key>.
		_ = rc.Publish(context.Background(), "imageproxy:done:"+cacheKey, "ok").Err()
	}()

	data, mime, err := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	if err != nil {
		t.Fatalf("ServeTransform: %v", err)
	}
	if string(data) != "nfs-only-result" {
		t.Errorf("data = %q, want %q", data, "nfs-only-result")
	}
	if mime != "image/webp" {
		t.Errorf("mime = %q, want image/webp", mime)
	}
}

func TestServeTransform_RedisResultDirectHit(t *testing.T) {
	// Covers the post-enqueue readRedisResult success branch: pre-seed the
	// Redis result key so ServeTransform returns from Redis without waiting.
	proc := &stubProcessor{out: []byte("x")}
	svc, rc, storageSvc, cleanup := newTestEnv(t, proc)
	defer cleanup()

	libraryID, fileID := "libR", "fileR"
	writeSourceFile(t, storageSvc, libraryID, fileID)
	opts := imageproxy.TransformOptions{Width: 77, Format: "jpeg"}
	cacheKey := imageproxy.TransformCacheKey(libraryID, fileID, opts)

	// Seed the Redis result key directly. ServeTransform checks Redis after
	// subscribe (step 3b) and returns immediately.
	if err := rc.Set(context.Background(), "imageproxy:bytes:"+cacheKey, []byte("redis-seeded"), 5*time.Minute).Err(); err != nil {
		t.Fatalf("seed redis: %v", err)
	}

	data, mime, err := svc.ServeTransform(context.Background(), libraryID, fileID, opts)
	if err != nil {
		t.Fatalf("ServeTransform: %v", err)
	}
	if string(data) != "redis-seeded" {
		t.Errorf("data = %q, want %q", data, "redis-seeded")
	}
	if mime != "image/jpeg" {
		t.Errorf("mime = %q, want image/jpeg", mime)
	}
}
