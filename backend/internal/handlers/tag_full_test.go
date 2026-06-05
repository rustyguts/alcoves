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

func fullTagHandler(t *testing.T) (*TagHandler, *gorm.DB, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	activitySvc := activity.NewService(db, activity.NewHub(), activity.NewBus(nil))
	h := NewTagHandler(db, activitySvc)
	fix := seedLibrary(t, db)
	return h, db, fix
}

func tagCtx(method, body string, fix purgeTestFixture, params map[string]string) (echo.Context, *httptest.ResponseRecorder) {
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

func TestTag_List(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	createTag(t, db, fix.LibraryID, "alpha")
	createTag(t, db, fix.LibraryID, "beta")
	c, rec := tagCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.List(c); err != nil {
		t.Fatalf("List: %v", err)
	}
	var resp []map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(resp))
	}
}

func TestTag_Create_AutoColor(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, rec := tagCtx(http.MethodPost, `{"name":"work"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["color"] == "" {
		t.Fatalf("expected auto-assigned color")
	}
}

func TestTag_Create_ProvidedColor(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, rec := tagCtx(http.MethodPost, `{"name":"x","color":"#123456"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["color"] != "#123456" {
		t.Fatalf("color=%v", resp["color"])
	}
}

func TestTag_Create_Conflict(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	createTag(t, db, fix.LibraryID, "dup")
	c, _ := tagCtx(http.MethodPost, `{"name":"dup"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Create(c)) != http.StatusConflict {
		t.Fatalf("want 409")
	}
}

func TestTag_Create_Validation(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPost, `{"name":""}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if h.Create(c) == nil {
		t.Fatalf("expected validation error")
	}
}

func TestTag_Create_InvalidLibrary(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPost, `{"name":"x"}`, fix, map[string]string{"id": "bad"})
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestTag_Create_BadBody(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPost, `{bad`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestTag_Create_AutoColorAfterPaletteUsed(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	for i, color := range TagColorPalette {
		tag := models.Tag{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: fix.LibraryID, Name: fmt.Sprintf("t%d", i), Color: color}
		db.Create(&tag)
	}
	c, rec := tagCtx(http.MethodPost, `{"name":"overflow"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["color"] != TagColorPalette[0] {
		t.Fatalf("expected fallback to first palette color, got %v", resp["color"])
	}
}

func TestTag_Update(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	id := createTag(t, db, fix.LibraryID, "old")
	c, rec := tagCtx(http.MethodPatch, `{"name":"new","color":"#abcdef"}`, fix, map[string]string{"id": fix.LibraryID.String(), "tagId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var tag models.Tag
	db.First(&tag, "id = ?", id)
	if tag.Name != "new" || tag.Color != "#abcdef" {
		t.Fatalf("not updated: %+v", tag)
	}
}

func TestTag_Update_NoFields(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	id := createTag(t, db, fix.LibraryID, "old")
	c, _ := tagCtx(http.MethodPatch, `{}`, fix, map[string]string{"id": fix.LibraryID.String(), "tagId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestTag_Update_NotFound(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPatch, `{"name":"x"}`, fix, map[string]string{"id": fix.LibraryID.String(), "tagId": uuid.New().String()})
	if httpCode(t, h.Update(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestTag_Update_BadBody(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPatch, `{bad`, fix, map[string]string{"id": fix.LibraryID.String(), "tagId": uuid.New().String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestTag_Delete(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	id := createTag(t, db, fix.LibraryID, "x")
	c, rec := tagCtx(http.MethodDelete, "", fix, map[string]string{"id": fix.LibraryID.String(), "tagId": id.String()})
	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestTag_Delete_NotFound(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodDelete, "", fix, map[string]string{"id": fix.LibraryID.String(), "tagId": uuid.New().String()})
	if httpCode(t, h.Delete(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestTag_SyncFileTags(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	t1 := createTag(t, db, fix.LibraryID, "a")
	t2 := createTag(t, db, fix.LibraryID, "b")
	body := fmt.Sprintf(`{"tagIds":[%q,%q]}`, t1.String(), t2.String())
	c, rec := tagCtx(http.MethodPut, body, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": fileID.String()})
	if err := h.SyncFileTags(c); err != nil {
		t.Fatalf("SyncFileTags: %v", err)
	}
	var resp []map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(resp))
	}
}

func TestTag_SyncFileTags_FileNotFound(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPut, `{"tagIds":[]}`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if httpCode(t, h.SyncFileTags(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestTag_SyncFileTags_BadBody(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPut, `{bad`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if httpCode(t, h.SyncFileTags(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestTag_SyncFolderTags(t *testing.T) {
	h, db, fix := fullTagHandler(t)
	folderID := createFolder(t, db, fix.LibraryID, "F", false, nil)
	t1 := createTag(t, db, fix.LibraryID, "a")
	body := fmt.Sprintf(`{"tagIds":[%q]}`, t1.String())
	c, rec := tagCtx(http.MethodPut, body, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": folderID.String()})
	if err := h.SyncFolderTags(c); err != nil {
		t.Fatalf("SyncFolderTags: %v", err)
	}
	var resp []map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 1 {
		t.Fatalf("expected 1 tag, got %d", len(resp))
	}
}

func TestTag_SyncFolderTags_NotFound(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPut, `{"tagIds":[]}`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": uuid.New().String()})
	if httpCode(t, h.SyncFolderTags(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestTag_SyncFolderTags_BadBody(t *testing.T) {
	h, _, fix := fullTagHandler(t)
	c, _ := tagCtx(http.MethodPut, `{bad`, fix, map[string]string{"id": fix.LibraryID.String(), "folderId": uuid.New().String()})
	if httpCode(t, h.SyncFolderTags(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}
