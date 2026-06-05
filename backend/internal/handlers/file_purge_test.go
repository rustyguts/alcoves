package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func setupPurgeTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db := testsupport.OpenSchema(t, "handlers")

	if err := db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.Folder{},
		&models.File{},
		&models.Tag{},
		&models.FileTag{},
		&models.FolderTag{},
	); err != nil {
		t.Fatalf("Failed to migrate test schema: %v", err)
	}

	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	return db
}

func setupPurgeStorage(t *testing.T) *storage.Service {
	t.Helper()

	root := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	svc := storage.NewService(driver)
	if err := svc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	return svc
}

// purgeTestFixture holds the IDs created by seedLibrary.
type purgeTestFixture struct {
	UserID    uuid.UUID
	LibraryID uuid.UUID
}

func seedLibrary(t *testing.T, db *gorm.DB) purgeTestFixture {
	t.Helper()

	userID := uuid.New()
	user := models.User{
		BaseModel:   models.BaseModel{ID: userID},
		Email:       fmt.Sprintf("%s@test.com", userID.String()[:8]),
		DisplayName: "Purge Test User",
		Role:        "owner",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	libraryID := uuid.New()
	library := models.Library{
		BaseModel: models.BaseModel{ID: libraryID},
		Name:      "Purge Test Library",
		OwnerID:   userID,
	}
	if err := db.Create(&library).Error; err != nil {
		t.Fatalf("Failed to create library: %v", err)
	}

	return purgeTestFixture{UserID: userID, LibraryID: libraryID}
}

func createFile(t *testing.T, db *gorm.DB, libraryID, ownerID uuid.UUID, name string, trashed bool, parentFolderID *uuid.UUID) uuid.UUID {
	t.Helper()

	var trashedAt *time.Time
	if trashed {
		now := time.Now()
		trashedAt = &now
	}

	fileID := uuid.New()
	file := models.File{
		BaseModel:      models.BaseModel{ID: fileID},
		LibraryID:      libraryID,
		ParentFolderID: parentFolderID,
		Name:           name,
		MimeType:       "image/jpeg",
		Size:           100,
		OwnerID:        &ownerID,
		TrashedAt:      trashedAt,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("Failed to create file %s: %v", name, err)
	}
	return fileID
}

func createFolder(t *testing.T, db *gorm.DB, libraryID uuid.UUID, name string, trashed bool, parentFolderID *uuid.UUID) uuid.UUID {
	t.Helper()

	var trashedAt *time.Time
	if trashed {
		now := time.Now()
		trashedAt = &now
	}

	folderID := uuid.New()
	folder := models.Folder{
		BaseModel:      models.BaseModel{ID: folderID},
		LibraryID:      libraryID,
		ParentFolderID: parentFolderID,
		Name:           name,
		TrashedAt:      trashedAt,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatalf("Failed to create folder %s: %v", name, err)
	}
	return folderID
}

func createTag(t *testing.T, db *gorm.DB, libraryID uuid.UUID, name string) uuid.UUID {
	t.Helper()

	tagID := uuid.New()
	tag := models.Tag{
		BaseModel: models.BaseModel{ID: tagID},
		LibraryID: libraryID,
		Name:      name,
		Color:     "#ff0000",
	}
	if err := db.Create(&tag).Error; err != nil {
		t.Fatalf("Failed to create tag %s: %v", name, err)
	}
	return tagID
}

func tagFile(t *testing.T, db *gorm.DB, fileID, tagID uuid.UUID) {
	t.Helper()

	ft := models.FileTag{ID: uuid.New(), FileID: fileID, TagID: tagID}
	if err := db.Create(&ft).Error; err != nil {
		t.Fatalf("Failed to tag file: %v", err)
	}
}

func tagFolder(t *testing.T, db *gorm.DB, folderID, tagID uuid.UUID) {
	t.Helper()

	ft := models.FolderTag{ID: uuid.New(), FolderID: folderID, TagID: tagID}
	if err := db.Create(&ft).Error; err != nil {
		t.Fatalf("Failed to tag folder: %v", err)
	}
}

func storeBlob(t *testing.T, svc *storage.Service, libraryID, fileID string) {
	t.Helper()

	if err := svc.StoreFile(libraryID, fileID, []byte("file-data")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
}

func storeCacheArtifacts(t *testing.T, svc *storage.Service, libraryID, fileID string) {
	t.Helper()

	proxy := fmt.Sprintf("%s/%s/proxy.mp4", libraryID, fileID)
	thumb := fmt.Sprintf("%s/%s/thumbnail.webp", libraryID, fileID)
	if err := svc.StoreCacheBuffer(proxy, []byte("proxy")); err != nil {
		t.Fatalf("StoreCacheBuffer proxy: %v", err)
	}
	if err := svc.StoreCacheBuffer(thumb, []byte("thumb")); err != nil {
		t.Fatalf("StoreCacheBuffer thumb: %v", err)
	}
}

func callPurge(t *testing.T, handler *FileHandler, libraryID string, body interface{}) (*httptest.ResponseRecorder, error) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("Failed to marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/libraries/"+libraryID+"/files/purge", reader)
	if body != nil {
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(libraryID)

	err := handler.Purge(c)
	return rec, err
}

func assertRecordCount(t *testing.T, db *gorm.DB, model interface{}, where string, args []interface{}, expected int64, label string) {
	t.Helper()

	var count int64
	db.Model(model).Where(where, args...).Count(&count)
	if count != expected {
		t.Fatalf("Expected %d %s, got %d", expected, label, count)
	}
}

// ---------------------------------------------------------------------------
// Tests — Purge specific files
// ---------------------------------------------------------------------------

func TestPurge_SpecificTrashedFiles(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	f1 := createFile(t, db, fix.LibraryID, fix.UserID, "photo1.jpg", true, nil)
	f2 := createFile(t, db, fix.LibraryID, fix.UserID, "photo2.jpg", true, nil)
	storeBlob(t, svc, fix.LibraryID.String(), f1.String())
	storeBlob(t, svc, fix.LibraryID.String(), f2.String())

	body := map[string][]string{"fileIds": {f1.String(), f2.String()}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 2 {
		t.Fatalf("Expected purged=2, got %d", resp["purged"])
	}

	// DB records gone
	assertRecordCount(t, db, &models.File{}, "id IN ?", []interface{}{[]string{f1.String(), f2.String()}}, 0, "file records")

	// Storage blobs gone
	for _, fid := range []string{f1.String(), f2.String()} {
		exists, _ := svc.FileExists(fix.LibraryID.String(), fid)
		if exists {
			t.Fatalf("Expected file blob %s to be deleted", fid)
		}
	}
}

func TestPurge_IgnoresNonTrashedFiles(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	active := createFile(t, db, fix.LibraryID, fix.UserID, "active.jpg", false, nil)
	trashed := createFile(t, db, fix.LibraryID, fix.UserID, "trashed.jpg", true, nil)
	storeBlob(t, svc, fix.LibraryID.String(), active.String())
	storeBlob(t, svc, fix.LibraryID.String(), trashed.String())

	// Request purge of both, but only the trashed one should be purged.
	body := map[string][]string{"fileIds": {active.String(), trashed.String()}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 1 {
		t.Fatalf("Expected purged=1, got %d", resp["purged"])
	}

	// Active file still in DB
	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{active.String()}, 1, "active file records")

	// Active file still on disk
	exists, _ := svc.FileExists(fix.LibraryID.String(), active.String())
	if !exists {
		t.Fatal("Active file blob should still exist")
	}
}

func TestPurge_IgnoresFilesFromOtherLibrary(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix1 := seedLibrary(t, db)
	fix2 := seedLibrary(t, db)

	fileInLib2 := createFile(t, db, fix2.LibraryID, fix2.UserID, "other.jpg", true, nil)
	storeBlob(t, svc, fix2.LibraryID.String(), fileInLib2.String())

	// Try to purge the file from library 1 — it belongs to library 2
	body := map[string][]string{"fileIds": {fileInLib2.String()}}
	rec, err := callPurge(t, handler, fix1.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 0 {
		t.Fatalf("Expected purged=0, got %d", resp["purged"])
	}

	// File still in DB
	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{fileInLib2.String()}, 1, "file records in other library")
}

func TestPurge_DeletesBlobAndLegacyCache(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "cached.jpg", true, nil)
	storeBlob(t, svc, fix.LibraryID.String(), fid.String())
	storeCacheArtifacts(t, svc, fix.LibraryID.String(), fid.String())

	body := map[string][]string{"fileIds": {fid.String()}}
	_, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	// Source blob gone
	exists, _ := svc.FileExists(fix.LibraryID.String(), fid.String())
	if exists {
		t.Fatal("Expected blob to be deleted")
	}

	// Legacy cache artifacts also deleted on permanent purge
	for _, key := range []string{
		fmt.Sprintf("%s/%s/proxy.mp4", fix.LibraryID, fid),
		fmt.Sprintf("%s/%s/thumbnail.webp", fix.LibraryID, fid),
	} {
		cacheExists, err := svc.CacheExists(key)
		if err != nil {
			t.Fatalf("CacheExists(%s): %v", key, err)
		}
		if cacheExists {
			t.Fatalf("Expected legacy cache key %s to be deleted on purge", key)
		}
	}
}

func TestPurge_RemovesFileTags(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "tagged.jpg", true, nil)
	tag1 := createTag(t, db, fix.LibraryID, "landscape")
	tag2 := createTag(t, db, fix.LibraryID, "sunset")
	tagFile(t, db, fid, tag1)
	tagFile(t, db, fid, tag2)
	storeBlob(t, svc, fix.LibraryID.String(), fid.String())

	body := map[string][]string{"fileIds": {fid.String()}}
	_, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	assertRecordCount(t, db, &models.FileTag{}, "file_id = ?", []interface{}{fid.String()}, 0, "file_tag rows")

	// Tags themselves are not deleted
	assertRecordCount(t, db, &models.Tag{}, "id IN ?", []interface{}{[]string{tag1.String(), tag2.String()}}, 2, "tag records")
}

func TestPurge_DeletesDerivedFilesWithSource(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	original := createFile(t, db, fix.LibraryID, fix.UserID, "original.mp4", true, nil)
	storeBlob(t, svc, fix.LibraryID.String(), original.String())

	// Create a proxy file and a thumbnail file that reference the original via source_file_id.
	// These are never user-visible but must be fully deleted when the source is purged.
	proxyID := uuid.New()
	proxy := models.File{
		BaseModel:    models.BaseModel{ID: proxyID},
		LibraryID:    fix.LibraryID,
		Name:         "original_proxy.mp4",
		MimeType:     "video/mp4",
		Size:         50,
		OwnerID:      &fix.UserID,
		SourceFileID: &original,
	}
	if err := db.Create(&proxy).Error; err != nil {
		t.Fatalf("Failed to create proxy file: %v", err)
	}
	storeBlob(t, svc, fix.LibraryID.String(), proxyID.String())

	thumbID := uuid.New()
	thumb := models.File{
		BaseModel:    models.BaseModel{ID: thumbID},
		LibraryID:    fix.LibraryID,
		Name:         "original_thumb.jpg",
		MimeType:     "image/jpeg",
		Size:         10,
		OwnerID:      &fix.UserID,
		SourceFileID: &original,
	}
	if err := db.Create(&thumb).Error; err != nil {
		t.Fatalf("Failed to create thumbnail file: %v", err)
	}
	storeBlob(t, svc, fix.LibraryID.String(), thumbID.String())

	body := map[string][]string{"fileIds": {original.String()}}
	_, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	// Source file deleted from DB
	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{original.String()}, 0, "original file records")

	// Derived file rows (proxy and thumbnail) also deleted from DB
	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{proxyID.String()}, 0, "proxy file records")
	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{thumbID.String()}, 0, "thumbnail file records")

	// Derived blobs deleted from disk
	proxyExists, _ := svc.FileExists(fix.LibraryID.String(), proxyID.String())
	if proxyExists {
		t.Fatal("Expected proxy blob to be deleted")
	}
	thumbExists, _ := svc.FileExists(fix.LibraryID.String(), thumbID.String())
	if thumbExists {
		t.Fatal("Expected thumbnail blob to be deleted")
	}
}

