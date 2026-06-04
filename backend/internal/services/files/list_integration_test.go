package files

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// newCtx builds an echo.Context whose request carries the given query params.
func newCtx(t *testing.T, params map[string]string) echo.Context {
	t.Helper()
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	target := "/?" + q.Encode()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	return echo.New().NewContext(req, rec)
}

// createTagFixture inserts a tag and returns its ID.
func createTag(t *testing.T, db *gorm.DB, libID uuid.UUID, name, color string) uuid.UUID {
	t.Helper()
	tag := models.Tag{LibraryID: libID, Name: name, Color: color}
	if err := db.Create(&tag).Error; err != nil {
		t.Fatalf("create tag %q: %v", name, err)
	}
	return tag.ID
}

func attachFileTag(t *testing.T, db *gorm.DB, fileID, tagID uuid.UUID) {
	t.Helper()
	if err := db.Create(&models.FileTag{FileID: fileID, TagID: tagID}).Error; err != nil {
		t.Fatalf("attach file tag: %v", err)
	}
}

func attachFolderTag(t *testing.T, db *gorm.DB, folderID, tagID uuid.UUID) {
	t.Helper()
	if err := db.Create(&models.FolderTag{FolderID: folderID, TagID: tagID}).Error; err != nil {
		t.Fatalf("attach folder tag: %v", err)
	}
}

func entryNames(entries []interface{}) []string {
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		switch v := e.(type) {
		case FileResponse:
			names = append(names, v.Name)
		case FolderResponse:
			names = append(names, v.Name)
		}
	}
	return names
}

func TestListLibraryFiles_RootListing(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Folders sort first (kindRank 0) by lower(name), then files.
	createTestFolder(t, db, fix.LibraryID, "Bravo", false, nil)
	createTestFolder(t, db, fix.LibraryID, "alpha", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "zebra.jpg", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "apple.jpg", false, nil)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, nil))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}

	if res.TotalCount != 4 {
		t.Fatalf("expected total 4, got %d", res.TotalCount)
	}
	if res.NextCursor != nil {
		t.Fatalf("expected no next cursor, got %v", *res.NextCursor)
	}
	if len(res.Breadcrumbs) != 0 {
		t.Fatalf("expected no breadcrumbs at root, got %v", res.Breadcrumbs)
	}
	if res.CurrentFolderID != nil {
		t.Fatalf("expected nil current folder, got %v", *res.CurrentFolderID)
	}

	// Folders first (alpha, Bravo), then files (apple.jpg, zebra.jpg).
	got := entryNames(res.Entries)
	want := []string{"alpha", "Bravo", "apple.jpg", "zebra.jpg"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("entry[%d]: expected %q, got %q (all: %v)", i, want[i], got[i], got)
		}
	}

	// First entry is a folder with owner unset (folders created without owner)
	// and an empty tags slice (never nil for JSON consistency).
	folder, ok := res.Entries[0].(FolderResponse)
	if !ok {
		t.Fatalf("expected first entry to be FolderResponse, got %T", res.Entries[0])
	}
	if folder.Kind != "folder" {
		t.Fatalf("expected kind folder, got %q", folder.Kind)
	}
	if folder.Tags == nil {
		t.Fatalf("folder tags must be a non-nil slice")
	}

	// File entries carry the owner summary + default mime fallback handling.
	var sawFile bool
	for _, e := range res.Entries {
		if f, ok := e.(FileResponse); ok {
			sawFile = true
			if f.Owner == nil || f.Owner.DisplayName != "Listing Test User" {
				t.Fatalf("expected owner summary on file %q, got %+v", f.Name, f.Owner)
			}
			if f.Tags == nil {
				t.Fatalf("file tags must be non-nil")
			}
			if f.MimeType != "image/jpeg" {
				t.Fatalf("expected mime image/jpeg, got %q", f.MimeType)
			}
		}
	}
	if !sawFile {
		t.Fatal("expected at least one file entry")
	}
}

func TestListLibraryFiles_WithTags(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	fileID := createTestFile(t, db, fix.LibraryID, fix.UserID, "tagged.jpg", false, nil)
	folderID := createTestFolder(t, db, fix.LibraryID, "TaggedFolder", false, nil)

	// Tags must come back sorted by name ascending.
	zTag := createTag(t, db, fix.LibraryID, "zeta", "#fff")
	aTag := createTag(t, db, fix.LibraryID, "alpha", "#000")
	attachFileTag(t, db, fileID, zTag)
	attachFileTag(t, db, fileID, aTag)

	fTag := createTag(t, db, fix.LibraryID, "folderTag", "#abc")
	attachFolderTag(t, db, folderID, fTag)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, nil))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}

	for _, e := range res.Entries {
		switch v := e.(type) {
		case FileResponse:
			if len(v.Tags) != 2 {
				t.Fatalf("expected 2 tags on file, got %d", len(v.Tags))
			}
			if v.Tags[0].Name != "alpha" || v.Tags[1].Name != "zeta" {
				t.Fatalf("file tags not sorted: %+v", v.Tags)
			}
			if v.Tags[0].Color != "#000" {
				t.Fatalf("expected tag color #000, got %q", v.Tags[0].Color)
			}
		case FolderResponse:
			if len(v.Tags) != 1 || v.Tags[0].Name != "folderTag" {
				t.Fatalf("expected 1 folder tag 'folderTag', got %+v", v.Tags)
			}
		}
	}
}

