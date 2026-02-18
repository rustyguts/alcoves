package files

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func TestParseCursor_EmptyString(t *testing.T) {
	result, err := parseCursor("")
	if err != nil || result != nil {
		t.Fatalf("Expected nil, nil for empty cursor; got %v, %v", result, err)
	}
}

func TestParseCursor_ValidFolderCursor(t *testing.T) {
	payload := CursorPayload{KindRank: 0, SortName: "documents", ID: "550e8400-e29b-41d4-a716-446655440000"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	result, err := parseCursor(encoded)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.KindRank != 0 || result.SortName != "documents" || result.ID != payload.ID {
		t.Fatalf("Cursor mismatch: %+v", result)
	}
}

func TestParseCursor_ValidFileCursor(t *testing.T) {
	payload := CursorPayload{KindRank: 1, SortName: "photo.jpg", ID: "550e8400-e29b-41d4-a716-446655440001"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	result, err := parseCursor(encoded)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.KindRank != 1 || result.SortName != "photo.jpg" {
		t.Fatalf("Cursor mismatch: %+v", result)
	}
}

func TestParseCursor_InvalidBase64(t *testing.T) {
	_, err := parseCursor("not-valid-base64!!!")
	if err == nil {
		t.Fatal("Expected error for invalid base64")
	}
}

func TestParseCursor_InvalidJSON(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("not json"))
	_, err := parseCursor(encoded)
	if err == nil {
		t.Fatal("Expected error for invalid JSON")
	}
}

func TestParseCursor_MissingFields(t *testing.T) {
	// Missing sortName and kindRank defaults to 0 in JSON - but ID is not a UUID
	encoded := base64.StdEncoding.EncodeToString([]byte(`{"id":"123"}`))
	_, err := parseCursor(encoded)
	if err == nil {
		t.Fatal("Expected error for invalid cursor (non-UUID ID)")
	}
}

func TestParseCursor_InvalidKindRank(t *testing.T) {
	payload := map[string]interface{}{"kindRank": 2, "sortName": "a", "id": "550e8400-e29b-41d4-a716-446655440000"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	_, err := parseCursor(encoded)
	if err == nil {
		t.Fatal("Expected error for invalid kindRank")
	}
}

func TestParseCursor_EmptySortName(t *testing.T) {
	payload := CursorPayload{KindRank: 0, SortName: "", ID: "550e8400-e29b-41d4-a716-446655440000"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	result, err := parseCursor(encoded)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.SortName != "" {
		t.Fatalf("Expected empty sortName, got %q", result.SortName)
	}
}

func TestParseLimit_Default(t *testing.T) {
	if v := parseLimit(""); v != DefaultLimit {
		t.Fatalf("Expected %d, got %d", DefaultLimit, v)
	}
	if v := parseLimit("abc"); v != DefaultLimit {
		t.Fatalf("Expected %d for NaN, got %d", DefaultLimit, v)
	}
}

func TestParseLimit_ClampsMinimum(t *testing.T) {
	if v := parseLimit("-5"); v != 1 {
		t.Fatalf("Expected 1, got %d", v)
	}
}

func TestParseLimit_ClampsMaximum(t *testing.T) {
	if v := parseLimit("500"); v != MaxLimit {
		t.Fatalf("Expected %d, got %d", MaxLimit, v)
	}
}

func TestParseLimit_ValidValues(t *testing.T) {
	if v := parseLimit("25"); v != 25 {
		t.Fatalf("Expected 25, got %d", v)
	}
	if v := parseLimit("100"); v != 100 {
		t.Fatalf("Expected 100, got %d", v)
	}
}

func TestNormalizeFolderID(t *testing.T) {
	// Nil for empty
	if v := normalizeFolderID(""); v != nil {
		t.Fatal("Expected nil for empty string")
	}

	// Nil for whitespace
	if v := normalizeFolderID("   "); v != nil {
		t.Fatal("Expected nil for whitespace")
	}

	// Nil for "null"
	if v := normalizeFolderID("null"); v != nil {
		t.Fatal("Expected nil for 'null'")
	}

	// Trims and returns valid folder IDs
	v := normalizeFolderID("folder-123")
	if v == nil || *v != "folder-123" {
		t.Fatalf("Expected 'folder-123', got %v", v)
	}

	v = normalizeFolderID("  folder-123  ")
	if v == nil || *v != "folder-123" {
		t.Fatalf("Expected 'folder-123', got %v", v)
	}

	// Any non-empty value
	v = normalizeFolderID("abc")
	if v == nil || *v != "abc" {
		t.Fatalf("Expected 'abc', got %v", v)
	}

	v = normalizeFolderID("0")
	if v == nil || *v != "0" {
		t.Fatalf("Expected '0', got %v", v)
	}
}

func TestEscapeSQLString(t *testing.T) {
	if v := escapeSQLString("hello"); v != "hello" {
		t.Fatalf("Expected 'hello', got %q", v)
	}
	if v := escapeSQLString("it's"); v != "it''s" {
		t.Fatalf("Expected escaped single quote, got %q", v)
	}
	if v := escapeSQLString("a''b"); v != "a''''b" {
		t.Fatalf("Expected double-escaped, got %q", v)
	}
}

// ---------------------------------------------------------------------------
// Query builder tests (no DB required)
// ---------------------------------------------------------------------------

func TestBuildFolderQueries_TrashRequiresTrashedAtNotNull(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, countQuery := svc.buildFolderQueries(libID, true, nil, nil, 50)

	if !strings.Contains(query, "trashed_at IS NOT NULL") {
		t.Fatalf("Trash folder query must require trashed_at IS NOT NULL.\nGot: %s", query)
	}
	if strings.Contains(query, "trashed_at IS NULL") {
		t.Fatalf("Trash folder query must NOT contain trashed_at IS NULL.\nGot: %s", query)
	}
	if !strings.Contains(countQuery, "trashed_at IS NOT NULL") {
		t.Fatalf("Trash folder count query must require trashed_at IS NOT NULL.\nGot: %s", countQuery)
	}
}

func TestBuildFolderQueries_NonTrashRequiresTrashedAtNull(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, countQuery := svc.buildFolderQueries(libID, false, nil, nil, 50)

	if !strings.Contains(query, "trashed_at IS NULL") {
		t.Fatalf("Non-trash folder query must require trashed_at IS NULL.\nGot: %s", query)
	}
	if strings.Contains(query, "trashed_at IS NOT NULL") {
		t.Fatalf("Non-trash folder query must NOT contain trashed_at IS NOT NULL.\nGot: %s", query)
	}
	if !strings.Contains(countQuery, "trashed_at IS NULL") {
		t.Fatalf("Non-trash folder count query must require trashed_at IS NULL.\nGot: %s", countQuery)
	}
}

func TestBuildFolderQueries_TrashExcludesChildrenOfTrashedParent(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, _ := svc.buildFolderQueries(libID, true, nil, nil, 50)

	// The query should exclude folders whose parent is also trashed
	if !strings.Contains(query, "NOT EXISTS") {
		t.Fatalf("Trash folder query must exclude children of trashed parents.\nGot: %s", query)
	}
}

func TestBuildFileQueries_TrashRequiresTrashedAtNotNull(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, countQuery := svc.buildFileQueries(libID, true, nil, nil, 50)

	if !strings.Contains(query, "trashed_at IS NOT NULL") {
		t.Fatalf("Trash file query must require trashed_at IS NOT NULL.\nGot: %s", query)
	}
	if strings.Contains(query, "trashed_at IS NULL") {
		t.Fatalf("Trash file query must NOT contain trashed_at IS NULL.\nGot: %s", query)
	}
	if !strings.Contains(countQuery, "trashed_at IS NOT NULL") {
		t.Fatalf("Trash file count query must require trashed_at IS NOT NULL.\nGot: %s", countQuery)
	}
}

func TestBuildFileQueries_NonTrashRequiresTrashedAtNull(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, countQuery := svc.buildFileQueries(libID, false, nil, nil, 50)

	if !strings.Contains(query, "trashed_at IS NULL") {
		t.Fatalf("Non-trash file query must require trashed_at IS NULL.\nGot: %s", query)
	}
	if strings.Contains(query, "trashed_at IS NOT NULL") {
		t.Fatalf("Non-trash file query must NOT contain trashed_at IS NOT NULL.\nGot: %s", query)
	}
	if !strings.Contains(countQuery, "trashed_at IS NULL") {
		t.Fatalf("Non-trash file count query must require trashed_at IS NULL.\nGot: %s", countQuery)
	}
}

func TestBuildFileQueries_TrashExcludesFilesInTrashedFolders(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, _ := svc.buildFileQueries(libID, true, nil, nil, 50)

	// The query should exclude files whose parent folder is trashed
	if !strings.Contains(query, "NOT EXISTS") {
		t.Fatalf("Trash file query must exclude files in trashed folders.\nGot: %s", query)
	}
}

func TestBuildFileQueries_NonTrashWithFolder(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"
	folderID := "folder-abc"

	query, countQuery := svc.buildFileQueries(libID, false, &folderID, nil, 50)

	if !strings.Contains(query, "parent_folder_id = 'folder-abc'") {
		t.Fatalf("Non-trash file query with folder must filter by parent_folder_id.\nGot: %s", query)
	}
	if !strings.Contains(query, "trashed_at IS NULL") {
		t.Fatalf("Non-trash file query must require trashed_at IS NULL.\nGot: %s", query)
	}
	if !strings.Contains(countQuery, "parent_folder_id = 'folder-abc'") {
		t.Fatalf("Non-trash file count query must filter by parent_folder_id.\nGot: %s", countQuery)
	}
}

func TestBuildFileQueries_NonTrashRootFolder(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, _ := svc.buildFileQueries(libID, false, nil, nil, 50)

	if !strings.Contains(query, "parent_folder_id IS NULL") {
		t.Fatalf("Non-trash root file query must filter parent_folder_id IS NULL.\nGot: %s", query)
	}
}

func TestBuildFileQueries_TrashIgnoresFolderParam(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"
	folderID := "folder-abc"

	query, _ := svc.buildFileQueries(libID, true, &folderID, nil, 50)

	// In trash mode the folder param should be ignored
	if strings.Contains(query, "folder-abc") {
		t.Fatalf("Trash file query must not use the folder parameter.\nGot: %s", query)
	}
	if !strings.Contains(query, "trashed_at IS NOT NULL") {
		t.Fatalf("Trash file query must require trashed_at IS NOT NULL.\nGot: %s", query)
	}
}

func TestBuildFolderQueries_TrashIgnoresFolderParam(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"
	folderID := "folder-abc"

	query, _ := svc.buildFolderQueries(libID, true, &folderID, nil, 50)

	// In trash mode the folder param should be ignored
	if strings.Contains(query, "folder-abc") {
		t.Fatalf("Trash folder query must not use the folder parameter.\nGot: %s", query)
	}
}

// ---------------------------------------------------------------------------
// DB-backed integration tests for trash listing
// ---------------------------------------------------------------------------

func setupListingTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}

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

	db.Exec("DELETE FROM file_tags")
	db.Exec("DELETE FROM folder_tags")
	db.Exec("DELETE FROM files")
	db.Exec("DELETE FROM folders")
	db.Exec("DELETE FROM tags")
	db.Exec("DELETE FROM libraries")
	db.Exec("DELETE FROM users")

	return db
}

type listingFixture struct {
	UserID    uuid.UUID
	LibraryID uuid.UUID
}

func seedListingLibrary(t *testing.T, db *gorm.DB) listingFixture {
	t.Helper()

	userID := uuid.New()
	db.Create(&models.User{
		ID:          userID,
		Email:       fmt.Sprintf("%s@test.com", userID.String()[:8]),
		DisplayName: "Listing Test User",
		Role:        "owner",
	})

	libID := uuid.New()
	db.Create(&models.Library{
		ID:      libID,
		Name:    "Listing Test Library",
		OwnerID: userID,
	})

	return listingFixture{UserID: userID, LibraryID: libID}
}

func createTestFile(t *testing.T, db *gorm.DB, libID, ownerID uuid.UUID, name string, trashed bool, parentFolderID *uuid.UUID) uuid.UUID {
	t.Helper()

	var trashedAt *time.Time
	if trashed {
		now := time.Now()
		trashedAt = &now
	}
	var pfID *uuid.UUID
	if parentFolderID != nil {
		pfID = parentFolderID
	}

	file := models.File{
		LibraryID:      libID,
		OwnerID:        &ownerID,
		Name:           name,
		MimeType:       "image/jpeg",
		Size:           1024,
		TrashedAt:      trashedAt,
		ParentFolderID: pfID,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("Failed to create file %q: %v", name, err)
	}
	return file.ID
}

func createTestFolder(t *testing.T, db *gorm.DB, libID uuid.UUID, name string, trashed bool, parentFolderID *uuid.UUID) uuid.UUID {
	t.Helper()

	var trashedAt *time.Time
	if trashed {
		now := time.Now()
		trashedAt = &now
	}

	folder := models.Folder{
		LibraryID:      libID,
		Name:           name,
		TrashedAt:      trashedAt,
		ParentFolderID: parentFolderID,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatalf("Failed to create folder %q: %v", name, err)
	}
	return folder.ID
}

func TestTrashListing_OnlyReturnsTrashedFiles(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create active files (should NOT appear in trash)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active1.jpg", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active2.jpg", false, nil)

	// Create trashed files (should appear in trash)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "trashed1.jpg", true, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "trashed2.jpg", true, nil)

	// Query trash files
	_, countQuery := svc.buildFileQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery).Scan(&count)

	if count != 2 {
		t.Fatalf("Expected 2 trashed files, got %d", count)
	}

	// Query active files
	_, activeCountQuery := svc.buildFileQueries(fix.LibraryID.String(), false, nil, nil, 50)
	var activeCount int
	db.Raw(activeCountQuery).Scan(&activeCount)

	if activeCount != 2 {
		t.Fatalf("Expected 2 active files, got %d", activeCount)
	}
}