// ---------------------------------------------------------------------------
// Tests — Purge all trashed items (empty body)
// ---------------------------------------------------------------------------

func TestPurge_AllTrashedItems(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)

	// Create a mix of trashed and active items
	trashedFile1 := createFile(t, db, fix.LibraryID, fix.UserID, "trash1.jpg", true, nil)
	trashedFile2 := createFile(t, db, fix.LibraryID, fix.UserID, "trash2.jpg", true, nil)
	activeFile := createFile(t, db, fix.LibraryID, fix.UserID, "active.jpg", false, nil)
	trashedFolder := createFolder(t, db, fix.LibraryID, "trash-folder", true, nil)
	activeFolder := createFolder(t, db, fix.LibraryID, "active-folder", false, nil)

	storeBlob(t, svc, fix.LibraryID.String(), trashedFile1.String())
	storeBlob(t, svc, fix.LibraryID.String(), trashedFile2.String())
	storeBlob(t, svc, fix.LibraryID.String(), activeFile.String())

	// Empty body = purge all trashed
	rec, err := callPurge(t, handler, fix.LibraryID.String(), nil)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	// 2 files + 1 folder = 3
	if resp["purged"] != 3 {
		t.Fatalf("Expected purged=3, got %d", resp["purged"])
	}

	// Trashed files gone
	assertRecordCount(t, db, &models.File{}, "id IN ?", []interface{}{[]string{trashedFile1.String(), trashedFile2.String()}}, 0, "trashed file records")

	// Active file preserved
	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{activeFile.String()}, 1, "active file records")

	// Trashed folder gone
	assertRecordCount(t, db, &models.Folder{}, "id = ?", []interface{}{trashedFolder.String()}, 0, "trashed folder records")

	// Active folder preserved
	assertRecordCount(t, db, &models.Folder{}, "id = ?", []interface{}{activeFolder.String()}, 1, "active folder records")

	// Active file blob preserved
	exists, _ := svc.FileExists(fix.LibraryID.String(), activeFile.String())
	if !exists {
		t.Fatal("Active file blob should still exist")
	}
}

