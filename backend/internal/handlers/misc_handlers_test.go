package handlers

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
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
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// ---------------------------------------------------------------------------
// Objects handler
// ---------------------------------------------------------------------------

func fullObjectsHandler(t *testing.T) (*ObjectsHandler, *gorm.DB, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	if err := db.AutoMigrate(&models.ObjectDetection{}); err != nil {
		t.Fatalf("migrate object_detections: %v", err)
	}
	st := setupPurgeStorage(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })
	objSvc := objectdetection.NewService(db, st, client, &objectdetection.ObjectConfig{})
	h := NewObjectsHandler(db, objSvc)
	fix := seedLibrary(t, db)
	return h, db, fix
}

func miscCtx(method string, fix purgeTestFixture, params map[string]string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	req := httptest.NewRequest(method, "/", nil)
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
	return c, rec
}

func TestObjects_Labels(t *testing.T) {
	h, db, fix := fullObjectsHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	db.Create(&models.ObjectDetection{ID: uuid.New(), FileID: fileID, LibraryID: fix.LibraryID, Label: "cat", Confidence: 90, ImageWidth: 10, ImageHeight: 10})
	db.Create(&models.ObjectDetection{ID: uuid.New(), FileID: fileID, LibraryID: fix.LibraryID, Label: "dog", Confidence: 80, ImageWidth: 10, ImageHeight: 10})
	c, rec := miscCtx(http.MethodGet, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Labels(c); err != nil {
		t.Fatalf("Labels: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	labels, _ := resp["labels"].([]any)
	if len(labels) != 2 {
		t.Fatalf("expected 2 labels, got %d", len(labels))
	}
}

func TestObjects_Labels_Empty(t *testing.T) {
	h, _, fix := fullObjectsHandler(t)
	c, rec := miscCtx(http.MethodGet, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Labels(c); err != nil {
		t.Fatalf("Labels: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestObjects_Reprocess_NilSvc(t *testing.T) {
	db := setupPurgeTestDB(t)
	h := NewObjectsHandler(db, nil)
	fix := seedLibrary(t, db)
	c, _ := miscCtx(http.MethodPost, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Reprocess(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}

func TestObjects_Reprocess_OK(t *testing.T) {
	h, db, fix := fullObjectsHandler(t)
	createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	c, rec := miscCtx(http.MethodPost, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Reprocess(c); err != nil {
		t.Fatalf("Reprocess: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Search handler
// ---------------------------------------------------------------------------

func fullSearchHandler(t *testing.T) (*SearchHandler, *gorm.DB, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	if err := db.AutoMigrate(&models.LibraryMember{}, &models.ObjectDetection{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	h := NewSearchHandler(db)
	fix := seedLibrary(t, db)
	return h, db, fix
}

func searchCtx(fix purgeTestFixture, query string, authed bool) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	target := "/search"
	if query != "" {
		target += "?q=" + query
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if authed {
		c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	}
	return c, rec
}

func TestSearch_Unauthorized(t *testing.T) {
	h, _, fix := fullSearchHandler(t)
	c, _ := searchCtx(fix, "x", false)
	if httpCode(t, h.Search(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestSearch_EmptyQuery(t *testing.T) {
	h, _, fix := fullSearchHandler(t)
	c, rec := searchCtx(fix, "", true)
	if err := h.Search(c); err != nil {
		t.Fatalf("Search: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["totalCount"].(float64) != 0 {
		t.Fatalf("expected 0 results")
	}
}

func TestSearch_ByName(t *testing.T) {
	h, db, fix := fullSearchHandler(t)
	createFile(t, db, fix.LibraryID, fix.UserID, "vacation.jpg", false, nil)
	createFolder(t, db, fix.LibraryID, "vacation-folder", false, nil)
	c, rec := searchCtx(fix, "vacation", true)
	if err := h.Search(c); err != nil {
		t.Fatalf("Search: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["totalCount"].(float64) < 2 {
		t.Fatalf("expected >=2 results, got %v", resp["totalCount"])
	}
}

func TestSearch_ByObjectLabel(t *testing.T) {
	h, db, fix := fullSearchHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "img.jpg", false, nil)
	db.Create(&models.ObjectDetection{ID: uuid.New(), FileID: fileID, LibraryID: fix.LibraryID, Label: "elephant", Confidence: 95, ImageWidth: 10, ImageHeight: 10})
	c, rec := searchCtx(fix, "elephant", true)
	if err := h.Search(c); err != nil {
		t.Fatalf("Search: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["totalCount"].(float64) < 1 {
		t.Fatalf("expected object match")
	}
}

func TestSearch_NameAndObject(t *testing.T) {
	h, db, fix := fullSearchHandler(t)
	// file name "tiger.jpg" AND has object label "tiger" -> name+object reason
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "tiger.jpg", false, nil)
	db.Create(&models.ObjectDetection{ID: uuid.New(), FileID: fileID, LibraryID: fix.LibraryID, Label: "tiger", Confidence: 95, ImageWidth: 10, ImageHeight: 10})
	c, rec := searchCtx(fix, "tiger", true)
	if err := h.Search(c); err != nil {
		t.Fatalf("Search: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	results, _ := resp["results"].([]any)
	if len(results) == 0 {
		t.Fatalf("expected results")
	}
}

func TestDedup(t *testing.T) {
	got := dedup([]string{"Cat", "cat", "Dog", "DOG", "bird"})
	if len(got) != 3 {
		t.Fatalf("expected 3 unique, got %d (%v)", len(got), got)
	}
}

// ---------------------------------------------------------------------------
// Avatar handler
// ---------------------------------------------------------------------------

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for x := 0; x < 8; x++ {
		for y := 0; y < 8; y++ {
			img.Set(x, y, color.RGBA{uint8(x * 30), uint8(y * 30), 100, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func fullAvatarHandler(t *testing.T) (*AvatarHandler, *gorm.DB, *storage.Service, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)
	h := NewAvatarHandler(db, st)
	fix := seedLibrary(t, db)
	return h, db, st, fix
}

func TestAvatar_Upload_RawValid(t *testing.T) {
	h, db, _, fix := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(tinyPNG(t)))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var u models.User
	db.First(&u, "id = ?", fix.UserID)
	if u.AvatarUrl == nil || *u.AvatarUrl == "" {
		t.Fatalf("avatar_url not set")
	}
}

func TestAvatar_Upload_Multipart(t *testing.T) {
	h, _, _, fix := fullAvatarHandler(t)
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, _ := w.CreateFormFile("avatar", "a.png")
	fw.Write(tinyPNG(t))
	w.Close()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set(echo.HeaderContentType, w.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestAvatar_Upload_Empty(t *testing.T) {
	h, _, _, fix := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if httpCode(t, h.Upload(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestAvatar_Upload_InvalidImage(t *testing.T) {
	h, _, _, fix := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("not-an-image"))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if httpCode(t, h.Upload(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 for invalid image")
	}
}

func TestAvatar_Upload_Unauthorized(t *testing.T) {
	h, _, _, _ := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(tinyPNG(t)))
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if httpCode(t, h.Upload(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestAvatar_Serve(t *testing.T) {
	h, _, st, fix := fullAvatarHandler(t)
	if err := st.StoreAvatar(fix.UserID.String(), tinyPNG(t)); err != nil {
		t.Fatalf("store avatar: %v", err)
	}
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.Serve(c); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAvatar_Serve_NotFound(t *testing.T) {
	h, _, _, fix := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if httpCode(t, h.Serve(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestAvatar_Serve_Unauthorized(t *testing.T) {
	h, _, _, _ := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if httpCode(t, h.Serve(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestAvatar_ServeByUserID(t *testing.T) {
	h, _, st, fix := fullAvatarHandler(t)
	other := uuid.New()
	st.StoreAvatar(other.String(), tinyPNG(t))
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("userId")
	c.SetParamValues(other.String())
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	if err := h.ServeByUserID(c); err != nil {
		t.Fatalf("ServeByUserID: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAvatar_ServeByUserID_Unauthorized(t *testing.T) {
	h, _, _, _ := fullAvatarHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("userId")
	c.SetParamValues(uuid.New().String())
	if httpCode(t, h.ServeByUserID(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}
