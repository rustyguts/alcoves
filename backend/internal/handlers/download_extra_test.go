package handlers

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func fullDownloadHandler(t *testing.T) (*DownloadHandler, *gorm.DB, *storage.Service, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)
	h := NewDownloadHandler(db, st)
	fix := seedLibrary(t, db)
	return h, db, st, fix
}

func dlCtx(method, body string, fix purgeTestFixture) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	req := httptest.NewRequest(method, "/", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: fix.LibraryID, OwnerID: fix.UserID, IsOwner: true})
	return c, rec
}

func TestDownload_Estimate_Files(t *testing.T) {
	h, db, _, fix := fullDownloadHandler(t)
	a := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	b := createFile(t, db, fix.LibraryID, fix.UserID, "b.jpg", false, nil)
	body := `{"fileIds":["` + a.String() + `","` + b.String() + `"]}`
	c, rec := dlCtx(http.MethodPost, body, fix)
	if err := h.Estimate(c); err != nil {
		t.Fatalf("Estimate: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["fileCount"].(float64) != 2 {
		t.Fatalf("expected 2 files, got %v", resp["fileCount"])
	}
	if resp["totalSize"].(float64) != 200 {
		t.Fatalf("expected size 200, got %v", resp["totalSize"])
	}
}

func TestDownload_Estimate_Folders(t *testing.T) {
	h, db, _, fix := fullDownloadHandler(t)
	parent := createFolder(t, db, fix.LibraryID, "P", false, nil)
	child := createFolder(t, db, fix.LibraryID, "C", false, &parent)
	createFile(t, db, fix.LibraryID, fix.UserID, "inP.jpg", false, &parent)
	createFile(t, db, fix.LibraryID, fix.UserID, "inC.jpg", false, &child)
	body := `{"folderIds":["` + parent.String() + `"]}`
	c, rec := dlCtx(http.MethodPost, body, fix)
	if err := h.Estimate(c); err != nil {
		t.Fatalf("Estimate: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["fileCount"].(float64) != 2 { // both files in parent + descendant child
		t.Fatalf("expected 2 files across folder tree, got %v", resp["fileCount"])
	}
}

func TestDownload_Estimate_BadBody(t *testing.T) {
	h, _, _, fix := fullDownloadHandler(t)
	c, _ := dlCtx(http.MethodPost, `{bad`, fix)
	if httpCode(t, h.Estimate(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestDownload_Download_Zip(t *testing.T) {
	h, db, st, fix := fullDownloadHandler(t)
	a := createFile(t, db, fix.LibraryID, fix.UserID, "a.txt", false, nil)
	b := createFile(t, db, fix.LibraryID, fix.UserID, "b.txt", false, nil)
	storeBlob(t, st, fix.LibraryID.String(), a.String())
	storeBlob(t, st, fix.LibraryID.String(), b.String())
	body := `{"fileIds":["` + a.String() + `","` + b.String() + `"]}`
	c, rec := dlCtx(http.MethodPost, body, fix)
	if err := h.Download(c); err != nil {
		t.Fatalf("Download: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("zip read: %v", err)
	}
	if len(zr.File) != 2 {
		t.Fatalf("expected 2 entries in zip, got %d", len(zr.File))
	}
}

func TestDownload_Download_FolderTree(t *testing.T) {
	h, db, st, fix := fullDownloadHandler(t)
	parent := createFolder(t, db, fix.LibraryID, "P", false, nil)
	f := createFile(t, db, fix.LibraryID, fix.UserID, "x.txt", false, &parent)
	storeBlob(t, st, fix.LibraryID.String(), f.String())
	body := `{"folderIds":["` + parent.String() + `"]}`
	c, rec := dlCtx(http.MethodPost, body, fix)
	if err := h.Download(c); err != nil {
		t.Fatalf("Download: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestDownload_Download_Empty(t *testing.T) {
	h, _, _, fix := fullDownloadHandler(t)
	c, _ := dlCtx(http.MethodPost, `{"fileIds":[]}`, fix)
	if httpCode(t, h.Download(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestDownload_Download_BadBody(t *testing.T) {
	h, _, _, fix := fullDownloadHandler(t)
	c, _ := dlCtx(http.MethodPost, `{bad`, fix)
	if httpCode(t, h.Download(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestDownload_GetDescendants(t *testing.T) {
	_, db, _, fix := fullDownloadHandler(t)
	parent := createFolder(t, db, fix.LibraryID, "P", false, nil)
	child := createFolder(t, db, fix.LibraryID, "C", false, &parent)
	grand := createFolder(t, db, fix.LibraryID, "G", false, &child)
	got := getDescendants(db, fix.LibraryID.String(), parent.String())
	if len(got) != 2 {
		t.Fatalf("expected 2 descendants (child, grand), got %d: %v", len(got), got)
	}
	_ = grand
}