func TestPurge_AllTrashedWithEmptyJSONBody(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "trash.jpg", true, nil)
	storeBlob(t, svc, fix.LibraryID.String(), fid.String())

	// Send empty JSON object
	rec, err := callPurge(t, handler, fix.LibraryID.String(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 1 {
		t.Fatalf("Expected purged=1, got %d", resp["purged"])
	}
}

func TestPurge_AllTrashedNothingToPurge(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	// Only active items
	createFile(t, db, fix.LibraryID, fix.UserID, "active.jpg", false, nil)

	rec, err := callPurge(t, handler, fix.LibraryID.String(), nil)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 0 {
		t.Fatalf("Expected purged=0, got %d", resp["purged"])
	}
}

// ---------------------------------------------------------------------------
// Tests — Purge folders
// ---------------------------------------------------------------------------

func TestPurge_SpecificFolder(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	folderID := createFolder(t, db, fix.LibraryID, "photos", true, nil)
	f1 := createFile(t, db, fix.LibraryID, fix.UserID, "in-folder.jpg", true, &folderID)
	storeBlob(t, svc, fix.LibraryID.String(), f1.String())

	body := map[string][]string{"folderIds": {folderID.String()}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	// 1 file + 1 folder = 2
	if resp["purged"] != 2 {
		t.Fatalf("Expected purged=2, got %d", resp["purged"])
	}

	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{f1.String()}, 0, "file records")
	assertRecordCount(t, db, &models.Folder{}, "id = ?", []interface{}{folderID.String()}, 0, "folder records")
}

func TestPurge_FolderWithDescendants(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)

	// parent -> child -> grandchild (all trashed)
	parentID := createFolder(t, db, fix.LibraryID, "parent", true, nil)
	childID := createFolder(t, db, fix.LibraryID, "child", true, &parentID)
	grandchildID := createFolder(t, db, fix.LibraryID, "grandchild", true, &childID)

	fInParent := createFile(t, db, fix.LibraryID, fix.UserID, "p.jpg", true, &parentID)
	fInChild := createFile(t, db, fix.LibraryID, fix.UserID, "c.jpg", true, &childID)
	fInGrandchild := createFile(t, db, fix.LibraryID, fix.UserID, "g.jpg", true, &grandchildID)

	storeBlob(t, svc, fix.LibraryID.String(), fInParent.String())
	storeBlob(t, svc, fix.LibraryID.String(), fInChild.String())
	storeBlob(t, svc, fix.LibraryID.String(), fInGrandchild.String())

	body := map[string][]string{"folderIds": {parentID.String()}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	// 3 files + 3 folders = 6
	if resp["purged"] != 6 {
		t.Fatalf("Expected purged=6, got %d", resp["purged"])
	}

	// All gone
	allFileIDs := []string{fInParent.String(), fInChild.String(), fInGrandchild.String()}
	allFolderIDs := []string{parentID.String(), childID.String(), grandchildID.String()}
	assertRecordCount(t, db, &models.File{}, "id IN ?", []interface{}{allFileIDs}, 0, "file records")
	assertRecordCount(t, db, &models.Folder{}, "id IN ?", []interface{}{allFolderIDs}, 0, "folder records")

	for _, fid := range allFileIDs {
		exists, _ := svc.FileExists(fix.LibraryID.String(), fid)
		if exists {
			t.Fatalf("Expected blob %s to be deleted", fid)
		}
	}
}

func TestPurge_FolderRemovesFolderTags(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	folderID := createFolder(t, db, fix.LibraryID, "tagged-folder", true, nil)
	tag := createTag(t, db, fix.LibraryID, "vacation")
	tagFolder(t, db, folderID, tag)

	body := map[string][]string{"folderIds": {folderID.String()}}
	_, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	assertRecordCount(t, db, &models.FolderTag{}, "folder_id = ?", []interface{}{folderID.String()}, 0, "folder_tag rows")

	// Tag itself preserved
	assertRecordCount(t, db, &models.Tag{}, "id = ?", []interface{}{tag.String()}, 1, "tag records")
}

func TestPurge_FolderPurgesFilesAndTheirTags(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	folderID := createFolder(t, db, fix.LibraryID, "folder", true, nil)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "tagged-in-folder.jpg", true, &folderID)
	tag := createTag(t, db, fix.LibraryID, "nature")
	tagFile(t, db, fid, tag)
	storeBlob(t, svc, fix.LibraryID.String(), fid.String())

	body := map[string][]string{"folderIds": {folderID.String()}}
	_, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{fid.String()}, 0, "file records")
	assertRecordCount(t, db, &models.FileTag{}, "file_id = ?", []interface{}{fid.String()}, 0, "file_tag rows")
}

