package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

// fullFileHandler wires a FileHandler with real services backed by the test DB,
// local storage, and an Asynq client pointed at Dragonfly so enqueue success
// paths are exercised.
func fullFileHandler(t *testing.T) (*FileHandler, *gorm.DB, *storage.Service, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)

	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })

	activitySvc := activity.NewService(db, activity.NewHub(), activity.NewBus(nil))
	fileSvc := files.NewService(db)
	cfg := &config.Config{}
	settingsSvc, _ := settings.NewService(db)

	faceSvc := facedetection.NewService(db, st, client, &facedetection.FaceConfig{})
	objSvc := objectdetection.NewService(db, st, client, &objectdetection.ObjectConfig{})
	videoSvc := videoproxy.NewService(db, st, client, activitySvc)
	transcribeSvc := transcribe.NewService(db, st, client, cfg, activitySvc, settingsSvc)
	audioDetectSvc := audiodetection.NewService(db, st, client, cfg, settingsSvc)
	waveformSvc := waveform.NewService(db, st, client, cfg, activitySvc)

	h := NewFileHandler(db, fileSvc, st, faceSvc, objSvc, videoSvc, transcribeSvc, audioDetectSvc, waveformSvc, activitySvc)
	fix := seedLibrary(t, db)
	return h, db, st, fix
}

// ffCtx builds an echo context with id/fileId params, an authed user, and
// owner-level library access in context.
func ffCtx(method, target, body string, fix purgeTestFixture, params map[string]string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	e.Validator = NewValidator()
	var rdr *strings.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	} else {
		rdr = strings.NewReader("")
	}
	req := httptest.NewRequest(method, target, rdr)
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
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{
		LibraryID: fix.LibraryID,
		OwnerID:   fix.UserID,
		IsOwner:   true,
		IsAdmin:   true,
	})
	return c, rec
}