func TestTrashListing_OnlyReturnsTrashedFolders(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create active folders (should NOT appear in trash)
	createTestFolder(t, db, fix.LibraryID, "ActiveFolder", false, nil)

	// Create trashed folders (should appear in trash)
	createTestFolder(t, db, fix.LibraryID, "TrashedFolder", true, nil)

	_, countQuery := svc.buildFolderQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery).Scan(&count)

	if count != 1 {
		t.Fatalf("Expected 1 trashed folder, got %d", count)
	}
}

func TestTrashListing_ExcludesChildrenOfTrashedParent(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create trashed parent with trashed child
	parentID := createTestFolder(t, db, fix.LibraryID, "ParentFolder", true, nil)
	createTestFolder(t, db, fix.LibraryID, "ChildFolder", true, &parentID)

	// Only the parent should appear at the top level of the trash
	_, countQuery := svc.buildFolderQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery).Scan(&count)

	if count != 1 {
		t.Fatalf("Expected 1 top-level trashed folder (parent only), got %d", count)
	}
}

func TestTrashListing_ExcludesFilesInTrashedFolders(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create trashed folder with trashed files inside it
	folderID := createTestFolder(t, db, fix.LibraryID, "TrashedFolder", true, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "file_in_folder.jpg", true, &folderID)

	// Create a standalone trashed file (not inside a trashed folder)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "standalone_trashed.jpg", true, nil)

	// Only the standalone file should appear at top level (the other is inside the trashed folder)
	_, countQuery := svc.buildFileQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery).Scan(&count)

	if count != 1 {
		t.Fatalf("Expected 1 top-level trashed file (standalone only), got %d", count)
	}
}

