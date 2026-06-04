package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

func fullFolderHandler(t *testing.T) (*FolderHandler, *gorm.DB, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	activitySvc := activity.NewService(db, activity.NewHub(), activity.NewBus(nil))
	h := NewFolderHandler(db, activitySvc)
	fix := seedLibrary(t, db)
	return h, db, fix
}

func folderCtx(method, body string, fix purgeTestFixture, params map[string]string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	e.Validator = NewValidator()
	req := httptest.NewRequest(method, "/", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	names := make([]string, 0, len(params))
	vals := make([]string, 0, len(params))
	for k, v := range params {
		names = append(names, k)
		vals = append(vals, v)
	}
	c.SetParamNames(names...)
	c.SetParamValues(vals...)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: fix.LibraryID, OwnerID: fix.UserID, IsOwner: true})
	return c, rec
}

func TestFolder_List(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	createFolder(t, db, fix.LibraryID, "A", false, nil)
	createFolder(t, db, fix.LibraryID, "B", false, nil)
	createFolder(t, db, fix.LibraryID, "trashed", true, nil)
	c, rec := folderCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.List(c); err != nil {
		t.Fatalf("List: %v", err)
	}
	var resp []map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2 folders, got %d", len(resp))
	}
}

func TestFolder_Create_Root(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, rec := folderCtx(http.MethodPost, `{"name":"New"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestFolder_Create_WithParent(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	parent := createFolder(t, db, fix.LibraryID, "P", false, nil)
	c, rec := folderCtx(http.MethodPost, fmt.Sprintf(`{"name":"Child","parentFolderId":%q}`, parent.String()), fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestFolder_Create_ParentNotFound(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPost, fmt.Sprintf(`{"name":"Child","parentFolderId":%q}`, uuid.New().String()), fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Create(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFolder_Create_BadParentID(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPost, `{"name":"Child","parentFolderId":"bad"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFolder_Create_InvalidLibrary(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPost, `{"name":"X"}`, fix, map[string]string{"id": "bad"})
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFolder_Create_ValidationFail(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPost, `{"name":""}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if h.Create(c) == nil {
		t.Fatalf("expected validation error")
	}
}

func TestFolder_Create_Unauthorized(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	e := echo.New()
	e.Validator = NewValidator()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"X"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	if httpCode(t, h.Create(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestFolder_Update(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	id := createFolder(t, db, fix.LibraryID, "Old", false, nil)
	c, rec := folderCtx(http.MethodPatch, `{"name":"Renamed"}`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var f models.Folder
	db.First(&f, "id = ?", id)
	if f.Name != "Renamed" {
		t.Fatalf("not renamed")
	}
}

func TestFolder_Update_NoFields(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	id := createFolder(t, db, fix.LibraryID, "Old", false, nil)
	c, _ := folderCtx(http.MethodPatch, `{}`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFolder_Update_NotFound(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPatch, `{"name":"X"}`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": uuid.New().String()})
	if httpCode(t, h.Update(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFolder_Update_BadBody(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPatch, `{bad`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": uuid.New().String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFolder_Delete_Cascade(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	parent := createFolder(t, db, fix.LibraryID, "P", false, nil)
	child := createFolder(t, db, fix.LibraryID, "C", false, &parent)
	fileInChild := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, &child)
	c, rec := folderCtx(http.MethodDelete, "", fix, map[string]string{"id": fix.LibraryID.String(), "folderId": parent.String()})
	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var cf models.Folder
	db.First(&cf, "id = ?", child)
	if cf.TrashedAt == nil {
		t.Fatalf("child not cascaded")
	}
	var file models.File
	db.First(&file, "id = ?", fileInChild)
	if file.TrashedAt == nil {
		t.Fatalf("file not cascaded")
	}
}

func TestFolder_Delete_NotFound(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodDelete, "", fix, map[string]string{"id": fix.LibraryID.String(), "folderId": uuid.New().String()})
	if httpCode(t, h.Delete(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFolder_Move_ToParent(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	a := createFolder(t, db, fix.LibraryID, "A", false, nil)
	b := createFolder(t, db, fix.LibraryID, "B", false, nil)
	c, rec := folderCtx(http.MethodPost, fmt.Sprintf(`{"parentFolderId":%q}`, a.String()), fix, map[string]string{"id": fix.LibraryID.String(), "folderId": b.String()})
	if err := h.Move(c); err != nil {
		t.Fatalf("Move: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var f models.Folder
	db.First(&f, "id = ?", b)
	if f.ParentFolderID == nil || *f.ParentFolderID != a {
		t.Fatalf("not moved")
	}
}

func TestFolder_Move_ToRoot(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	a := createFolder(t, db, fix.LibraryID, "A", false, nil)
	b := createFolder(t, db, fix.LibraryID, "B", false, &a)
	c, _ := folderCtx(http.MethodPost, `{"parentFolderId":null}`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": b.String()})
	if err := h.Move(c); err != nil {
		t.Fatalf("Move: %v", err)
	}
	var f models.Folder
	db.First(&f, "id = ?", b)
	if f.ParentFolderID != nil {
		t.Fatalf("not moved to root")
	}
}

func TestFolder_Move_IntoSelf(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	a := createFolder(t, db, fix.LibraryID, "A", false, nil)
	c, _ := folderCtx(http.MethodPost, fmt.Sprintf(`{"parentFolderId":%q}`, a.String()), fix, map[string]string{"id": fix.LibraryID.String(), "folderId": a.String()})
	if httpCode(t, h.Move(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFolder_Move_IntoDescendant(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	parent := createFolder(t, db, fix.LibraryID, "P", false, nil)
	child := createFolder(t, db, fix.LibraryID, "C", false, &parent)
	// move parent into child -> cycle
	c, _ := folderCtx(http.MethodPost, fmt.Sprintf(`{"parentFolderId":%q}`, child.String()), fix, map[string]string{"id": fix.LibraryID.String(), "folderId": parent.String()})
	if httpCode(t, h.Move(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (cycle)")
	}
}

func TestFolder_Move_NotFound(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPost, `{"parentFolderId":null}`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": uuid.New().String()})
	if httpCode(t, h.Move(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFolder_Move_BadParentID(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	a := createFolder(t, db, fix.LibraryID, "A", false, nil)
	c, _ := folderCtx(http.MethodPost, `{"parentFolderId":"bad"}`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": a.String()})
	if httpCode(t, h.Move(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFolder_Restore(t *testing.T) {
	h, db, fix := fullFolderHandler(t)
	parent := createFolder(t, db, fix.LibraryID, "P", true, nil)
	child := createFolder(t, db, fix.LibraryID, "C", true, &parent)
	fileInChild := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", true, &child)
	body := fmt.Sprintf(`{"folderIds":[%q]}`, parent.String())
	c, rec := folderCtx(http.MethodPost, body, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Restore(c); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var cf models.Folder
	db.First(&cf, "id = ?", child)
	if cf.TrashedAt != nil {
		t.Fatalf("child not restored")
	}
	var file models.File
	db.First(&file, "id = ?", fileInChild)
	if file.TrashedAt != nil {
		t.Fatalf("file not restored")
	}
}

func TestFolder_Restore_Empty(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPost, `{"folderIds":[]}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Restore(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFolder_Restore_BadBody(t *testing.T) {
	h, _, fix := fullFolderHandler(t)
	c, _ := folderCtx(http.MethodPost, `{bad`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Restore(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}