func mkVideo(t *testing.T, db *gorm.DB, fix purgeTestFixture) uuid.UUID {
	t.Helper()
	id := uuid.New()
	f := models.File{ID: id, LibraryID: fix.LibraryID, Name: "v.mp4", MimeType: "video/mp4", Size: 10, OwnerID: &fix.UserID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	return id
}

func httpCode(t *testing.T, err error) int {
	t.Helper()
	he, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %T: %v", err, err)
	}
	return he.Code
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestFile_List_InvalidUUID(t *testing.T) {
	h, _, _, _ := fullFileHandler(t)
	c, _ := ffCtx(http.MethodGet, "/", "", purgeTestFixture{}, map[string]string{"id": "not-a-uuid"})
	err := h.List(c)
	if httpCode(t, err) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_List_OK(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	createFile(t, db, fix.LibraryID, fix.UserID, "b.jpg", false, nil)
	c, rec := ffCtx(http.MethodGet, "/?page=1&pageSize=10", "", fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.List(c); err != nil {
		t.Fatalf("List: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

func TestFile_Upload_Image(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("hello-bytes"))
	req.Header.Set("X-Upload-Name", "pic.jpg")
	req.Header.Set("X-Upload-Mime-Type", "image/jpeg")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["name"] != "pic.jpg" {
		t.Fatalf("name=%v", resp["name"])
	}
}

func TestFile_Upload_VideoEnqueues(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("video-bytes"))
	req.Header.Set("X-Upload-Name", "clip.mp4")
	req.Header.Set("X-Upload-Mime-Type", "video/mp4")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestFile_Upload_DefaultsAndFolderHeader(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	folderID := createFolder(t, db, fix.LibraryID, "F", false, nil)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("x"))
	// no name / mime headers -> defaults
	req.Header.Set("X-Upload-Folder-Id", folderID.String())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["name"] != "unnamed" {
		t.Fatalf("expected default name, got %v", resp["name"])
	}
}

func TestFile_Upload_InvalidLibrary(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("x"))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("bad")
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if httpCode(t, h.Upload(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_Upload_Unauthorized(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("x"))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	// no user set
	if httpCode(t, h.Upload(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestFile_Upload_BadFolderHeader(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("x"))
	req.Header.Set("X-Upload-Folder-Id", "nope")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fix.LibraryID.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if httpCode(t, h.Upload(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

// ---------------------------------------------------------------------------
// Get / serveFileData / serveRangeRequest
// ---------------------------------------------------------------------------

func TestFile_Get_Metadata(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Get(c); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestFile_Get_NotFound(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if httpCode(t, h.Get(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFile_Get_InlineFull(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.bin", false, nil)
	storeBlob(t, st, fix.LibraryID.String(), id.String())
	c, rec := ffCtx(http.MethodGet, "/?inline=true", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Get(c); err != nil {
		t.Fatalf("Get inline: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "file-data" {
		t.Fatalf("want body file-data, got code=%d body=%q", rec.Code, rec.Body.String())
	}
}

func TestFile_Get_InlineRange(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.bin", false, nil)
	storeBlob(t, st, fix.LibraryID.String(), id.String())
	c, rec := ffCtx(http.MethodGet, "/?inline=true", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	c.Request().Header.Set("Range", "bytes=0-3")
	if err := h.Get(c); err != nil {
		t.Fatalf("Get range: %v", err)
	}
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("want 206, got %d", rec.Code)
	}
	if rec.Body.String() != "file" {
		t.Fatalf("want 'file', got %q", rec.Body.String())
	}
}

func TestFile_Get_InlineRangeOpenEnded(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.bin", false, nil)
	storeBlob(t, st, fix.LibraryID.String(), id.String())
	c, rec := ffCtx(http.MethodGet, "/?inline=true", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	c.Request().Header.Set("Range", "bytes=2-")
	if err := h.Get(c); err != nil {
		t.Fatalf("Get range: %v", err)
	}
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("want 206, got %d", rec.Code)
	}
}

func TestFile_Get_InlineRangeUnsatisfiable(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.bin", false, nil)
	storeBlob(t, st, fix.LibraryID.String(), id.String())
	c, rec := ffCtx(http.MethodGet, "/?inline=true", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	c.Request().Header.Set("Range", "bytes=9999-")
	if err := h.Get(c); err != nil {
		t.Fatalf("Get range: %v", err)
	}
	if rec.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("want 416, got %d", rec.Code)
	}
}

func TestFile_Get_InlineMissingBlob(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.bin", false, nil)
	c, _ := ffCtx(http.MethodGet, "/?inline=true", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.Get(c)) != http.StatusNotFound {
		t.Fatalf("want 404 (no blob)")
	}
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func TestFile_Update_Name(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "old.jpg", false, nil)
	c, rec := ffCtx(http.MethodPatch, "/", `{"name":"new.jpg"}`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var f models.File
	db.First(&f, "id = ?", id)
	if f.Name != "new.jpg" {
		t.Fatalf("name not updated: %s", f.Name)
	}
}

func TestFile_Update_ClearParent(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	folderID := createFolder(t, db, fix.LibraryID, "F", false, nil)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, &folderID)
	c, _ := ffCtx(http.MethodPatch, "/", `{"parentFolderId":"null"}`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	var f models.File
	db.First(&f, "id = ?", id)
	if f.ParentFolderID != nil {
		t.Fatalf("parent not cleared")
	}
}

func TestFile_Update_SetParent(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	folderID := createFolder(t, db, fix.LibraryID, "F", false, nil)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	c, _ := ffCtx(http.MethodPatch, "/", fmt.Sprintf(`{"parentFolderId":%q}`, folderID.String()), fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	var f models.File
	db.First(&f, "id = ?", id)
	if f.ParentFolderID == nil || *f.ParentFolderID != folderID {
		t.Fatalf("parent not set")
	}
}

func TestFile_Update_NoFields(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	c, _ := ffCtx(http.MethodPatch, "/", `{}`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_Update_BadBody(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	c, _ := ffCtx(http.MethodPatch, "/", `{not json`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

// ---------------------------------------------------------------------------
// Delete / Restore
// ---------------------------------------------------------------------------

func TestFile_Delete_Single(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	c, rec := ffCtx(http.MethodDelete, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var f models.File
	db.First(&f, "id = ?", id)
	if f.TrashedAt == nil {
		t.Fatalf("not trashed")
	}
}

func TestFile_Delete_Bulk(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	a := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	b := createFile(t, db, fix.LibraryID, fix.UserID, "b.jpg", false, nil)
	body := fmt.Sprintf(`{"fileIds":[%q,%q]}`, a.String(), b.String())
	c, rec := ffCtx(http.MethodDelete, "/", body, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete bulk: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestFile_Delete_NotFound(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodDelete, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if httpCode(t, h.Delete(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFile_Restore(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", true, nil)
	body := fmt.Sprintf(`{"fileIds":[%q]}`, id.String())
	c, rec := ffCtx(http.MethodPost, "/", body, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Restore(c); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var f models.File
	db.First(&f, "id = ?", id)
	if f.TrashedAt != nil {
		t.Fatalf("still trashed")
	}
}

func TestFile_Restore_Empty(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodPost, "/", `{"fileIds":[]}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Restore(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_Restore_BadBody(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodPost, "/", `{bad`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Restore(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

// ---------------------------------------------------------------------------
// PlaybackSources
// ---------------------------------------------------------------------------

func TestFile_PlaybackSources_NotVideo(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.PlaybackSources(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_PlaybackSources_NotFound(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if httpCode(t, h.PlaybackSources(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFile_PlaybackSources_VideoNoProxy(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.PlaybackSources(c); err != nil {
		t.Fatalf("PlaybackSources: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var resp playbackSourcesResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Sources) != 1 {
		t.Fatalf("expected 1 source, got %d", len(resp.Sources))
	}
}

func TestFile_PlaybackSources_WithProxy(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	srcID := mkVideo(t, db, fix)
	ready := "ready"
	db.Model(&models.File{}).Where("id = ?", srcID).Update("proxy_status", &ready)
	// proxy file referencing source
	proxyID := uuid.New()
	proxy := models.File{ID: proxyID, LibraryID: fix.LibraryID, Name: "p.mp4", MimeType: "video/mp4", Size: 5, OwnerID: &fix.UserID, SourceFileID: &srcID}
	if err := db.Create(&proxy).Error; err != nil {
		t.Fatalf("create proxy: %v", err)
	}
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": srcID.String()})
	if err := h.PlaybackSources(c); err != nil {
		t.Fatalf("PlaybackSources: %v", err)
	}
	var resp playbackSourcesResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Sources) != 2 {
		t.Fatalf("expected 2 sources, got %d", len(resp.Sources))
	}
}

func TestFile_PlaybackSources_LegacyProxy(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	srcID := mkVideo(t, db, fix)
	ready := "ready"
	db.Model(&models.File{}).Where("id = ?", srcID).Update("proxy_status", &ready)
	cacheKey := fmt.Sprintf("%s/%s/proxy.mp4", fix.LibraryID.String(), srcID.String())
	if err := st.StoreCacheBuffer(cacheKey, []byte("legacy")); err != nil {
		t.Fatalf("store cache: %v", err)
	}
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": srcID.String()})
	if err := h.PlaybackSources(c); err != nil {
		t.Fatalf("PlaybackSources: %v", err)
	}
	var resp playbackSourcesResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Sources) != 2 {
		t.Fatalf("expected source + legacy proxy, got %d", len(resp.Sources))
	}
}

// ---------------------------------------------------------------------------
// Generate* enqueue handlers
// ---------------------------------------------------------------------------

func TestFile_GenerateProxy_OK(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	c, rec := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.GenerateProxy(c); err != nil {
		t.Fatalf("GenerateProxy: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestFile_GenerateProxy_NotVideo(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	c, _ := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.GenerateProxy(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_GenerateProxy_ProxyFile(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	pid := uuid.New()
	p := models.File{ID: pid, LibraryID: fix.LibraryID, Name: "p.mp4", MimeType: "video/mp4", Size: 5, OwnerID: &fix.UserID, SourceFileID: &src}
	db.Create(&p)
	c, _ := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": pid.String()})
	if httpCode(t, h.GenerateProxy(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_GenerateProxy_NilSvc(t *testing.T) {
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)
	h := NewFileHandler(db, nil, st, nil, nil, nil, nil, nil, nil, nil)
	fix := seedLibrary(t, db)
	id := mkVideo(t, db, fix)
	c, _ := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.GenerateProxy(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}

func TestFile_GenerateWaveform_OK(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	c, rec := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.GenerateWaveform(c); err != nil {
		t.Fatalf("GenerateWaveform: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d", rec.Code)
	}
}

func TestFile_GenerateTranscript_OK(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	c, rec := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.GenerateTranscript(c); err != nil {
		t.Fatalf("GenerateTranscript: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d", rec.Code)
	}
}

func TestFile_GenerateTranscript_NotAV(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	c, _ := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.GenerateTranscript(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestFile_GetTranscript_NotReady(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.GetTranscript(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFile_GetTranscript_Ready(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	ready := "ready"
	txt := "hello world"
	db.Model(&models.File{}).Where("id = ?", id).Updates(map[string]any{"transcribe_status": &ready, "transcript_text": &txt})
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.GetTranscript(c); err != nil {
		t.Fatalf("GetTranscript: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestFile_GenerateAudioDetections_NeedsTranscript(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	c, _ := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.GenerateAudioDetections(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (transcript not ready)")
	}
}

func TestFile_GenerateAudioDetections_OK(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := mkVideo(t, db, fix)
	ready := "ready"
	db.Model(&models.File{}).Where("id = ?", id).Update("transcribe_status", &ready)
	c, rec := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.GenerateAudioDetections(c); err != nil {
		t.Fatalf("GenerateAudioDetections: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d", rec.Code)
	}
}

func TestFile_ListAudioDetections_NilSvc(t *testing.T) {
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)
	h := NewFileHandler(db, nil, st, nil, nil, nil, nil, nil, nil, nil)
	fix := seedLibrary(t, db)
	id := mkVideo(t, db, fix)
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.ListAudioDetections(c); err != nil {
		t.Fatalf("ListAudioDetections: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestFile_ListAudioDetections_OK(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	if err := db.AutoMigrate(&models.AudioDetection{}); err != nil {
		t.Fatalf("migrate audio_detections: %v", err)
	}
	id := mkVideo(t, db, fix)
	det := models.AudioDetection{ID: uuid.New(), LibraryID: fix.LibraryID, FileID: id, Label: "Speech", Score: 0.9, StartSeconds: 0, EndSeconds: 1}
	if err := db.Create(&det).Error; err != nil {
		t.Fatalf("create detection: %v", err)
	}
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.ListAudioDetections(c); err != nil {
		t.Fatalf("ListAudioDetections: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

// ---------------------------------------------------------------------------
// Proxy / Thumbnail
// ---------------------------------------------------------------------------

func TestFile_Proxy_NotFound(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if httpCode(t, h.Proxy(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFile_Proxy_RedirectProxyFile(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	pid := uuid.New()
	p := models.File{ID: pid, LibraryID: fix.LibraryID, Name: "p.mp4", MimeType: "video/mp4", Size: 5, OwnerID: &fix.UserID, SourceFileID: &src}
	db.Create(&p)
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": pid.String()})
	if err := h.Proxy(c); err != nil {
		t.Fatalf("Proxy: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d", rec.Code)
	}
}

func TestFile_Proxy_RedirectToProxy(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	pid := uuid.New()
	p := models.File{ID: pid, LibraryID: fix.LibraryID, Name: "p.mp4", MimeType: "video/mp4", Size: 5, OwnerID: &fix.UserID, SourceFileID: &src}
	db.Create(&p)
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": src.String()})
	if err := h.Proxy(c); err != nil {
		t.Fatalf("Proxy: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d", rec.Code)
	}
}

func TestFile_Proxy_NotNeededRedirect(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	nn := "not_needed"
	db.Model(&models.File{}).Where("id = ?", src).Update("proxy_status", &nn)
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": src.String()})
	if err := h.Proxy(c); err != nil {
		t.Fatalf("Proxy: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d", rec.Code)
	}
}

func TestFile_Proxy_Processing(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	st := "processing"
	db.Model(&models.File{}).Where("id = ?", src).Update("proxy_status", &st)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": src.String()})
	if httpCode(t, h.Proxy(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFile_Proxy_ReadyFull(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	ready := "ready"
	db.Model(&models.File{}).Where("id = ?", src).Update("proxy_status", &ready)
	cacheKey := fmt.Sprintf("%s/%s/proxy.mp4", fix.LibraryID.String(), src.String())
	st.StoreCacheBuffer(cacheKey, []byte("proxydata"))
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": src.String()})
	if err := h.Proxy(c); err != nil {
		t.Fatalf("Proxy: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "proxydata" {
		t.Fatalf("want 200 proxydata, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestFile_Proxy_ReadyRange(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	ready := "ready"
	db.Model(&models.File{}).Where("id = ?", src).Update("proxy_status", &ready)
	cacheKey := fmt.Sprintf("%s/%s/proxy.mp4", fix.LibraryID.String(), src.String())
	st.StoreCacheBuffer(cacheKey, []byte("proxydata"))
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": src.String()})
	c.Request().Header.Set("Range", "bytes=0-4")
	if err := h.Proxy(c); err != nil {
		t.Fatalf("Proxy: %v", err)
	}
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("want 206, got %d", rec.Code)
	}
}

func TestFile_Proxy_ReadyNoCache(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	src := mkVideo(t, db, fix)
	ready := "ready"
	db.Model(&models.File{}).Where("id = ?", src).Update("proxy_status", &ready)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": src.String()})
	if httpCode(t, h.Proxy(c)) != http.StatusNotFound {
		t.Fatalf("want 404 (no cache)")
	}
}

func TestFile_Thumbnail_NotFound(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": uuid.New().String()})
	if httpCode(t, h.Thumbnail(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestFile_Thumbnail_Cache(t *testing.T) {
	h, db, st, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	cacheKey := fmt.Sprintf("%s/%s/thumbnail.webp", fix.LibraryID.String(), id.String())
	st.StoreCacheBuffer(cacheKey, []byte("thumbdata"))
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Thumbnail(c); err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "thumbdata" {
		t.Fatalf("want 200 thumbdata, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestFile_Thumbnail_RedirectFileID(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	thumbID := createFile(t, db, fix.LibraryID, fix.UserID, "t.webp", false, nil)
	id := uuid.New()
	f := models.File{ID: id, LibraryID: fix.LibraryID, Name: "a.jpg", MimeType: "image/jpeg", Size: 1, OwnerID: &fix.UserID, ThumbnailFileID: &thumbID}
	db.Create(&f)
	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Thumbnail(c); err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d", rec.Code)
	}
}

func TestFile_Thumbnail_NoCache(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil)
	c, _ := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if httpCode(t, h.Thumbnail(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

// ---------------------------------------------------------------------------
// ReprocessVideoThumbnails / Bulk
// ---------------------------------------------------------------------------

func TestFile_ReprocessVideoThumbnails_OK(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	mkVideo(t, db, fix)
	c, rec := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.ReprocessVideoThumbnails(c); err != nil {
		t.Fatalf("ReprocessVideoThumbnails: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestFile_ReprocessVideoThumbnails_NotOwner(t *testing.T) {
	h, _, _, fix := fullFileHandler(t)
	c, _ := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String()})
	// override access to non-owner
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: fix.LibraryID, IsOwner: false})
	if httpCode(t, h.ReprocessVideoThumbnails(c)) != http.StatusForbidden {
		t.Fatalf("want 403")
	}
}

func TestFile_ReprocessVideoThumbnails_NilSvc(t *testing.T) {
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)
	h := NewFileHandler(db, nil, st, nil, nil, nil, nil, nil, nil, nil)
	fix := seedLibrary(t, db)
	c, _ := ffCtx(http.MethodPost, "/", "", fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.ReprocessVideoThumbnails(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}

func TestFile_BulkTranscribe_All(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	mkVideo(t, db, fix)
	mkVideo(t, db, fix)
	createFile(t, db, fix.LibraryID, fix.UserID, "a.jpg", false, nil) // skipped (image, not matched by query)
	c, rec := ffCtx(http.MethodPost, "/", `{}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.BulkTranscribe(c); err != nil {
		t.Fatalf("BulkTranscribe: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d", rec.Code)
	}
	var resp bulkActionResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Enqueued) != 2 {
		t.Fatalf("expected 2 enqueued, got %d", len(resp.Enqueued))
	}
}

func TestFile_BulkAudioDetect_All(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	v := mkVideo(t, db, fix)
	ready := "ready"
	db.Model(&models.File{}).Where("id = ?", v).Update("transcribe_status", &ready)
	mkVideo(t, db, fix) // transcript not ready -> skipped
	c, rec := ffCtx(http.MethodPost, "/", `{}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.BulkAudioDetect(c); err != nil {
		t.Fatalf("BulkAudioDetect: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d", rec.Code)
	}
	var resp bulkActionResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Enqueued) != 1 {
		t.Fatalf("expected 1 enqueued, got %d", len(resp.Enqueued))
	}
}

func TestFile_BulkTranscribe_NilSvc(t *testing.T) {
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)
	h := NewFileHandler(db, nil, st, nil, nil, nil, nil, nil, nil, nil)
	fix := seedLibrary(t, db)
	c, _ := ffCtx(http.MethodPost, "/", `{}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.BulkTranscribe(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}

var _ = time.Now
