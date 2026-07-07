package files

import (
	"path/filepath"
	"sort"
	"testing"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// newPurgeService builds an ingest-configured files.Service backed by an
// isolated temp local-storage driver, matching the ingest_test harness.
func newPurgeService(t *testing.T) (*Service, *gorm.DB, *storage.Service) {
	t.Helper()
	db := setupListingTestDB(t)
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")
	root := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	st := storage.NewService(driver)
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	svc := NewServiceWithIngest(db, IngestDeps{Storage: st})
	return svc, db, st
}

// ---------------------------------------------------------------------------
// DescendantFolderIDs
// ---------------------------------------------------------------------------

func TestDescendantFolderIDs_ReturnsAllDescendantsExclusive(t *testing.T) {
	_, db, _ := newPurgeService(t)
	fx := seedListingLibrary(t, db)

	// parent -> child -> grandchild, plus a second branch parent -> child2
	parent := createTestFolder(t, db, fx.LibraryID, "parent", false, nil)
	child := createTestFolder(t, db, fx.LibraryID, "child", false, &parent)
	grandchild := createTestFolder(t, db, fx.LibraryID, "grandchild", false, &child)
	child2 := createTestFolder(t, db, fx.LibraryID, "child2", false, &parent)

	got := DescendantFolderIDs(db, fx.LibraryID.String(), parent.String())
	sort.Strings(got)
	want := []string{child.String(), child2.String(), grandchild.String()}
	sort.Strings(want)

	if len(got) != len(want) {
		t.Fatalf("got %d descendants %v, want %d %v", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("descendants mismatch: got %v want %v", got, want)
		}
	}

	// Root must be excluded.
	for _, id := range got {
		if id == parent.String() {
			t.Fatal("root folder must be excluded from descendants")
		}
	}
}

func TestDescendantFolderIDs_RespectsLibraryScoping(t *testing.T) {
	_, db, _ := newPurgeService(t)
	fx1 := seedListingLibrary(t, db)
	fx2 := seedListingLibrary(t, db)

	parent := createTestFolder(t, db, fx1.LibraryID, "parent", false, nil)
	createTestFolder(t, db, fx1.LibraryID, "child", false, &parent)

	// Querying with the wrong library must return nothing.
	got := DescendantFolderIDs(db, fx2.LibraryID.String(), parent.String())
	if len(got) != 0 {
		t.Fatalf("expected 0 descendants for cross-library query, got %v", got)
	}
}

func TestDescendantFolderIDs_LeafReturnsEmpty(t *testing.T) {
	_, db, _ := newPurgeService(t)
	fx := seedListingLibrary(t, db)
	leaf := createTestFolder(t, db, fx.LibraryID, "leaf", false, nil)

	got := DescendantFolderIDs(db, fx.LibraryID.String(), leaf.String())
	if len(got) != 0 {
		t.Fatalf("expected no descendants for leaf folder, got %v", got)
	}
}

// ---------------------------------------------------------------------------
// Service.Purge
// ---------------------------------------------------------------------------

func TestPurge_NotConfigured(t *testing.T) {
	db := setupListingTestDB(t)
	svc := NewService(db) // no ingest deps → storage unavailable
	if _, err := svc.Purge("lib", PurgeParams{}); err == nil {
		t.Fatal("expected error when service is not configured for purge")
	}
}

func TestPurge_TrashedFileDeletesDerivedRowsAndBlobs(t *testing.T) {
	svc, db, st := newPurgeService(t)
	fx := seedListingLibrary(t, db)

	source := createTestFile(t, db, fx.LibraryID, fx.UserID, "source.mp4", true, nil)
	if err := st.StoreFile(fx.LibraryID.String(), source.String(), []byte("src")); err != nil {
		t.Fatalf("StoreFile source: %v", err)
	}

	// Derived proxy + thumbnail rows referencing the source via source_file_id.
	proxy := models.File{
		LibraryID:    fx.LibraryID,
		Name:         "source_proxy.mp4",
		MimeType:     "video/mp4",
		Size:         10,
		OwnerID:      &fx.UserID,
		SourceFileID: &source,
	}
	if err := db.Create(&proxy).Error; err != nil {
		t.Fatalf("create proxy: %v", err)
	}
	if err := st.StoreFile(fx.LibraryID.String(), proxy.ID.String(), []byte("proxy")); err != nil {
		t.Fatalf("StoreFile proxy: %v", err)
	}

	purged, err := svc.Purge(fx.LibraryID.String(), PurgeParams{FileIDs: []string{source.String()}})
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if purged != 1 {
		t.Fatalf("purged = %d, want 1 (source only)", purged)
	}

	// Source + derived rows gone.
	for _, id := range []string{source.String(), proxy.ID.String()} {
		var count int64
		db.Model(&models.File{}).Where("id = ?", id).Count(&count)
		if count != 0 {
			t.Fatalf("expected file row %s deleted, count=%d", id, count)
		}
	}

	// Source + derived blobs gone.
	for _, id := range []string{source.String(), proxy.ID.String()} {
		if exists, _ := st.FileExists(fx.LibraryID.String(), id); exists {
			t.Fatalf("expected blob %s deleted", id)
		}
	}
}

func TestPurge_IgnoresNonTrashedAndOtherLibrary(t *testing.T) {
	svc, db, st := newPurgeService(t)
	fx := seedListingLibrary(t, db)

	active := createTestFile(t, db, fx.LibraryID, fx.UserID, "active.jpg", false, nil)
	if err := st.StoreFile(fx.LibraryID.String(), active.String(), []byte("a")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	purged, err := svc.Purge(fx.LibraryID.String(), PurgeParams{FileIDs: []string{active.String()}})
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if purged != 0 {
		t.Fatalf("purged = %d, want 0 (active not trashed)", purged)
	}

	var count int64
	db.Model(&models.File{}).Where("id = ?", active.String()).Count(&count)
	if count != 1 {
		t.Fatalf("active file should remain, count=%d", count)
	}
	if exists, _ := st.FileExists(fx.LibraryID.String(), active.String()); !exists {
		t.Fatal("active blob should remain")
	}
}

func TestPurge_FolderCascadesDescendants(t *testing.T) {
	svc, db, st := newPurgeService(t)
	fx := seedListingLibrary(t, db)

	parent := createTestFolder(t, db, fx.LibraryID, "parent", true, nil)
	child := createTestFolder(t, db, fx.LibraryID, "child", true, &parent)

	fParent := createTestFile(t, db, fx.LibraryID, fx.UserID, "p.jpg", true, &parent)
	fChild := createTestFile(t, db, fx.LibraryID, fx.UserID, "c.jpg", true, &child)
	if err := st.StoreFile(fx.LibraryID.String(), fParent.String(), []byte("p")); err != nil {
		t.Fatalf("StoreFile p: %v", err)
	}
	if err := st.StoreFile(fx.LibraryID.String(), fChild.String(), []byte("c")); err != nil {
		t.Fatalf("StoreFile c: %v", err)
	}

	purged, err := svc.Purge(fx.LibraryID.String(), PurgeParams{FolderIDs: []string{parent.String()}})
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	// 2 files + 2 folders = 4
	if purged != 4 {
		t.Fatalf("purged = %d, want 4 (2 files + 2 folders)", purged)
	}

	for _, id := range []string{fParent.String(), fChild.String()} {
		var count int64
		db.Model(&models.File{}).Where("id = ?", id).Count(&count)
		if count != 0 {
			t.Fatalf("expected file %s deleted, count=%d", id, count)
		}
		if exists, _ := st.FileExists(fx.LibraryID.String(), id); exists {
			t.Fatalf("expected blob %s deleted", id)
		}
	}
	for _, id := range []string{parent.String(), child.String()} {
		var count int64
		db.Model(&models.Folder{}).Where("id = ?", id).Count(&count)
		if count != 0 {
			t.Fatalf("expected folder %s deleted, count=%d", id, count)
		}
	}
}

func TestPurge_RemovesDocumentState(t *testing.T) {
	svc, db, st := newPurgeService(t)
	if err := db.AutoMigrate(&models.Document{}, &models.DocumentUpdate{}); err != nil {
		t.Fatalf("migrate doc tables: %v", err)
	}
	// The doc tables FK into files within this shared schema — leftover rows
	// would break other tests' `DELETE FROM files` cleanup, so clear them on
	// the way in and out.
	clearDocs := func() {
		db.Exec("DELETE FROM document_updates")
		db.Exec("DELETE FROM documents")
	}
	clearDocs()
	t.Cleanup(clearDocs)
	fx := seedListingLibrary(t, db)

	// A trashed live document with CRDT state + a materialized blob.
	fileID := createTestFile(t, db, fx.LibraryID, fx.UserID, "notes.md", true, nil)
	if err := st.StoreFile(fx.LibraryID.String(), fileID.String(), []byte("# Doc")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	if err := db.Create(&models.Document{FileID: fileID, LibraryID: fx.LibraryID, LastSeq: 2}).Error; err != nil {
		t.Fatalf("create document: %v", err)
	}
	for seq := int64(1); seq <= 2; seq++ {
		if err := db.Create(&models.DocumentUpdate{FileID: fileID, Seq: seq, Data: []byte{byte(seq)}}).Error; err != nil {
			t.Fatalf("create update %d: %v", seq, err)
		}
	}

	purged, err := svc.Purge(fx.LibraryID.String(), PurgeParams{FileIDs: []string{fileID.String()}})
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if purged != 1 {
		t.Fatalf("purged = %d, want 1", purged)
	}

	var docCount, updateCount int64
	db.Model(&models.Document{}).Where("file_id = ?", fileID).Count(&docCount)
	db.Model(&models.DocumentUpdate{}).Where("file_id = ?", fileID).Count(&updateCount)
	if docCount != 0 || updateCount != 0 {
		t.Fatalf("doc rows = %d, update rows = %d, want 0/0", docCount, updateCount)
	}
	if exists, _ := st.FileExists(fx.LibraryID.String(), fileID.String()); exists {
		t.Fatal("expected materialized blob deleted")
	}
}
