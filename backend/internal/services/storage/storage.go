package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type Scope string

const (
	ScopeFiles   Scope = "files"
	ScopeAvatars Scope = "avatars"
	ScopeCache   Scope = "cache"
)

// ByteRange represents a byte range for partial reads.
type ByteRange struct {
	Start int64
	End   int64 // -1 means to end of file
}

// Driver is the storage driver interface.
type Driver interface {
	EnsureReady() error
	PutBuffer(scope Scope, key string, data []byte) error
	PutStream(scope Scope, key string, reader io.Reader) (int64, error)
	OpenReadStream(scope Scope, key string, byteRange *ByteRange) (io.ReadCloser, error)
	ReadBuffer(scope Scope, key string) ([]byte, error)
	Exists(scope Scope, key string) (bool, error)
	Stat(scope Scope, key string) (int64, error) // returns size
	DeletePrefix(scope Scope, keyPrefix string) error
}

// Service provides high-level storage operations with scope routing.
type Service struct {
	driver Driver
}

func NewService(driver Driver) *Service {
	return &Service{driver: driver}
}

func (s *Service) EnsureReady() error {
	return s.driver.EnsureReady()
}

// File operations
func (s *Service) StoreFile(libraryID, fileID string, data []byte) error {
	return s.driver.PutBuffer(ScopeFiles, fileKey(libraryID, fileID), data)
}

func (s *Service) StoreFileStream(libraryID, fileID string, reader io.Reader) (int64, error) {
	return s.driver.PutStream(ScopeFiles, fileKey(libraryID, fileID), reader)
}

func (s *Service) DeleteFile(libraryID, fileID string) error {
	prefix := fmt.Sprintf("%s/%s", libraryID, fileID)
	if err := s.driver.DeletePrefix(ScopeFiles, prefix); err != nil {
		return err
	}
	// Remove derived per-file cache artifacts (e.g. video proxy + thumbnail).
	if err := s.driver.DeletePrefix(ScopeCache, prefix); err != nil {
		return err
	}
	return nil
}

// DeleteFileBlob removes only the original file blob from storage,
// leaving cache artifacts (proxy, thumbnail) intact.
func (s *Service) DeleteFileBlob(libraryID, fileID string) error {
	prefix := fmt.Sprintf("%s/%s", libraryID, fileID)
	return s.driver.DeletePrefix(ScopeFiles, prefix)
}

func (s *Service) FileExists(libraryID, fileID string) (bool, error) {
	return s.driver.Exists(ScopeFiles, fileKey(libraryID, fileID))
}

func (s *Service) ReadFileBuffer(libraryID, fileID string) ([]byte, error) {
	return s.driver.ReadBuffer(ScopeFiles, fileKey(libraryID, fileID))
}

func (s *Service) FileStat(libraryID, fileID string) (int64, error) {
	return s.driver.Stat(ScopeFiles, fileKey(libraryID, fileID))
}

func (s *Service) OpenFileReadStream(libraryID, fileID string, byteRange *ByteRange) (io.ReadCloser, error) {
	return s.driver.OpenReadStream(ScopeFiles, fileKey(libraryID, fileID), byteRange)
}

// Avatar operations
func (s *Service) StoreAvatar(userID string, data []byte) error {
	return s.driver.PutBuffer(ScopeAvatars, avatarKey(userID), data)
}

func (s *Service) AvatarExists(userID string) (bool, error) {
	return s.driver.Exists(ScopeAvatars, avatarKey(userID))
}

func (s *Service) ReadAvatarBuffer(userID string) ([]byte, error) {
	return s.driver.ReadBuffer(ScopeAvatars, avatarKey(userID))
}

// Cache operations
func (s *Service) CacheExists(cacheKey string) (bool, error) {
	return s.driver.Exists(ScopeCache, cacheKey)
}

func (s *Service) OpenCacheReadStream(cacheKey string) (io.ReadCloser, error) {
	return s.driver.OpenReadStream(ScopeCache, cacheKey, nil)
}

func (s *Service) ReadCacheBuffer(cacheKey string) ([]byte, error) {
	return s.driver.ReadBuffer(ScopeCache, cacheKey)
}

func (s *Service) StoreCacheBuffer(cacheKey string, data []byte) error {
	return s.driver.PutBuffer(ScopeCache, cacheKey, data)
}

func (s *Service) StoreCacheStream(cacheKey string, reader io.Reader) (int64, error) {
	return s.driver.PutStream(ScopeCache, cacheKey, reader)
}

func (s *Service) DeleteCachePrefix(prefix string) error {
	return s.driver.DeletePrefix(ScopeCache, prefix)
}

func fileKey(libraryID, fileID string) string {
	return fmt.Sprintf("%s/%s/blob", libraryID, fileID)
}

func avatarKey(userID string) string {
	return fmt.Sprintf("%s/avatar.webp", userID)
}

// LocalDriver implements Driver using the local filesystem.
type LocalDriver struct {
	roots map[Scope]string
}

func NewLocalDriver(filesRoot, avatarsRoot, cacheRoot string) *LocalDriver {
	return &LocalDriver{
		roots: map[Scope]string{
			ScopeFiles:   filesRoot,
			ScopeAvatars: avatarsRoot,
			ScopeCache:   cacheRoot,
		},
	}
}

func (d *LocalDriver) EnsureReady() error {
	for _, root := range d.roots {
		if err := os.MkdirAll(root, 0o755); err != nil {
			return fmt.Errorf("failed to create storage directory %s: %w", root, err)
		}
	}
	return nil
}

func (d *LocalDriver) resolve(scope Scope, key string) string {
	return filepath.Join(d.roots[scope], key)
}

func (d *LocalDriver) PutBuffer(scope Scope, key string, data []byte) error {
	path := d.resolve(scope, key)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (d *LocalDriver) PutStream(scope Scope, key string, reader io.Reader) (int64, error) {
	path := d.resolve(scope, key)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	f, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return io.Copy(f, reader)
}

func (d *LocalDriver) OpenReadStream(scope Scope, key string, byteRange *ByteRange) (io.ReadCloser, error) {
	path := d.resolve(scope, key)
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	if byteRange != nil {
		if _, err := f.Seek(byteRange.Start, io.SeekStart); err != nil {
			f.Close()
			return nil, err
		}
		if byteRange.End >= 0 {
			length := byteRange.End - byteRange.Start + 1
			return &limitedReadCloser{Reader: io.LimitReader(f, length), Closer: f}, nil
		}
	}

	return f, nil
}

func (d *LocalDriver) ReadBuffer(scope Scope, key string) ([]byte, error) {
	return os.ReadFile(d.resolve(scope, key))
}

func (d *LocalDriver) Exists(scope Scope, key string) (bool, error) {
	_, err := os.Stat(d.resolve(scope, key))
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil, err
}

func (d *LocalDriver) Stat(scope Scope, key string) (int64, error) {
	info, err := os.Stat(d.resolve(scope, key))
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func (d *LocalDriver) DeletePrefix(scope Scope, keyPrefix string) error {
	path := d.resolve(scope, keyPrefix)
	return os.RemoveAll(path)
}

// limitedReadCloser wraps an io.Reader with an independent Closer.
type limitedReadCloser struct {
	io.Reader
	io.Closer
}
