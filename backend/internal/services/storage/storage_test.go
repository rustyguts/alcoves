package storage

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupTempStorage(t *testing.T) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	driver := NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	svc := NewService(driver)
	if err := svc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	return svc, root
}

func TestStorageStoreReadRangeDelete(t *testing.T) {
	svc, _ := setupTempStorage(t)

	// Store file
	if err := svc.StoreFile("lib-a", "file-a", []byte("hello world")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	// Check exists
	exists, err := svc.FileExists("lib-a", "file-a")
	if err != nil || !exists {
		t.Fatalf("FileExists: got %v, %v", exists, err)
	}

	// Check stat (size)
	size, err := svc.FileStat("lib-a", "file-a")
	if err != nil || size != 11 {
		t.Fatalf("FileStat: got %d, %v", size, err)
	}

	// Read buffer
	data, err := svc.ReadFileBuffer("lib-a", "file-a")
	if err != nil || string(data) != "hello world" {
		t.Fatalf("ReadFileBuffer: got %q, %v", data, err)
	}

	// Range read (bytes 6-10 = "world")
	reader, err := svc.OpenFileReadStream("lib-a", "file-a", &ByteRange{Start: 6, End: 10})
	if err != nil {
		t.Fatalf("OpenFileReadStream (range): %v", err)
	}
	rangeData, _ := io.ReadAll(reader)
	reader.Close()
	if string(rangeData) != "world" {
		t.Fatalf("Range read: expected 'world', got %q", rangeData)
	}

	// Delete
	if err := svc.DeleteFile("lib-a", "file-a"); err != nil {
		t.Fatalf("DeleteFile: %v", err)
	}
	exists, _ = svc.FileExists("lib-a", "file-a")
	if exists {
		t.Fatal("File should not exist after delete")
	}
}

func TestStorageDeleteFileAlsoDeletesDerivedCache(t *testing.T) {
	svc, _ := setupTempStorage(t)

	if err := svc.StoreFile("lib-a", "file-a", []byte("video")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	if err := svc.StoreCacheBuffer("lib-a/file-a/proxy.mp4", []byte("proxy")); err != nil {
		t.Fatalf("StoreCacheBuffer proxy: %v", err)
	}
	if err := svc.StoreCacheBuffer("lib-a/file-a/thumbnail.webp", []byte("thumb")); err != nil {
		t.Fatalf("StoreCacheBuffer thumbnail: %v", err)
	}

	if err := svc.DeleteFile("lib-a", "file-a"); err != nil {
		t.Fatalf("DeleteFile: %v", err)
	}

	fileExists, err := svc.FileExists("lib-a", "file-a")
	if err != nil {
		t.Fatalf("FileExists: %v", err)
	}
	if fileExists {
		t.Fatal("File should not exist after delete")
	}

	cacheKeys := []string{"lib-a/file-a/proxy.mp4", "lib-a/file-a/thumbnail.webp"}
	for _, key := range cacheKeys {
		cacheExists, err := svc.CacheExists(key)
		if err != nil {
			t.Fatalf("CacheExists(%s): %v", key, err)
		}
		if cacheExists {
			t.Fatalf("Cache key %s should not exist after delete", key)
		}
	}
}

func TestStorageAvatars(t *testing.T) {
	svc, _ := setupTempStorage(t)

	if err := svc.StoreAvatar("user-a", []byte("avatar")); err != nil {
		t.Fatalf("StoreAvatar: %v", err)
	}

	exists, err := svc.AvatarExists("user-a")
	if err != nil || !exists {
		t.Fatalf("AvatarExists: got %v, %v", exists, err)
	}

	data, err := svc.ReadAvatarBuffer("user-a")
	if err != nil || string(data) != "avatar" {
		t.Fatalf("ReadAvatarBuffer: got %q, %v", data, err)
	}
}

func TestStorageCache(t *testing.T) {
	svc, _ := setupTempStorage(t)

	cacheKey := "file/lib-a/file-a/thumb.webp"

	if err := svc.StoreCacheBuffer(cacheKey, []byte("cache-hit")); err != nil {
		t.Fatalf("StoreCacheBuffer: %v", err)
	}

	exists, err := svc.CacheExists(cacheKey)
	if err != nil || !exists {
		t.Fatalf("CacheExists: got %v, %v", exists, err)
	}

	reader, err := svc.OpenCacheReadStream(cacheKey)
	if err != nil {
		t.Fatalf("OpenCacheReadStream: %v", err)
	}
	data, _ := io.ReadAll(reader)
	reader.Close()
	if string(data) != "cache-hit" {
		t.Fatalf("CacheReadStream: expected 'cache-hit', got %q", data)
	}
}

func TestStorageStoreStream(t *testing.T) {
	svc, _ := setupTempStorage(t)

	content := "streamed content"
	reader := strings.NewReader(content)

	size, err := svc.StoreFileStream("lib-1", "file-1", reader)
	if err != nil {
		t.Fatalf("StoreFileStream: %v", err)
	}
	if size != int64(len(content)) {
		t.Fatalf("StoreFileStream: expected size %d, got %d", len(content), size)
	}

	data, err := svc.ReadFileBuffer("lib-1", "file-1")
	if err != nil || string(data) != content {
		t.Fatalf("ReadFileBuffer after stream: got %q, %v", data, err)
	}
}

func TestStorageEnsureReadyCreatesDirectories(t *testing.T) {
	root := t.TempDir()
	filesDir := filepath.Join(root, "newdir", "files")
	avatarsDir := filepath.Join(root, "newdir", "avatars")
	cacheDir := filepath.Join(root, "newdir", "cache")

	driver := NewLocalDriver(filesDir, avatarsDir, cacheDir)
	svc := NewService(driver)

	if err := svc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}

	for _, dir := range []string{filesDir, avatarsDir, cacheDir} {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() {
			t.Fatalf("Directory %s should exist after EnsureReady", dir)
		}
	}
}

func TestCacheKeyBuilders(t *testing.T) {
	if got := ThumbnailKey("lib", "file"); got != "lib/file/thumbnail.webp" {
		t.Fatalf("ThumbnailKey = %q, want %q", got, "lib/file/thumbnail.webp")
	}
	if got := ProxyKey("lib", "file"); got != "lib/file/proxy.mp4" {
		t.Fatalf("ProxyKey = %q, want %q", got, "lib/file/proxy.mp4")
	}
	if got := WaveformKey("lib", "file"); got != "lib/file/waveform.json" {
		t.Fatalf("WaveformKey = %q, want %q", got, "lib/file/waveform.json")
	}
	if got := FaceCropKey("lib", "face"); got != "lib/faces/face.webp" {
		t.Fatalf("FaceCropKey = %q, want %q", got, "lib/faces/face.webp")
	}
}

func TestStorageFileNotExists(t *testing.T) {
	svc, _ := setupTempStorage(t)

	exists, err := svc.FileExists("nonexistent-lib", "nonexistent-file")
	if err != nil {
		t.Fatalf("FileExists error: %v", err)
	}
	if exists {
		t.Fatal("Non-existent file should not exist")
	}
}
