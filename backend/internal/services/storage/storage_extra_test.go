package storage

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDeleteFileBlob verifies only the original blob is removed, leaving
// derived cache artifacts intact.
func TestDeleteFileBlob(t *testing.T) {
	svc, _ := setupTempStorage(t)

	if err := svc.StoreFile("lib-x", "file-x", []byte("blob")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	if err := svc.StoreCacheBuffer("lib-x/file-x/proxy.mp4", []byte("proxy")); err != nil {
		t.Fatalf("StoreCacheBuffer: %v", err)
	}

	if err := svc.DeleteFileBlob("lib-x", "file-x"); err != nil {
		t.Fatalf("DeleteFileBlob: %v", err)
	}

	exists, err := svc.FileExists("lib-x", "file-x")
	if err != nil {
		t.Fatalf("FileExists: %v", err)
	}
	if exists {
		t.Fatal("blob should be gone after DeleteFileBlob")
	}

	// Cache artifact should remain.
	cacheExists, err := svc.CacheExists("lib-x/file-x/proxy.mp4")
	if err != nil {
		t.Fatalf("CacheExists: %v", err)
	}
	if !cacheExists {
		t.Fatal("cache artifact should survive DeleteFileBlob")
	}
}

// TestCacheStatAndReadBuffer exercises the cache-scope Stat/ReadBuffer wrappers.
func TestCacheStatAndReadBuffer(t *testing.T) {
	svc, _ := setupTempStorage(t)

	const key = "lib-a/file-a/thumb.webp"
	const payload = "cache-payload"
	if err := svc.StoreCacheBuffer(key, []byte(payload)); err != nil {
		t.Fatalf("StoreCacheBuffer: %v", err)
	}

	size, err := svc.CacheStat(key)
	if err != nil {
		t.Fatalf("CacheStat: %v", err)
	}
	if size != int64(len(payload)) {
		t.Errorf("CacheStat size = %d, want %d", size, len(payload))
	}

	data, err := svc.ReadCacheBuffer(key)
	if err != nil {
		t.Fatalf("ReadCacheBuffer: %v", err)
	}
	if string(data) != payload {
		t.Errorf("ReadCacheBuffer = %q, want %q", data, payload)
	}
}

// TestStoreCacheStreamAndRangeRead exercises StoreCacheStream and
// OpenCacheReadStreamRange.
func TestStoreCacheStreamAndRangeRead(t *testing.T) {
	svc, _ := setupTempStorage(t)

	const key = "lib-a/file-a/clip.bin"
	const content = "0123456789abcdef"
	n, err := svc.StoreCacheStream(key, strings.NewReader(content))
	if err != nil {
		t.Fatalf("StoreCacheStream: %v", err)
	}
	if n != int64(len(content)) {
		t.Errorf("StoreCacheStream wrote %d, want %d", n, len(content))
	}

	// Range read bytes 2..5 inclusive = "2345".
	reader, err := svc.OpenCacheReadStreamRange(key, &ByteRange{Start: 2, End: 5})
	if err != nil {
		t.Fatalf("OpenCacheReadStreamRange: %v", err)
	}
	got, _ := io.ReadAll(reader)
	reader.Close()
	if string(got) != "2345" {
		t.Errorf("range read = %q, want %q", got, "2345")
	}

	// Open-ended range (End == -1) reads to EOF.
	reader2, err := svc.OpenCacheReadStreamRange(key, &ByteRange{Start: 10, End: -1})
	if err != nil {
		t.Fatalf("OpenCacheReadStreamRange (open end): %v", err)
	}
	got2, _ := io.ReadAll(reader2)
	reader2.Close()
	if string(got2) != "abcdef" {
		t.Errorf("open-ended range read = %q, want %q", got2, "abcdef")
	}
}

// TestDeleteCachePrefix verifies a whole cache prefix is removed.
func TestDeleteCachePrefix(t *testing.T) {
	svc, _ := setupTempStorage(t)

	keys := []string{
		"lib-a/file-a/transforms/w100.jpg",
		"lib-a/file-a/transforms/w200.jpg",
	}
	for _, k := range keys {
		if err := svc.StoreCacheBuffer(k, []byte("x")); err != nil {
			t.Fatalf("StoreCacheBuffer(%s): %v", k, err)
		}
	}

	if err := svc.DeleteCachePrefix("lib-a/file-a/transforms"); err != nil {
		t.Fatalf("DeleteCachePrefix: %v", err)
	}

	for _, k := range keys {
		exists, err := svc.CacheExists(k)
		if err != nil {
			t.Fatalf("CacheExists(%s): %v", k, err)
		}
		if exists {
			t.Errorf("key %s should be gone after DeleteCachePrefix", k)
		}
	}
}

// TestStatMissingFileErrors exercises the error path of Stat on a missing key.
func TestStatMissingFileErrors(t *testing.T) {
	svc, _ := setupTempStorage(t)
	if _, err := svc.FileStat("nope", "nope"); err == nil {
		t.Error("expected error stat-ing missing file")
	}
	if _, err := svc.CacheStat("nope/nope"); err == nil {
		t.Error("expected error stat-ing missing cache key")
	}
}

// TestOpenReadStreamMissingErrors exercises the error path of OpenReadStream
// when the underlying file does not exist.
func TestOpenReadStreamMissingErrors(t *testing.T) {
	svc, _ := setupTempStorage(t)
	if _, err := svc.OpenFileReadStream("nope", "nope", nil); err == nil {
		t.Error("expected error opening missing file stream")
	}
	if _, err := svc.OpenCacheReadStream("nope/nope"); err == nil {
		t.Error("expected error opening missing cache stream")
	}
}

// TestReadBufferMissingErrors exercises ReadBuffer error paths.
func TestReadBufferMissingErrors(t *testing.T) {
	svc, _ := setupTempStorage(t)
	if _, err := svc.ReadFileBuffer("nope", "nope"); err == nil {
		t.Error("expected error reading missing file buffer")
	}
	if _, err := svc.ReadCacheBuffer("nope/nope"); err == nil {
		t.Error("expected error reading missing cache buffer")
	}
}

// TestRangeReadSeekError exercises the range-read seek error path: seeking
// before the start of a file via a negative Start position fails.
func TestRangeReadSeekError(t *testing.T) {
	svc, _ := setupTempStorage(t)
	if err := svc.StoreFile("lib-a", "file-a", []byte("hello")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	// Negative Start triggers Seek failure (offset < 0).
	if _, err := svc.OpenFileReadStream("lib-a", "file-a", &ByteRange{Start: -5, End: -1}); err == nil {
		t.Error("expected error seeking to negative offset")
	}
}

// TestEnsureReadyErrorOnUnwritableRoot exercises the EnsureReady error path
// where a root cannot be created (parent path is a file, not a dir).
func TestEnsureReadyErrorOnUnwritableRoot(t *testing.T) {
	root := t.TempDir()
	// Create a file where a directory root would need to live.
	blocker := filepath.Join(root, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	// Use the file as a parent path segment -> MkdirAll fails.
	driver := NewLocalDriver(
		filepath.Join(blocker, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	svc := NewService(driver)
	if err := svc.EnsureReady(); err == nil {
		t.Error("expected EnsureReady to fail when a root parent is a file")
	}
}

// TestPutBufferErrorOnBadDir exercises the PutBuffer MkdirAll error branch.
func TestPutBufferErrorOnBadDir(t *testing.T) {
	root := t.TempDir()
	blocker := filepath.Join(root, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	driver := NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	svc := NewService(driver)
	if err := svc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	// Store under a key whose parent dir collides with an existing file.
	if err := svc.StoreCacheBuffer("blocker", []byte("y")); err != nil {
		t.Fatalf("setup StoreCacheBuffer: %v", err)
	}
	// Now "blocker" is a file; storing "blocker/child" must fail at MkdirAll.
	if err := svc.StoreCacheBuffer("blocker/child", []byte("z")); err == nil {
		t.Error("expected PutBuffer to fail when parent path is a file")
	}
}

// TestPutStreamErrorOnBadDir exercises the PutStream MkdirAll error branch.
func TestPutStreamErrorOnBadDir(t *testing.T) {
	svc, _ := setupTempStorage(t)
	if err := svc.StoreCacheBuffer("collide", []byte("y")); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if _, err := svc.StoreCacheStream("collide/child", strings.NewReader("z")); err == nil {
		t.Error("expected PutStream to fail when parent path is a file")
	}
}