// ---------------------------------------------------------------------------
// Tests — Error handling
// ---------------------------------------------------------------------------

// failingDeleteDriver fails on ScopeFiles deletes.
type failingDeleteDriver struct{}

func (d *failingDeleteDriver) EnsureReady() error                            { return nil }
func (d *failingDeleteDriver) PutBuffer(storage.Scope, string, []byte) error { return nil }
func (d *failingDeleteDriver) PutStream(storage.Scope, string, io.Reader) (int64, error) {
	return 0, nil
}
func (d *failingDeleteDriver) ReadBuffer(storage.Scope, string) ([]byte, error) { return nil, nil }
func (d *failingDeleteDriver) Exists(storage.Scope, string) (bool, error)       { return false, nil }
func (d *failingDeleteDriver) Stat(storage.Scope, string) (int64, error)        { return 0, nil }
func (d *failingDeleteDriver) OpenReadStream(storage.Scope, string, *storage.ByteRange) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}
func (d *failingDeleteDriver) DeletePrefix(scope storage.Scope, _ string) error {
	if scope == storage.ScopeFiles {
		return errors.New("disk I/O error")
	}
	return nil
}

func TestPurge_StorageDeleteFailsReturns500(t *testing.T) {
	db := setupPurgeTestDB(t)
	storageSvc := storage.NewService(&failingDeleteDriver{})
	handler := NewFileHandler(db, nil, storageSvc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "fail.jpg", true, nil)

	body := map[string][]string{"fileIds": {fid.String()}}
	_, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err == nil {
		t.Fatal("Expected purge to fail when storage delete fails")
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected *echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusInternalServerError {
		t.Fatalf("Expected 500, got %d", httpErr.Code)
	}
}

func TestPurge_StorageDeleteFailsPreservesDBRecords(t *testing.T) {
	db := setupPurgeTestDB(t)
	storageSvc := storage.NewService(&failingDeleteDriver{})
	handler := NewFileHandler(db, nil, storageSvc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "fail.jpg", true, nil)
	tag := createTag(t, db, fix.LibraryID, "important")
	tagFile(t, db, fid, tag)

	body := map[string][]string{"fileIds": {fid.String()}}
	callPurge(t, handler, fix.LibraryID.String(), body)

	// File and tag association still in DB
	assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{fid.String()}, 1, "file records after storage failure")
	assertRecordCount(t, db, &models.FileTag{}, "file_id = ?", []interface{}{fid.String()}, 1, "file_tag rows after storage failure")
}