func TestListLibraryFiles_InsideFolderHasBreadcrumbs(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	parent := createTestFolder(t, db, fix.LibraryID, "Parent", false, nil)
	child := createTestFolder(t, db, fix.LibraryID, "Child", false, &parent)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "inside.jpg", false, &child)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"folder": child.String()}))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}

	if res.CurrentFolderID == nil || *res.CurrentFolderID != child.String() {
		t.Fatalf("expected current folder %s, got %v", child, res.CurrentFolderID)
	}
	// Breadcrumbs root -> leaf: Parent, Child
	if len(res.Breadcrumbs) != 2 {
		t.Fatalf("expected 2 breadcrumbs, got %d: %+v", len(res.Breadcrumbs), res.Breadcrumbs)
	}
	if res.Breadcrumbs[0].Name != "Parent" || res.Breadcrumbs[1].Name != "Child" {
		t.Fatalf("breadcrumb order wrong: %+v", res.Breadcrumbs)
	}
	if res.TotalCount != 1 || len(res.Entries) != 1 {
		t.Fatalf("expected 1 entry inside child folder, got total=%d entries=%d", res.TotalCount, len(res.Entries))
	}
}

func TestListLibraryFiles_InvalidFolderID(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	_, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"folder": "not-a-uuid"}))
	if err == nil {
		t.Fatal("expected error for invalid folder id")
	}
}

func TestListLibraryFiles_InvalidCursor(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	_, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"cursor": "!!!bad"}))
	if err == nil {
		t.Fatal("expected error for invalid cursor")
	}
}

func TestListLibraryFiles_NonexistentFolderBreadcrumbError(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// A well-formed UUID that does not exist -> breadcrumb lookup returns 404.
	missing := uuid.New().String()
	_, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"folder": missing}))
	if err == nil {
		t.Fatal("expected not-found error for missing folder breadcrumb")
	}
}

func TestListLibraryFiles_Pagination(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// 5 files at root, limit 2 -> expect pagination across 3 pages.
	for _, n := range []string{"a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"} {
		createTestFile(t, db, fix.LibraryID, fix.UserID, n, false, nil)
	}

	var collected []string
	cursor := ""
	pages := 0
	for {
		params := map[string]string{"limit": "2"}
		if cursor != "" {
			params["cursor"] = cursor
		}
		res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, params))
		if err != nil {
			t.Fatalf("page %d: %v", pages, err)
		}
		if res.TotalCount != 5 {
			t.Fatalf("expected total 5 each page, got %d", res.TotalCount)
		}
		collected = append(collected, entryNames(res.Entries)...)
		pages++
		if res.NextCursor == nil {
			break
		}
		cursor = *res.NextCursor
		if pages > 10 {
			t.Fatal("pagination did not terminate")
		}
	}

	if pages != 3 {
		t.Fatalf("expected 3 pages, got %d", pages)
	}
	want := []string{"a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"}
	if len(collected) != len(want) {
		t.Fatalf("expected %v, got %v", want, collected)
	}
	for i := range want {
		if collected[i] != want[i] {
			t.Fatalf("page item[%d]: expected %q got %q (all %v)", i, want[i], collected[i], collected)
		}
	}
}

func TestListLibraryFiles_PaginationAcrossFoldersAndFiles(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// 2 folders + 2 files, limit 2 -> first page is folders, second page files.
	createTestFolder(t, db, fix.LibraryID, "f1", false, nil)
	createTestFolder(t, db, fix.LibraryID, "f2", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "x.jpg", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "y.jpg", false, nil)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"limit": "2"}))
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if res.NextCursor == nil {
		t.Fatal("expected next cursor after first page")
	}
	page1 := entryNames(res.Entries)
	if page1[0] != "f1" || page1[1] != "f2" {
		t.Fatalf("expected folders on page 1, got %v", page1)
	}
	// Decode the cursor to confirm it points past folders (kindRank 0, sortName f2).
	raw, _ := base64.StdEncoding.DecodeString(*res.NextCursor)
	var cp CursorPayload
	if err := json.Unmarshal(raw, &cp); err != nil {
		t.Fatalf("cursor decode: %v", err)
	}
	if cp.KindRank != 0 || cp.SortName != "f2" {
		t.Fatalf("unexpected cursor payload: %+v", cp)
	}

	res2, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"limit": "2", "cursor": *res.NextCursor}))
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	page2 := entryNames(res2.Entries)
	if len(page2) != 2 || page2[0] != "x.jpg" || page2[1] != "y.jpg" {
		t.Fatalf("expected files on page 2, got %v", page2)
	}
	if res2.NextCursor != nil {
		t.Fatalf("expected no further cursor, got %v", *res2.NextCursor)
	}
}