func TestTrashListing_ActiveFilesNeverAppearInTrash(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create a mix of active and trashed files across various folder states
	activeFolder := createTestFolder(t, db, fix.LibraryID, "ActiveFolder", false, nil)
	trashedFolder := createTestFolder(t, db, fix.LibraryID, "TrashedFolder", true, nil)

	// Active files in various locations
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active_root.jpg", false, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active_in_folder.jpg", false, &activeFolder)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active_in_trashed_folder.jpg", false, &trashedFolder)

	// Trashed files
	createTestFile(t, db, fix.LibraryID, fix.UserID, "trashed_root.jpg", true, nil)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "trashed_in_trashed_folder.jpg", true, &trashedFolder)

	// Execute the trash file listing query and scan actual rows
	query, _ := svc.buildFileQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var rows []listingRow
	db.Raw(query).Scan(&rows)

	// Verify every returned row has trashed_at set
	for _, row := range rows {
		if row.TrashedAt == nil {
			t.Fatalf("Trash listing returned file %q (id=%s) with trashed_at=nil — active files must never appear in trash",
				row.Name, row.ID)
		}
	}

	// Should only have 1 top-level trashed file (the standalone one; the one
	// inside the trashed folder is excluded from top level)
	if len(rows) != 1 {
		names := make([]string, len(rows))
		for i, r := range rows {
			names[i] = r.Name
		}
		t.Fatalf("Expected 1 top-level trashed file, got %d: %v", len(rows), names)
	}
	if rows[0].Name != "trashed_root.jpg" {
		t.Fatalf("Expected trashed_root.jpg, got %q", rows[0].Name)
	}
}