func TestPurge_InvalidBodyReturnsBadRequest(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)

	req := httptest.NewRequest(http.MethodPost, "/api/libraries/"+fix.LibraryID.String()+"/files/purge",
		strings.NewReader(`{invalid json`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())

	err := handler.Purge(c)
	if err == nil {
		t.Fatal("Expected bad request error for invalid JSON")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected *echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400, got %d", httpErr.Code)
	}
}

// ---------------------------------------------------------------------------
// Tests — Edge cases
// ---------------------------------------------------------------------------

func TestPurge_EmptyFileIDsListPurgesAllTrashed(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "only-trashed.jpg", true, nil)
	storeBlob(t, svc, fix.LibraryID.String(), fid.String())

	// Empty arrays = same as no body = purge all
	body := map[string][]string{"fileIds": {}, "folderIds": {}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 1 {
		t.Fatalf("Expected purged=1, got %d", resp["purged"])
	}
}

func TestPurge_NonexistentFileIDs(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fakeID := uuid.New().String()

	body := map[string][]string{"fileIds": {fakeID}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 0 {
		t.Fatalf("Expected purged=0, got %d", resp["purged"])
	}
}

func TestPurge_MixedTrashedAndActiveInBulk(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	trashed1 := createFile(t, db, fix.LibraryID, fix.UserID, "t1.jpg", true, nil)
	trashed2 := createFile(t, db, fix.LibraryID, fix.UserID, "t2.jpg", true, nil)
	active1 := createFile(t, db, fix.LibraryID, fix.UserID, "a1.jpg", false, nil)
	active2 := createFile(t, db, fix.LibraryID, fix.UserID, "a2.jpg", false, nil)

	storeBlob(t, svc, fix.LibraryID.String(), trashed1.String())
	storeBlob(t, svc, fix.LibraryID.String(), trashed2.String())
	storeBlob(t, svc, fix.LibraryID.String(), active1.String())
	storeBlob(t, svc, fix.LibraryID.String(), active2.String())

	body := map[string][]string{"fileIds": {
		trashed1.String(), trashed2.String(), active1.String(), active2.String(),
	}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 2 {
		t.Fatalf("Expected purged=2 (only trashed), got %d", resp["purged"])
	}

	// Active files preserved
	for _, id := range []uuid.UUID{active1, active2} {
		assertRecordCount(t, db, &models.File{}, "id = ?", []interface{}{id.String()}, 1, "active file")
		exists, _ := svc.FileExists(fix.LibraryID.String(), id.String())
		if !exists {
			t.Fatalf("Active file %s blob should still exist", id)
		}
	}
}

func TestPurge_MultipleFilesWithTags(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	sharedTag := createTag(t, db, fix.LibraryID, "shared")

	f1 := createFile(t, db, fix.LibraryID, fix.UserID, "f1.jpg", true, nil)
	f2 := createFile(t, db, fix.LibraryID, fix.UserID, "f2.jpg", true, nil)
	activeFile := createFile(t, db, fix.LibraryID, fix.UserID, "active.jpg", false, nil)

	tagFile(t, db, f1, sharedTag)
	tagFile(t, db, f2, sharedTag)
	tagFile(t, db, activeFile, sharedTag)

	storeBlob(t, svc, fix.LibraryID.String(), f1.String())
	storeBlob(t, svc, fix.LibraryID.String(), f2.String())

	body := map[string][]string{"fileIds": {f1.String(), f2.String()}}
	_, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	// Purged files' tag associations gone
	assertRecordCount(t, db, &models.FileTag{}, "file_id IN ?", []interface{}{[]string{f1.String(), f2.String()}}, 0, "purged file_tag rows")

	// Active file's tag association preserved
	assertRecordCount(t, db, &models.FileTag{}, "file_id = ?", []interface{}{activeFile.String()}, 1, "active file_tag rows")
}

func TestPurge_FolderOnlyNoFilesInside(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	folderID := createFolder(t, db, fix.LibraryID, "empty-folder", true, nil)

	body := map[string][]string{"folderIds": {folderID.String()}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["purged"] != 1 {
		t.Fatalf("Expected purged=1 (folder only), got %d", resp["purged"])
	}

	assertRecordCount(t, db, &models.Folder{}, "id = ?", []interface{}{folderID.String()}, 0, "folder records")
}

func TestPurge_ResponseFormat(t *testing.T) {
	db := setupPurgeTestDB(t)
	svc := setupPurgeStorage(t)
	handler := NewFileHandler(db, nil, svc, nil, nil, nil, nil, nil, nil, nil, nil)

	fix := seedLibrary(t, db)
	fid := createFile(t, db, fix.LibraryID, fix.UserID, "format.jpg", true, nil)
	storeBlob(t, svc, fix.LibraryID.String(), fid.String())

	body := map[string][]string{"fileIds": {fid.String()}}
	rec, err := callPurge(t, handler, fix.LibraryID.String(), body)
	if err != nil {
		t.Fatalf("Purge returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}

	var resp map[string]int
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if _, ok := resp["purged"]; !ok {
		t.Fatal("Response missing 'purged' key")
	}
}
