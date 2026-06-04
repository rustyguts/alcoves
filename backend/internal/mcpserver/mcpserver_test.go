package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/signing"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

type fixture struct {
	deps                Deps
	userA, userB, userC *models.User
	libA, libShared     uuid.UUID
}

func setup(t *testing.T) fixture {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{}, &models.Library{}, &models.LibraryMember{}, &models.File{}, &models.Folder{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// CASCADE also clears rows other test packages left in the shared DB.
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	root := t.TempDir()
	driver := storage.NewLocalDriver(filepath.Join(root, "files"), filepath.Join(root, "avatars"), filepath.Join(root, "cache"))
	st := storage.NewService(driver)
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}

	mk := func(email string) *models.User {
		u := &models.User{ID: uuid.New(), Email: email, DisplayName: email, Role: "member"}
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
		return u
	}
	userA, userB, userC := mk("a@test.com"), mk("b@test.com"), mk("c@test.com")

	libA := models.Library{ID: uuid.New(), Name: "Library A", OwnerID: userA.ID}
	libShared := models.Library{ID: uuid.New(), Name: "Shared", OwnerID: userA.ID}
	db.Create(&libA)
	db.Create(&libShared)
	db.Create(&models.LibraryMember{ID: uuid.New(), LibraryID: libShared.ID, UserID: userB.ID, Role: "admin"})
	db.Create(&models.LibraryMember{ID: uuid.New(), LibraryID: libShared.ID, UserID: userC.ID, Role: "viewer"})

	deps := Deps{
		DB:      db,
		Access:  access.NewService(db),
		Files:   files.NewServiceWithIngest(db, files.IngestDeps{Storage: st}),
		Storage: st,
		Signer:  signing.New("mcp-test-secret"),
		BaseURL: "https://alcoves.test",
	}
	return fixture{deps: deps, userA: userA, userB: userB, userC: userC, libA: libA.ID, libShared: libShared.ID}
}

// call connects an in-memory client/server pair acting as `user` and invokes a
// tool. Server is connected before the client, per the SDK contract.
func call(t *testing.T, base Deps, user *models.User, tool string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	d := base
	d.DefaultIdentity = NewStaticIdentity(user)
	srv := NewServer(d)

	st, ct := mcp.NewInMemoryTransports()
	ctx := context.Background()
	ss, err := srv.Connect(ctx, st, nil)
	if err != nil {
		t.Fatalf("server connect: %v", err)
	}
	defer ss.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	cs, err := client.Connect(ctx, ct, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	defer cs.Close()

	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		t.Fatalf("CallTool %s: %v", tool, err)
	}
	return res
}

func decode[T any](t *testing.T, res *mcp.CallToolResult) T {
	t.Helper()
	if res.IsError {
		t.Fatalf("expected success, got tool error: %s", errText(res))
	}
	var out T
	b, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatalf("marshal structured content: %v", err)
	}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal into %T: %v", out, err)
	}
	return out
}

func errText(res *mcp.CallToolResult) string {
	if len(res.Content) > 0 {
		if tc, ok := res.Content[0].(*mcp.TextContent); ok {
			return tc.Text
		}
	}
	return "<no content>"
}

// --- list_libraries ---

func TestListLibraries_OwnedAndMember(t *testing.T) {
	fx := setup(t)
	out := decode[listLibrariesOutput](t, call(t, fx.deps, fx.userA, "list_libraries", map[string]any{}))
	roles := map[string]string{}
	for _, l := range out.Libraries {
		roles[l.ID] = l.Role
	}
	if roles[fx.libA.String()] != "owner" || roles[fx.libShared.String()] != "owner" {
		t.Fatalf("userA roles wrong: %+v", roles)
	}

	out = decode[listLibrariesOutput](t, call(t, fx.deps, fx.userB, "list_libraries", map[string]any{}))
	if len(out.Libraries) != 1 || out.Libraries[0].ID != fx.libShared.String() || out.Libraries[0].Role != "admin" {
		t.Fatalf("userB should see exactly libShared as admin, got %+v", out.Libraries)
	}
}

// --- list_files ---

