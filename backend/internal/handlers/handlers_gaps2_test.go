package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
)

func momentDownloadKey(fix purgeTestFixture, mid uuid.UUID) string {
	return momentexport.CacheKey(fix.LibraryID.String(), mid.String(), 1)
}

func shareVideoKey(fix purgeTestFixture, mid uuid.UUID) string {
	return momentexport.CacheKey(fix.LibraryID.String(), mid.String(), 1)
}

func stringsReader(s string) *strings.Reader { return strings.NewReader(s) }

// ---- moment.go remaining branches ----

func TestMoment_Get_InvalidFileID(t *testing.T) {
	h, _, _, fix, _ := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": "bad", "momentId": uuid.New().String()})
	if httpCode(t, h.Get(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (invalid fileId)")
	}
}

func TestMoment_List_InvalidFileID(t *testing.T) {
	h, _, _, fix, _ := fullMomentHandler(t)
	c, _ := momentCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": "bad"})
	if httpCode(t, h.List(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestMoment_Download_BadRange(t *testing.T) {
	h, db, st, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	v := 1
	ready := "ready"
	db.Model(&models.Moment{}).Where("id = ?", mid).Updates(map[string]any{"exported_version": &v, "export_status": &ready})
	cacheKey := momentDownloadKey(fix, mid)
	st.StoreCacheBuffer(cacheKey, []byte("data"))
	c, _ := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, mid.String()))
	c.Request().Header.Set("Range", "weird=abc")
	if httpCode(t, h.Download(c)) != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("want 416 (bad range)")
	}
}

func TestMoment_Download_RangeBeyond(t *testing.T) {
	h, db, st, fix, fileID := fullMomentHandler(t)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	v := 1
	ready := "ready"
	db.Model(&models.Moment{}).Where("id = ?", mid).Updates(map[string]any{"exported_version": &v, "export_status": &ready})
	cacheKey := momentDownloadKey(fix, mid)
	st.StoreCacheBuffer(cacheKey, []byte("data"))
	c, _ := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, mid.String()))
	c.Request().Header.Set("Range", "bytes=9999-")
	if err := h.Download(c); err != nil {
		t.Fatalf("Download: %v", err)
	}
}

// ---- avatar.go ----

func TestAvatar_ServeByUserID_EmptyID(t *testing.T) {
	h, _, _, fix := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("userId")
	c.SetParamValues("")
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if httpCode(t, h.ServeByUserID(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (empty userId)")
	}
}

// ---- share.go Video bad range ----

func TestShare_Video_BadRange(t *testing.T) {
	h, db, st, fix := fullShareHandler(t)
	token, momentID, _ := seedShare(t, db, fix, true)
	cacheKey := shareVideoKey(fix, momentID)
	st.StoreCacheBuffer(cacheKey, []byte("vid"))
	c, _ := shareReq(http.MethodGet, "/", token)
	c.Request().Header.Set("Range", "weird=abc")
	if httpCode(t, h.Video(c)) != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("want 416")
	}
}

func TestShare_Video_RangeBeyond(t *testing.T) {
	h, db, st, fix := fullShareHandler(t)
	token, momentID, _ := seedShare(t, db, fix, true)
	cacheKey := shareVideoKey(fix, momentID)
	st.StoreCacheBuffer(cacheKey, []byte("vid"))
	c, _ := shareReq(http.MethodGet, "/", token)
	c.Request().Header.Set("Range", "bytes=9999-")
	if err := h.Video(c); err != nil {
		t.Fatalf("Video: %v", err)
	}
}

// ---- library.go Update with detection services (enters async enqueue branches) ----

func TestLibraryHandler_Update_DetectionServices(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-det-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	createFile(t, db, lib.ID, owner.ID, "img.jpg", false, nil)

	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })
	st := setupPurgeStorage(t)
	faceSvc := facedetection.NewService(db, st, client, &facedetection.FaceConfig{})
	objSvc := objectdetection.NewService(db, st, client, &objectdetection.ObjectConfig{})
	h := NewLibraryHandler(db, access.NewService(db), faceSvc, objSvc)

	body := `{"faceRecognitionEnabled":true,"objectDetectionEnabled":true}`
	req := httptest.NewRequest(http.MethodPatch, "/", stringsReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: lib.ID, OwnerID: owner.ID, IsOwner: true, IsAdmin: true})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	// Give the async enqueue goroutines a moment to run.
	time.Sleep(150 * time.Millisecond)
}
