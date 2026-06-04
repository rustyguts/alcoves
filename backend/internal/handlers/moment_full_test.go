package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func fullMomentHandler(t *testing.T) (*MomentHandler, *gorm.DB, *storage.Service, purgeTestFixture, uuid.UUID) {
	t.Helper()
	db := setupPurgeTestDB(t)
	if err := db.AutoMigrate(&models.Moment{}, &models.MomentTag{}); err != nil {
		t.Fatalf("migrate moments: %v", err)
	}
	st := setupPurgeStorage(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })
	exportSvc := momentexport.NewService(db, st, client)
	activitySvc := activity.NewService(db, activity.NewHub(), activity.NewBus(nil))
	h := NewMomentHandler(db, st, exportSvc, "http://localhost:3000", activitySvc)
	fix := seedLibrary(t, db)
	fileID := mkVideo(t, db, fix)
	return h, db, st, fix, fileID
}

func momentCtx(method, body string, fix purgeTestFixture, params map[string]string) (echo.Context, *httptest.ResponseRecorder) {
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

func mkMoment(t *testing.T, db *gorm.DB, fix purgeTestFixture, fileID uuid.UUID, start, end float64) uuid.UUID {
	t.Helper()
	id := uuid.New()
	m := models.Moment{ID: id, FileID: fileID, LibraryID: fix.LibraryID, CreatedByID: fix.UserID, Name: "M", StartSeconds: start, EndSeconds: end, ExportVersion: 1}
	if err := db.Create(&m).Error; err != nil {
		t.Fatalf("create moment: %v", err)
	}
	return id
}

func pp(fix purgeTestFixture, fileID uuid.UUID, momentID string) map[string]string {
	m := map[string]string{"id": fix.LibraryID.String(), "fileId": fileID.String()}
	if momentID != "" {
		m["momentId"] = momentID
	}
	return m
}

func TestMoment_Create(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	c, rec := momentCtx(http.MethodPost, `{"name":"Clip","startSeconds":1,"endSeconds":5}`, fix, pp(fix, fileID, ""))
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rec.Code)
	}
}