func TestListFiles_AccessControl(t *testing.T) {
	fx := setup(t)
	// userB has no access to libA.
	res := call(t, fx.deps, fx.userB, "list_files", map[string]any{"libraryId": fx.libA.String()})
	if !res.IsError {
		t.Fatalf("expected access-denied error for userB on libA")
	}
	// userA can list libA.
	res = call(t, fx.deps, fx.userA, "list_files", map[string]any{"libraryId": fx.libA.String()})
	if res.IsError {
		t.Fatalf("userA listing libA should succeed: %s", errText(res))
	}
}

func TestListFiles_RootAndFolderScope(t *testing.T) {
	fx := setup(t)
	db := fx.deps.DB
	folder := models.Folder{ID: uuid.New(), LibraryID: fx.libA, Name: "sub", OwnerID: &fx.userA.ID}
	db.Create(&folder)
	db.Create(&models.File{ID: uuid.New(), LibraryID: fx.libA, Name: "root.txt", MimeType: "text/plain", OwnerID: &fx.userA.ID})
	db.Create(&models.File{ID: uuid.New(), LibraryID: fx.libA, Name: "inside.txt", MimeType: "text/plain", ParentFolderID: &folder.ID, OwnerID: &fx.userA.ID})

	root := decode[listFilesOutput](t, call(t, fx.deps, fx.userA, "list_files", map[string]any{"libraryId": fx.libA.String()}))
	names := map[string]string{}
	for _, e := range root.Entries {
		names[e.Name] = e.Kind
	}
	if names["sub"] != "folder" || names["root.txt"] != "file" {
		t.Fatalf("root listing wrong: %+v", root.Entries)
	}
	if _, ok := names["inside.txt"]; ok {
		t.Fatalf("inside.txt should not appear at root")
	}

	inFolder := decode[listFilesOutput](t, call(t, fx.deps, fx.userA, "list_files", map[string]any{
		"libraryId": fx.libA.String(), "folderId": folder.ID.String(),
	}))
	if len(inFolder.Entries) != 1 || inFolder.Entries[0].Name != "inside.txt" {
		t.Fatalf("folder listing wrong: %+v", inFolder.Entries)
	}
}

// --- upload_file ---

func TestUploadFile_LocalPathRoundTrip(t *testing.T) {
	fx := setup(t)
	src := filepath.Join(t.TempDir(), "movie.bin")
	content := make([]byte, 3<<20) // 3 MiB — exercises streaming
	for i := range content {
		content[i] = byte(i % 251)
	}
	if err := os.WriteFile(src, content, 0o644); err != nil {
		t.Fatal(err)
	}

	out := decode[uploadFileOutput](t, call(t, fx.deps, fx.userA, "upload_file", map[string]any{
		"libraryId": fx.libA.String(), "filename": "movie.bin", "path": src,
	}))
	if out.Mode != "completed" || out.Size != int64(len(content)) || out.FileID == "" {
		t.Fatalf("unexpected upload output: %+v", out)
	}
	if ok, _ := fx.deps.Storage.FileExists(fx.libA.String(), out.FileID); !ok {
		t.Fatalf("blob not stored for %s", out.FileID)
	}
}

func TestUploadFile_ViewerDenied(t *testing.T) {
	fx := setup(t)
	src := filepath.Join(t.TempDir(), "x.txt")
	os.WriteFile(src, []byte("hi"), 0o644)

	// userC is a viewer of libShared → admin required to upload.
	res := call(t, fx.deps, fx.userC, "upload_file", map[string]any{
		"libraryId": fx.libShared.String(), "filename": "x.txt", "path": src,
	})
	if !res.IsError {
		t.Fatalf("expected viewer upload to be denied")
	}
	var count int64
	fx.deps.DB.Model(&models.File{}).Where("library_id = ?", fx.libShared).Count(&count)
	if count != 0 {
		t.Fatalf("no file should be created on denied upload, got %d", count)
	}
}

func TestUploadFile_BadPath(t *testing.T) {
	fx := setup(t)
	res := call(t, fx.deps, fx.userA, "upload_file", map[string]any{
		"libraryId": fx.libA.String(), "filename": "x", "path": "relative/path.txt",
	})
	if !res.IsError {
		t.Fatalf("expected error for relative path")
	}
}