func TestListLibraryFiles_FileCursorPage(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	createTestFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "b.jpg", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "c.jpg", false, nil)

	// Craft a file cursor positioned after "a.jpg" so the file query exercises
	// the kindRank==1 branch (cursorClause applied to files).
	first := getFileIDByName(t, db, fix.LibraryID, "a.jpg")
	cp := CursorPayload{KindRank: 1, SortName: "a.jpg", ID: first.String()}
	data, _ := json.Marshal(cp)
	cursor := base64.StdEncoding.EncodeToString(data)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"cursor": cursor}))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}
	got := entryNames(res.Entries)
	want := []string{"b.jpg", "c.jpg"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("item[%d] expected %q got %q", i, want[i], got[i])
		}
	}
}

func TestListLibraryFiles_TrashView(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Trashed folder with trashed files inside (file count should be reported).
	tf := createTestFolder(t, db, fix.LibraryID, "TrashedFolder", true, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "deep1.jpg", true, &tf)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "deep2.jpg", true, &tf)
	// Standalone trashed file at root.
	createTestFile(t, db, fix.LibraryID, fix.UserID, "trashed_root.jpg", true, nil)
	// Active content must NOT appear in trash view.
	createTestFolder(t, db, fix.LibraryID, "ActiveFolder", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active.jpg", false, nil)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, map[string]string{"trashed": "true"}))
	if err != nil {
		t.Fatalf("ListLibraryFiles trash: %v", err)
	}

	// In trash view current folder + breadcrumbs are always empty/nil.
	if res.CurrentFolderID != nil {
		t.Fatalf("trash view should have nil current folder, got %v", *res.CurrentFolderID)
	}
	if len(res.Breadcrumbs) != 0 {
		t.Fatalf("trash view should have no breadcrumbs, got %v", res.Breadcrumbs)
	}

	// Top-level trash: TrashedFolder + trashed_root.jpg = 2 entries.
	if res.TotalCount != 2 {
		t.Fatalf("expected 2 trash entries, got %d (%v)", res.TotalCount, entryNames(res.Entries))
	}

	// The trashed folder carries TrashFileCount = 2 (deep1 + deep2).
	var checkedFolder bool
	for _, e := range res.Entries {
		if f, ok := e.(FolderResponse); ok && f.Name == "TrashedFolder" {
			checkedFolder = true
			if f.TrashFileCount == nil {
				t.Fatal("expected TrashFileCount to be set in trash view")
			}
			if *f.TrashFileCount != 2 {
				t.Fatalf("expected trash file count 2, got %d", *f.TrashFileCount)
			}
			if f.TrashedAt == nil {
				t.Fatal("trashed folder should carry trashedAt")
			}
		}
		if f, ok := e.(FileResponse); ok {
			if f.TrashedAt == nil {
				t.Fatalf("trashed file %q must carry trashedAt", f.Name)
			}
		}
	}
	if !checkedFolder {
		t.Fatal("did not find TrashedFolder in trash entries")
	}
}

func TestListLibraryFiles_HasDuplicatesFlag(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Two active files sharing a hash -> both flagged HasDuplicates.
	hash := "sharedhash"
	mkHashedFile(t, db, fix.LibraryID, fix.UserID, "dup1.jpg", &hash)
	mkHashedFile(t, db, fix.LibraryID, fix.UserID, "dup2.jpg", &hash)
	// A unique file -> not flagged.
	uniq := "uniquehash"
	mkHashedFile(t, db, fix.LibraryID, fix.UserID, "solo.jpg", &uniq)
	// A file with no hash -> not flagged.
	createTestFile(t, db, fix.LibraryID, fix.UserID, "nohash.jpg", false, nil)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, nil))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}

	byName := map[string]FileResponse{}
	for _, e := range res.Entries {
		if f, ok := e.(FileResponse); ok {
			byName[f.Name] = f
		}
	}
	if !byName["dup1.jpg"].HasDuplicates || !byName["dup2.jpg"].HasDuplicates {
		t.Fatalf("expected dup1+dup2 flagged as duplicates")
	}
	if byName["solo.jpg"].HasDuplicates {
		t.Fatal("solo.jpg should not be flagged")
	}
	if byName["nohash.jpg"].HasDuplicates {
		t.Fatal("nohash.jpg should not be flagged")
	}
	if byName["dup1.jpg"].Hash == nil || *byName["dup1.jpg"].Hash != hash {
		t.Fatalf("expected hash on dup1, got %v", byName["dup1.jpg"].Hash)
	}
}