func TestTrashListing_ActiveFoldersNeverAppearInTrash(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	createTestFolder(t, db, fix.LibraryID, "ActiveFolder", false, nil)
	createTestFolder(t, db, fix.LibraryID, "TrashedFolder", true, nil)

	query, _ := svc.buildFolderQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var rows []listingRow
	db.Raw(query).Scan(&rows)

	for _, row := range rows {
		if row.TrashedAt == nil {
			t.Fatalf("Trash listing returned folder %q (id=%s) with trashed_at=nil — active folders must never appear in trash",
				row.Name, row.ID)
		}
	}

	if len(rows) != 1 {
		t.Fatalf("Expected 1 trashed folder, got %d", len(rows))
	}
}

func TestGetTrashedFolderFileCounts_OnlyCountsTrashedFiles(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create a trashed folder with both active and trashed files
	folderID := createTestFolder(t, db, fix.LibraryID, "TrashedFolder", true, nil)

	// Active files inside the trashed folder (should NOT be counted)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active_in_trash.jpg", false, &folderID)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "active_in_trash2.jpg", false, &folderID)

	// Trashed files inside the trashed folder (should be counted)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "trashed_in_trash.jpg", true, &folderID)

	counts := svc.getTrashedFolderFileCounts(fix.LibraryID.String(), []string{folderID.String()})

	if counts[folderID.String()] != 1 {
		t.Fatalf("Expected 1 trashed file in folder, got %d (active files must not be counted)", counts[folderID.String()])
	}
}

func TestGetTrashedFolderFileCounts_IncludesDescendantFiles(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Create trashed parent -> child -> grandchild folder hierarchy
	parentID := createTestFolder(t, db, fix.LibraryID, "Parent", true, nil)
	childID := createTestFolder(t, db, fix.LibraryID, "Child", true, &parentID)

	// Add trashed files at each level
	createTestFile(t, db, fix.LibraryID, fix.UserID, "parent_file.jpg", true, &parentID)
	createTestFile(t, db, fix.LibraryID, fix.UserID, "child_file.jpg", true, &childID)

	counts := svc.getTrashedFolderFileCounts(fix.LibraryID.String(), []string{parentID.String()})

	if counts[parentID.String()] != 2 {
		t.Fatalf("Expected 2 trashed files across parent and child folders, got %d", counts[parentID.String()])
	}
}

func TestGetTrashedFolderFileCounts_EmptyFolder(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	folderID := createTestFolder(t, db, fix.LibraryID, "EmptyTrash", true, nil)

	counts := svc.getTrashedFolderFileCounts(fix.LibraryID.String(), []string{folderID.String()})

	if counts[folderID.String()] != 0 {
		t.Fatalf("Expected 0 for empty trashed folder, got %d", counts[folderID.String()])
	}
}