func TestMoment_Create_BadRange(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodPost, `{"startSeconds":5,"endSeconds":1}`, fix, pp(fix, fileID, ""))
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Create_NegativeStart(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodPost, `{"startSeconds":-1,"endSeconds":5}`, fix, pp(fix, fileID, ""))
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Create_FileNotFound(t *testing.T) {
	h, _, _, fix, _ := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodPost, `{"startSeconds":1,"endSeconds":5}`, fix, pp(fix, uuid.New(), ""))
	if httpCode(t, h.Create(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestMoment_Create_InvalidLibrary(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodPost, `{"startSeconds":1,"endSeconds":5}`, fix, map[string]string{"id": "bad", "fileId": fileID.String()})
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Create_InvalidFileID(t *testing.T) {
	h, _, _, fix, _ := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodPost, `{"startSeconds":1,"endSeconds":5}`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": "bad"})
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Create_Unauthorized(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"startSeconds":1,"endSeconds":5}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "fileId")
	c.SetParamValues(fix.LibraryID.String(), fileID.String())
	if httpCode(t, h.Create(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestMoment_List(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mkMoment(t, db, fix, fileID, 1, 5)
	mkMoment(t, db, fix, fileID, 6, 10)
	c, rec := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, ""))
	if err := h.List(c); err != nil {
		t.Fatalf("List: %v", err)
	}
	var resp []momentResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2 moments, got %d", len(resp))
	}
}

func TestMoment_List_InvalidLibrary(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodGet, "", fix, map[string]string{"id": "bad", "fileId": fileID.String()})
	if httpCode(t, h.List(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Get(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, rec := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, mid.String()))
	if err := h.Get(c); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestMoment_Get_NotFound(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, uuid.New().String()))
	if httpCode(t, h.Get(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestMoment_Get_InvalidMomentID(t *testing.T) {
	h, _, _, fix, fileID := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, "bad"))
	if httpCode(t, h.Get(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Update_NameAndRange(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, rec := momentCtx(http.MethodPatch, `{"name":"Renamed","startSeconds":2,"endSeconds":8}`, fix, pp(fix, fileID, mid.String()))
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var m models.Moment
	db.First(&m, "id = ?", mid)
	if m.Name != "Renamed" || m.ExportVersion != 2 {
		t.Fatalf("update/range-bump failed: %+v", m)
	}
}

func TestMoment_Update_DescriptionOnly(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, _ := momentCtx(http.MethodPatch, `{"description":"notes"}`, fix, pp(fix, fileID, mid.String()))
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	var m models.Moment
	db.First(&m, "id = ?", mid)
	if m.Description != "notes" || m.ExportVersion != 1 {
		t.Fatalf("desc-only should not bump version: %+v", m)
	}
}

func TestMoment_Update_BadRange(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, _ := momentCtx(http.MethodPatch, `{"startSeconds":9,"endSeconds":3}`, fix, pp(fix, fileID, mid.String()))
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Update_NoFields(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, _ := momentCtx(http.MethodPatch, `{}`, fix, pp(fix, fileID, mid.String()))
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Delete(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, rec := momentCtx(http.MethodDelete, "", fix, pp(fix, fileID, mid.String()))
	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204")
	}
	var m models.Moment
	db.First(&m, "id = ?", mid)
	if m.TrashedAt == nil {
		t.Fatalf("not trashed")
	}
}

func TestMoment_SyncTags(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	t1 := createTag(t, db, fix.LibraryID, "a")
	t2 := createTag(t, db, fix.LibraryID, "b")
	body := fmt.Sprintf(`{"tagIds":[%q,%q]}`, t1.String(), t2.String())
	c, rec := momentCtx(http.MethodPut, body, fix, pp(fix, fileID, mid.String()))
	if err := h.SyncTags(c); err != nil {
		t.Fatalf("SyncTags: %v", err)
	}
	var resp momentResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(resp.Tags))
	}
}

func TestMoment_SyncTags_InvalidTagID(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, _ := momentCtx(http.MethodPut, `{"tagIds":["bad"]}`, fix, pp(fix, fileID, mid.String()))
	if httpCode(t, h.SyncTags(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_SyncTags_ForeignTag(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	// a tag id that doesn't belong to the library
	body := fmt.Sprintf(`{"tagIds":[%q]}`, uuid.New().String())
	c, _ := momentCtx(http.MethodPut, body, fix, pp(fix, fileID, mid.String()))
	if httpCode(t, h.SyncTags(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (foreign tag)")
	}
}

func TestMoment_SyncTags_Clear(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	t1 := createTag(t, db, fix.LibraryID, "a")
	db.Create(&models.MomentTag{MomentID: mid, TagID: t1})
	c, rec := momentCtx(http.MethodPut, `{"tagIds":[]}`, fix, pp(fix, fileID, mid.String()))
	if err := h.SyncTags(c); err != nil {
		t.Fatalf("SyncTags: %v", err)
	}
	var resp momentResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Tags) != 0 {
		t.Fatalf("expected 0 tags after clear")
	}
}

func TestMoment_Export(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, rec := momentCtx(http.MethodPost, "", fix, pp(fix, fileID, mid.String()))
	if err := h.Export(c); err != nil {
		t.Fatalf("Export: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d", rec.Code)
	}
}

func TestMoment_Export_AlreadyReady(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	v := 1
	db.Model(&models.Moment{}).Where("id = ?", mid).Update("exported_version", &v)
	c, rec := momentCtx(http.MethodPost, "", fix, pp(fix, fileID, mid.String()))
	if err := h.Export(c); err != nil {
		t.Fatalf("Export: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (cache ready)")
	}
}

func TestMoment_Download_NotReady(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, _ := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, mid.String()))
	if httpCode(t, h.Download(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestMoment_Download_Full(t *testing.T) {
	h, db, st, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	v := 1
	ready := "ready"
	db.Model(&models.Moment{}).Where("id = ?", mid).Updates(map[string]any{"exported_version": &v, "export_status": &ready})
	cacheKey := momentexport.CacheKey(fix.LibraryID.String(), mid.String(), 1)
	st.StoreCacheBuffer(cacheKey, []byte("exportedvideo"))
	c, rec := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, mid.String()))
	if err := h.Download(c); err != nil {
		t.Fatalf("Download: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "exportedvideo" {
		t.Fatalf("want 200 body, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestMoment_Download_Range(t *testing.T) {
	h, db, st, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	v := 1
	ready := "ready"
	db.Model(&models.Moment{}).Where("id = ?", mid).Updates(map[string]any{"exported_version": &v, "export_status": &ready})
	cacheKey := momentexport.CacheKey(fix.LibraryID.String(), mid.String(), 1)
	st.StoreCacheBuffer(cacheKey, []byte("exportedvideo"))
	c, rec := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, mid.String()))
	c.Request().Header.Set("Range", "bytes=0-4")
	if err := h.Download(c); err != nil {
		t.Fatalf("Download range: %v", err)
	}
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("want 206, got %d", rec.Code)
	}
}

func TestMoment_SafeFilename(t *testing.T) {
	if safeFilename("") != "moment" {
		t.Fatalf("empty -> moment")
	}
	if safeFilename(`a/b"c`) != "a_b_c" {
		t.Fatalf("got %q", safeFilename(`a/b"c`))
	}
}
