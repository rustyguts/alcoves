package files

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
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

func TestParseCursor_OversizedSortName(t *testing.T) {
	longName := strings.Repeat("a", maxSortNameLen+1)
	payload := CursorPayload{KindRank: 0, SortName: longName, ID: "550e8400-e29b-41d4-a716-446655440000"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	_, err := parseCursor(encoded)
	if err == nil {
		t.Fatal("Expected error for oversized SortName")
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
	v, err := normalizeFolderID("")
	if err != nil || v != nil {
		t.Fatalf("Expected nil, nil for empty string; got %v, %v", v, err)
	}

	// Nil for whitespace
	v, err = normalizeFolderID("   ")
	if err != nil || v != nil {
		t.Fatalf("Expected nil, nil for whitespace; got %v, %v", v, err)
	}

	// Nil for "null"
	v, err = normalizeFolderID("null")
	if err != nil || v != nil {
		t.Fatalf("Expected nil, nil for 'null'; got %v, %v", v, err)
	}

	// Valid UUID is accepted and returned
	validUUID := "550e8400-e29b-41d4-a716-446655440000"
	v, err = normalizeFolderID(validUUID)
	if err != nil || v == nil || *v != validUUID {
		t.Fatalf("Expected %q, nil; got %v, %v", validUUID, v, err)
	}

	// UUID with surrounding whitespace is trimmed and accepted
	v, err = normalizeFolderID("  " + validUUID + "  ")
	if err != nil || v == nil || *v != validUUID {
		t.Fatalf("Expected trimmed UUID; got %v, %v", v, err)
	}

	// Non-UUID values must return an error
	for _, bad := range []string{"folder-123", "abc", "0", "../evil", "x'OR'1'='1"} {
		v, err = normalizeFolderID(bad)
		if err == nil {
			t.Fatalf("Expected error for non-UUID %q, got v=%v", bad, v)
		}
	}
}

func TestNormalizeFolderID_PathTraversalRejected(t *testing.T) {
	// Explicit path-traversal / injection patterns must be rejected
	injections := []string{
		"../../etc/passwd",
		"x'OR'1'='1",
		"'; DROP TABLE folders; --",
		"1 OR 1=1",
	}
	for _, s := range injections {
		v, err := normalizeFolderID(s)
		if err == nil {
			t.Errorf("Expected error for injection %q, got v=%v", s, v)
		}
	}
}

// ---------------------------------------------------------------------------
// Query builder tests (no DB required) — new parameterized signatures
// ---------------------------------------------------------------------------

func TestBuildFolderQueries_TrashRequiresTrashedAtNotNull(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, _, countQuery, _ := svc.buildFolderQueries(libID, true, nil, nil, 50)

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

	query, _, countQuery, _ := svc.buildFolderQueries(libID, false, nil, nil, 50)

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

	query, _, _, _ := svc.buildFolderQueries(libID, true, nil, nil, 50)

	// The query should exclude folders whose parent is also trashed
	if !strings.Contains(query, "NOT EXISTS") {
		t.Fatalf("Trash folder query must exclude children of trashed parents.\nGot: %s", query)
	}
}

func TestBuildFolderQueries_UsesPlaceholders(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, args, countQuery, countArgs := svc.buildFolderQueries(libID, false, nil, nil, 50)

	// Must use ? placeholders, not interpolated values
	if strings.Contains(query, "'lib-123'") || strings.Contains(countQuery, "'lib-123'") {
		t.Fatal("Query must not interpolate libraryID directly; use ? placeholder")
	}
	if !strings.Contains(query, "?") {
		t.Fatal("Query must contain ? placeholders")
	}
	if len(args) == 0 {
		t.Fatal("Args slice must not be empty")
	}
	if len(countArgs) == 0 {
		t.Fatal("Count args slice must not be empty")
	}
	// libraryID must appear as a bound argument
	found := false
	for _, a := range args {
		if a == libID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("libraryID %q must be in args: %v", libID, args)
	}
}

func TestBuildFileQueries_TrashRequiresTrashedAtNotNull(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, _, countQuery, _ := svc.buildFileQueries(libID, true, nil, nil, 50)

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

	query, _, countQuery, _ := svc.buildFileQueries(libID, false, nil, nil, 50)

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

	query, _, _, _ := svc.buildFileQueries(libID, true, nil, nil, 50)

	// The query should exclude files whose parent folder is trashed
	if !strings.Contains(query, "NOT EXISTS") {
		t.Fatalf("Trash file query must exclude files in trashed folders.\nGot: %s", query)
	}
}

func TestBuildFileQueries_NonTrashWithFolder(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"
	folderID := "550e8400-e29b-41d4-a716-446655440000"

	query, args, countQuery, countArgs := svc.buildFileQueries(libID, false, &folderID, nil, 50)

	// Must NOT embed the folder ID as a string literal
	if strings.Contains(query, "'"+folderID+"'") {
		t.Fatalf("Non-trash file query must not interpolate folderID.\nGot: %s", query)
	}
	if !strings.Contains(query, "parent_folder_id = ?") {
		t.Fatalf("Non-trash file query with folder must use parameterized parent_folder_id filter.\nGot: %s", query)
	}
	if !strings.Contains(query, "trashed_at IS NULL") {
		t.Fatalf("Non-trash file query must require trashed_at IS NULL.\nGot: %s", query)
	}
	if !strings.Contains(countQuery, "parent_folder_id = ?") {
		t.Fatalf("Non-trash file count query must use parameterized parent_folder_id filter.\nGot: %s", countQuery)
	}
	// folderID must appear in args
	found := false
	for _, a := range args {
		if a == folderID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("folderID %q must be in args: %v", folderID, args)
	}
	found = false
	for _, a := range countArgs {
		if a == folderID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("folderID %q must be in countArgs: %v", folderID, countArgs)
	}
}

func TestBuildFileQueries_NonTrashRootFolder(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"

	query, _, _, _ := svc.buildFileQueries(libID, false, nil, nil, 50)

	if !strings.Contains(query, "parent_folder_id IS NULL") {
		t.Fatalf("Non-trash root file query must filter parent_folder_id IS NULL.\nGot: %s", query)
	}
}

func TestBuildFileQueries_TrashIgnoresFolderParam(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"
	folderID := "550e8400-e29b-41d4-a716-446655440000"

	query, args, _, _ := svc.buildFileQueries(libID, true, &folderID, nil, 50)

	// In trash mode the folder param should be ignored (not appear as arg)
	for _, a := range args {
		if a == folderID {
			t.Fatalf("Trash file query must not use the folder parameter; found it in args: %v", args)
		}
	}
	if !strings.Contains(query, "trashed_at IS NOT NULL") {
		t.Fatalf("Trash file query must require trashed_at IS NOT NULL.\nGot: %s", query)
	}
}

func TestBuildFolderQueries_TrashIgnoresFolderParam(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"
	folderID := "550e8400-e29b-41d4-a716-446655440000"

	query, args, _, _ := svc.buildFolderQueries(libID, true, &folderID, nil, 50)

	// In trash mode the folder param should be ignored (not appear as arg)
	for _, a := range args {
		if a == folderID {
			t.Fatalf("Trash folder query must not use the folder parameter; found it in args: %v", args)
		}
	}
	_ = query
}

func TestBuildFolderQueries_CursorUsesPlaceholders(t *testing.T) {
	svc := &Service{}
	libID := "lib-123"
	cursor := &CursorPayload{KindRank: 0, SortName: "documents", ID: "550e8400-e29b-41d4-a716-446655440000"}

	query, args, _, _ := svc.buildFolderQueries(libID, false, nil, cursor, 50)

	if strings.Contains(query, "'documents'") {
		t.Fatalf("Query must not interpolate cursor SortName; use ? placeholder.\nGot: %s", query)
	}
	// sortName must appear as a bound arg
	found := false
	for _, a := range args {
		if a == cursor.SortName {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("cursor SortName %q must be in args: %v", cursor.SortName, args)
	}
}

// ---------------------------------------------------------------------------
// DB-backed integration tests for trash listing
// ---------------------------------------------------------------------------

func setupListingTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db := testsupport.OpenSchema(t, "svc_files")

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
		BaseModel:   models.BaseModel{ID: userID},
		Email:       fmt.Sprintf("%s@test.com", userID.String()[:8]),
		DisplayName: "Listing Test User",
		Role:        "owner",
	})

	libID := uuid.New()
	db.Create(&models.Library{
		BaseModel: models.BaseModel{ID: libID},
		Name:      "Listing Test Library",
		OwnerID:   userID,
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
	_, _, countQuery, countArgs := svc.buildFileQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery, countArgs...).Scan(&count)

	if count != 2 {
		t.Fatalf("Expected 2 trashed files, got %d", count)
	}

	// Query active files
	_, _, activeCountQuery, activeCountArgs := svc.buildFileQueries(fix.LibraryID.String(), false, nil, nil, 50)
	var activeCount int
	db.Raw(activeCountQuery, activeCountArgs...).Scan(&activeCount)

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

	_, _, countQuery, countArgs := svc.buildFolderQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery, countArgs...).Scan(&count)

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
	_, _, countQuery, countArgs := svc.buildFolderQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery, countArgs...).Scan(&count)

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
	_, _, countQuery, countArgs := svc.buildFileQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var count int
	db.Raw(countQuery, countArgs...).Scan(&count)

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
	query, args, _, _ := svc.buildFileQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var rows []listingRow
	db.Raw(query, args...).Scan(&rows)

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

	query, args, _, _ := svc.buildFolderQueries(fix.LibraryID.String(), true, nil, nil, 50)
	var rows []listingRow
	db.Raw(query, args...).Scan(&rows)

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