func TestListLibraryFiles_EmptyLibrary(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, nil))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}
	if res.TotalCount != 0 {
		t.Fatalf("expected 0 total for empty library, got %d", res.TotalCount)
	}
	if len(res.Entries) != 0 {
		t.Fatalf("expected no entries, got %d", len(res.Entries))
	}
	if res.Entries == nil {
		t.Fatal("entries must be a non-nil empty slice")
	}
	if res.Breadcrumbs == nil {
		t.Fatal("breadcrumbs must be a non-nil empty slice")
	}
}

func TestListLibraryFiles_FileMetadataMapping(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create a file with rich metadata to exercise the response mapping branch.
	dur := 120
	w, h := 1920, 1080
	status := "ready"
	prog := 100
	eta := 0
	orig := time.Now().Add(-time.Hour)
	file := models.File{
		LibraryID:         fix.LibraryID,
		OwnerID:           &fix.UserID,
		Name:              "movie.mp4",
		MimeType:          "video/mp4",
		Size:              99999,
		Duration:          &dur,
		Width:             &w,
		Height:            &h,
		ProxyStatus:       &status,
		ProxyProgress:     &prog,
		ProxyEtaSeconds:   &eta,
		OriginalCreatedAt: &orig,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("create rich file: %v", err)
	}

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, nil))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}
	if len(res.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(res.Entries))
	}
	f, ok := res.Entries[0].(FileResponse)
	if !ok {
		t.Fatalf("expected FileResponse, got %T", res.Entries[0])
	}
	if f.MimeType != "video/mp4" || f.Size != 99999 {
		t.Fatalf("metadata mismatch: %+v", f)
	}
	if f.Duration == nil || *f.Duration != 120 {
		t.Fatalf("expected duration 120, got %v", f.Duration)
	}
	if f.Width == nil || *f.Width != 1920 || f.Height == nil || *f.Height != 1080 {
		t.Fatalf("dimensions mismatch: w=%v h=%v", f.Width, f.Height)
	}
	if f.ProxyStatus == nil || *f.ProxyStatus != "ready" {
		t.Fatalf("expected proxy status ready, got %v", f.ProxyStatus)
	}
	if f.OriginalCreatedAt == nil {
		t.Fatal("expected originalCreatedAt to be populated")
	}
}

func TestListLibraryFiles_DerivedFilesExcluded(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	srcID := createTestFile(t, db, fix.LibraryID, fix.UserID, "source.mp4", false, nil)
	// A derived file (proxy) has source_file_id set and must be excluded.
	derived := models.File{
		LibraryID:    fix.LibraryID,
		OwnerID:      &fix.UserID,
		Name:         "source_proxy.mp4",
		MimeType:     "video/mp4",
		Size:         10,
		SourceFileID: &srcID,
	}
	if err := db.Create(&derived).Error; err != nil {
		t.Fatalf("create derived: %v", err)
	}

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, nil))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}
	if res.TotalCount != 1 {
		t.Fatalf("expected 1 (derived excluded), got %d: %v", res.TotalCount, entryNames(res.Entries))
	}
	if res.Entries[0].(FileResponse).Name != "source.mp4" {
		t.Fatalf("expected only source.mp4, got %v", entryNames(res.Entries))
	}
}

func TestListLibraryFiles_OwnerlessFileHasNilOwner(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	f := models.File{LibraryID: fix.LibraryID, Name: "orphan.jpg", MimeType: "image/png", Size: 5}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create ownerless file: %v", err)
	}

	res, err := svc.ListLibraryFiles(fix.LibraryID.String(), newCtx(t, nil))
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}
	fr := res.Entries[0].(FileResponse)
	if fr.Owner != nil {
		t.Fatalf("expected nil owner for ownerless file, got %+v", fr.Owner)
	}
}

// --- helpers ---

func getFileIDByName(t *testing.T, db *gorm.DB, libID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	var f models.File
	if err := db.Where("library_id = ? AND name = ?", libID, name).First(&f).Error; err != nil {
		t.Fatalf("lookup file %q: %v", name, err)
	}
	return f.ID
}

func mkHashedFile(t *testing.T, db *gorm.DB, libID, ownerID uuid.UUID, name string, hash *string) uuid.UUID {
	t.Helper()
	f := models.File{
		LibraryID: libID,
		OwnerID:   &ownerID,
		Name:      name,
		MimeType:  "image/jpeg",
		Size:      1,
		Hash:      hash,
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create hashed file %q: %v", name, err)
	}
	return f.ID
}