func TestUploadFile_SignedURLWhenNoPath(t *testing.T) {
	fx := setup(t)
	out := decode[uploadFileOutput](t, call(t, fx.deps, fx.userA, "upload_file", map[string]any{
		"libraryId": fx.libA.String(), "filename": "remote.bin", "mimeType": "application/octet-stream", "size": 1000,
	}))
	if out.Mode != "url" || out.UploadURL == "" || out.CurlCommand == "" {
		t.Fatalf("expected signed upload url output: %+v", out)
	}
	if out.Resumable == nil || out.Resumable.TusUploadURL == "" {
		t.Fatalf("expected resumable tus fallback: %+v", out.Resumable)
	}
	// No file created yet.
	var count int64
	fx.deps.DB.Model(&models.File{}).Where("library_id = ?", fx.libA).Count(&count)
	if count != 0 {
		t.Fatalf("signed-url upload must not create a file yet, got %d", count)
	}
}

// --- download_file ---

func ingestOne(t *testing.T, fx fixture, name, content string) string {
	t.Helper()
	res, err := fx.deps.Files.IngestStream(context.Background(), files.IngestParams{
		LibraryID: fx.libA, OwnerID: fx.userA.ID, Name: name, MimeType: "text/plain",
	}, stringReader(content))
	if err != nil {
		t.Fatalf("seed ingest: %v", err)
	}
	return res.File.ID.String()
}

func TestDownloadFile_LocalRoundTrip(t *testing.T) {
	fx := setup(t)
	content := "the quick brown fox"
	fileID := ingestOne(t, fx, "fox.txt", content)

	dest := filepath.Join(t.TempDir(), "out.txt")
	out := decode[downloadFileOutput](t, call(t, fx.deps, fx.userA, "download_file", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID, "destPath": dest,
	}))
	if out.Mode != "saved" || out.Path != dest {
		t.Fatalf("unexpected download output: %+v", out)
	}
	got, err := os.ReadFile(dest)
	if err != nil || string(got) != content {
		t.Fatalf("downloaded bytes mismatch: %q err=%v", got, err)
	}
}

func TestDownloadFile_NoOverwrite(t *testing.T) {
	fx := setup(t)
	fileID := ingestOne(t, fx, "a.txt", "data")
	dest := filepath.Join(t.TempDir(), "exists.txt")
	os.WriteFile(dest, []byte("keep me"), 0o644)

	res := call(t, fx.deps, fx.userA, "download_file", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID, "destPath": dest,
	})
	if !res.IsError {
		t.Fatalf("expected error when destPath exists without overwrite")
	}
	if b, _ := os.ReadFile(dest); string(b) != "keep me" {
		t.Fatalf("existing dest must be untouched, got %q", b)
	}
}

func TestDownloadFile_AccessDeniedAndCrossLibrary(t *testing.T) {
	fx := setup(t)
	fileID := ingestOne(t, fx, "secret.txt", "classified")

	// userB has no access to libA.
	res := call(t, fx.deps, fx.userB, "download_file", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID, "destPath": filepath.Join(t.TempDir(), "x"),
	})
	if !res.IsError {
		t.Fatalf("expected access-denied for userB")
	}

	// Right user, wrong library → not found.
	res = call(t, fx.deps, fx.userA, "download_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileId": fileID, "destPath": filepath.Join(t.TempDir(), "y"),
	})
	if !res.IsError {
		t.Fatalf("expected cross-library not-found error")
	}
}

func TestDownloadFile_SignedURLWhenNoDest(t *testing.T) {
	fx := setup(t)
	fileID := ingestOne(t, fx, "dl.txt", "abc")
	out := decode[downloadFileOutput](t, call(t, fx.deps, fx.userA, "download_file", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID,
	}))
	if out.Mode != "url" || out.URL == "" || out.CurlCommand == "" {
		t.Fatalf("expected signed download url output: %+v", out)
	}
	// The minted token must verify for this exact file.
	token := tokenFromURL(out.URL)
	claims, err := fx.deps.Signer.VerifyDownload(token)
	if err != nil {
		t.Fatalf("minted download token failed to verify: %v", err)
	}
	if claims.FileID.String() != fileID || claims.LibraryID != fx.libA {
		t.Fatalf("download token claims mismatch: %+v", claims)
	}
}