func TestGetFolderBreadcrumbs_CTE_5Levels(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Build a 5-level hierarchy: L1 > L2 > L3 > L4 > L5
	l1 := createTestFolder(t, db, fix.LibraryID, "L1", false, nil)
	l2 := createTestFolder(t, db, fix.LibraryID, "L2", false, &l1)
	l3 := createTestFolder(t, db, fix.LibraryID, "L3", false, &l2)
	l4 := createTestFolder(t, db, fix.LibraryID, "L4", false, &l3)
	l5 := createTestFolder(t, db, fix.LibraryID, "L5", false, &l4)

	crumbs, err := svc.getFolderBreadcrumbs(fix.LibraryID.String(), l5.String())
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Expect root → leaf order: L1, L2, L3, L4, L5
	wantNames := []string{"L1", "L2", "L3", "L4", "L5"}
	wantIDs := []string{l1.String(), l2.String(), l3.String(), l4.String(), l5.String()}

	if len(crumbs) != len(wantNames) {
		t.Fatalf("Expected %d breadcrumbs, got %d: %+v", len(wantNames), len(crumbs), crumbs)
	}
	for i, want := range wantNames {
		if crumbs[i].Name != want {
			t.Errorf("breadcrumb[%d]: expected name %q, got %q", i, want, crumbs[i].Name)
		}
		if crumbs[i].ID != wantIDs[i] {
			t.Errorf("breadcrumb[%d]: expected id %q, got %q", i, wantIDs[i], crumbs[i].ID)
		}
	}
}
