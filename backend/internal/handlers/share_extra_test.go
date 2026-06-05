package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func fullShareHandler(t *testing.T) (*ShareHandler, *gorm.DB, *storage.Service, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	if err := db.AutoMigrate(&models.Moment{}, &models.MomentShare{}); err != nil {
		t.Fatalf("migrate share: %v", err)
	}
	st := setupPurgeStorage(t)
	h := NewShareHandler(db, st, "http://share.example.com")
	fix := seedLibrary(t, db)
	return h, db, st, fix
}

// seedShare creates a file+moment+share and returns (token, momentID, fileID).
func seedShare(t *testing.T, db *gorm.DB, fix purgeTestFixture, exported bool) (string, uuid.UUID, uuid.UUID) {
	t.Helper()
	fileID := mkVideo(t, db, fix)
	momentID := uuid.New()
	m := models.Moment{ID: momentID, FileID: fileID, LibraryID: fix.LibraryID, CreatedByID: fix.UserID, Name: "Clip", StartSeconds: 1, EndSeconds: 5, ExportVersion: 1}
	if exported {
		v := 1
		ready := "ready"
		m.ExportedVersion = &v
		m.ExportStatus = &ready
	}
	if err := db.Create(&m).Error; err != nil {
		t.Fatalf("create moment: %v", err)
	}
	token := uuid.New().String()
	s := models.MomentShare{ID: uuid.New(), MomentID: momentID, LibraryID: fix.LibraryID, CreatedByID: fix.UserID, Token: token}
	if err := db.Create(&s).Error; err != nil {
		t.Fatalf("create share: %v", err)
	}
	return token, momentID, fileID
}

func shareReq(method, target, token string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues(token)
	return c, rec
}

func TestShare_Metadata_Ready(t *testing.T) {
	h, db, _, fix := fullShareHandler(t)
	token, _, _ := seedShare(t, db, fix, true)
	c, rec := shareReq(http.MethodGet, "/", token)
	if err := h.Metadata(c); err != nil {
		t.Fatalf("Metadata: %v", err)
	}
	var resp shareMetadataResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if !resp.Ready || resp.VideoURL == "" || resp.ThumbnailURL == "" {
		t.Fatalf("expected ready with URLs: %+v", resp)
	}
}

func TestShare_Metadata_EmptyToken(t *testing.T) {
	h, _, _, _ := fullShareHandler(t)
	c, _ := shareReq(http.MethodGet, "/", "")
	if httpCode(t, h.Metadata(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestShare_Video_Full(t *testing.T) {
	h, db, st, fix := fullShareHandler(t)
	token, momentID, _ := seedShare(t, db, fix, true)
	cacheKey := momentexport.CacheKey(fix.LibraryID.String(), momentID.String(), 1)
	st.StoreCacheBuffer(cacheKey, []byte("exportbytes"))
	c, rec := shareReq(http.MethodGet, "/", token)
	if err := h.Video(c); err != nil {
		t.Fatalf("Video: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "exportbytes" {
		t.Fatalf("want 200 body, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestShare_Video_Range(t *testing.T) {
	h, db, st, fix := fullShareHandler(t)
	token, momentID, _ := seedShare(t, db, fix, true)
	cacheKey := momentexport.CacheKey(fix.LibraryID.String(), momentID.String(), 1)
	st.StoreCacheBuffer(cacheKey, []byte("exportbytes"))
	c, rec := shareReq(http.MethodGet, "/", token)
	c.Request().Header.Set("Range", "bytes=0-4")
	if err := h.Video(c); err != nil {
		t.Fatalf("Video range: %v", err)
	}
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("want 206, got %d", rec.Code)
	}
}

func TestShare_Video_NotExported(t *testing.T) {
	h, db, _, fix := fullShareHandler(t)
	token, _, _ := seedShare(t, db, fix, false)
	c, _ := shareReq(http.MethodGet, "/", token)
	if httpCode(t, h.Video(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestShare_Video_UnknownToken(t *testing.T) {
	h, _, _, _ := fullShareHandler(t)
	c, _ := shareReq(http.MethodGet, "/", "nope")
	if httpCode(t, h.Video(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestShare_Video_MissingCache(t *testing.T) {
	h, db, _, fix := fullShareHandler(t)
	token, _, _ := seedShare(t, db, fix, true)
	// exported but no cache blob stored
	c, _ := shareReq(http.MethodGet, "/", token)
	if httpCode(t, h.Video(c)) != http.StatusNotFound {
		t.Fatalf("want 404 (missing cache)")
	}
}

func TestShare_Thumbnail_FromFile(t *testing.T) {
	h, db, st, fix := fullShareHandler(t)
	token, _, fileID := seedShare(t, db, fix, true)
	st.StoreFile(fix.LibraryID.String(), fileID.String(), []byte("thumbbytes"))
	c, rec := shareReq(http.MethodGet, "/", token)
	if err := h.Thumbnail(c); err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "thumbbytes" {
		t.Fatalf("want 200, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestShare_Thumbnail_SeparateThumbnailFile(t *testing.T) {
	h, db, st, fix := fullShareHandler(t)
	token, _, fileID := seedShare(t, db, fix, true)
	thumbID := uuid.New()
	thumb := models.File{ID: thumbID, LibraryID: fix.LibraryID, Name: "t.webp", MimeType: "image/webp", Size: 5, OwnerID: &fix.UserID}
	db.Create(&thumb)
	db.Model(&models.File{}).Where("id = ?", fileID).Update("thumbnail_file_id", thumbID)
	st.StoreFile(fix.LibraryID.String(), thumbID.String(), []byte("webpdata"))
	c, rec := shareReq(http.MethodGet, "/", token)
	if err := h.Thumbnail(c); err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/webp" {
		t.Fatalf("want image/webp, got %s", ct)
	}
}

func TestShare_Thumbnail_NotFound(t *testing.T) {
	h, db, _, fix := fullShareHandler(t)
	token, _, _ := seedShare(t, db, fix, true)
	// no file blob stored
	c, _ := shareReq(http.MethodGet, "/", token)
	if httpCode(t, h.Thumbnail(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestShare_Thumbnail_UnknownToken(t *testing.T) {
	h, _, _, _ := fullShareHandler(t)
	c, _ := shareReq(http.MethodGet, "/", "nope")
	if httpCode(t, h.Thumbnail(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestShare_ResolveBase_ConfigBeatsForwardedHost(t *testing.T) {
	// fullShareHandler is configured with baseURL http://share.example.com. A
	// spoofed X-Forwarded-Host must NOT override it (open-redirect / share-link
	// spoofing), so the configured base URL wins.
	h, _, _, _ := fullShareHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-Host", "proxy.example.com")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if base := h.resolveBase(c); base != "http://share.example.com" {
		t.Fatalf("got %q, want configured base URL to win", base)
	}
}

func TestShare_FirstNonEmpty_Extra(t *testing.T) {
	if firstNonEmpty("", "", "x") != "x" {
		t.Fatal("want x")
	}
	if firstNonEmpty("", "") != "" {
		t.Fatal("want empty")
	}
}
