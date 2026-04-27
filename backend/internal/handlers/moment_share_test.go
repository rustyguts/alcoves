package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
)

func TestGenerateShareToken_UniqueAndUrlSafe(t *testing.T) {
	a, err := generateShareToken()
	if err != nil {
		t.Fatalf("generateShareToken: %v", err)
	}
	b, err := generateShareToken()
	if err != nil {
		t.Fatalf("generateShareToken: %v", err)
	}
	if a == b {
		t.Fatal("expected unique tokens")
	}
	if len(a) < 30 {
		t.Fatalf("token too short: %d", len(a))
	}
	for _, ch := range a {
		ok := (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '-' || ch == '_'
		if !ok {
			t.Fatalf("token has non-url-safe char %q in %q", ch, a)
		}
	}
}

func TestMomentHandler_baseURLFor_Priority(t *testing.T) {
	cases := []struct {
		name    string
		baseURL string
		host    string
		origin  string
		fwdHost string
		want    string
	}{
		{name: "Origin header wins", baseURL: "https://cfg", host: "h", origin: "https://web.example.com", want: "https://web.example.com"},
		{name: "Origin null falls through", baseURL: "https://cfg", host: "h", origin: "null", want: "https://cfg"},
		{name: "X-Forwarded next", baseURL: "https://cfg", host: "h", fwdHost: "tunnel.example.com", want: "http://tunnel.example.com"},
		{name: "config when none", baseURL: "https://cfg.example.com/", host: "h", want: "https://cfg.example.com"},
		{name: "host fallback", host: "fallback:3001", want: "http://fallback:3001"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &MomentHandler{baseURL: tc.baseURL}
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Host = tc.host
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.fwdHost != "" {
				req.Header.Set("X-Forwarded-Host", tc.fwdHost)
			}
			c := echo.New().NewContext(req, httptest.NewRecorder())
			if got := h.baseURLFor(c); got != tc.want {
				t.Fatalf("baseURLFor=%q want %q", got, tc.want)
			}
		})
	}
}

func TestMomentHandler_CreateShare_BlockedWhenSharingDisabled(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "ms-disabled@example.com")
	lib := mustLibrary(t, db, owner.ID, "Disabled", false)
	// SharingEnabled defaults to false for new libraries.
	file := models.File{LibraryID: lib.ID, Name: "v.mp4"}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("file: %v", err)
	}
	moment := models.Moment{LibraryID: lib.ID, FileID: file.ID, CreatedByID: owner.ID,
		StartSeconds: 0, EndSeconds: 1}
	if err := db.Create(&moment).Error; err != nil {
		t.Fatalf("moment: %v", err)
	}

	h := &MomentHandler{db: db}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("id", "fileId", "momentId")
	c.SetParamValues(lib.ID.String(), file.ID.String(), moment.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	err := h.CreateShare(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when sharing disabled, got %v", err)
	}
}

func TestMomentHandler_CreateShare_SucceedsWhenEnabled(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "ms-enabled@example.com")
	lib := mustLibrary(t, db, owner.ID, "Enabled", false)
	if err := db.Model(&models.Library{}).Where("id = ?", lib.ID).
		Update("sharing_enabled", true).Error; err != nil {
		t.Fatalf("enable sharing: %v", err)
	}
	file := models.File{LibraryID: lib.ID, Name: "v.mp4"}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("file: %v", err)
	}
	moment := models.Moment{LibraryID: lib.ID, FileID: file.ID, CreatedByID: owner.ID,
		StartSeconds: 0, EndSeconds: 1}
	if err := db.Create(&moment).Error; err != nil {
		t.Fatalf("moment: %v", err)
	}

	h := &MomentHandler{db: db, baseURL: "https://app.example.com"}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("id", "fileId", "momentId")
	c.SetParamValues(lib.ID.String(), file.ID.String(), moment.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	if err := h.CreateShare(c); err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rec.Code)
	}
	var resp momentShareResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Token == "" {
		t.Fatal("empty token in response")
	}
	if resp.URL != "https://app.example.com/s/"+resp.Token {
		t.Fatalf("unexpected url %q", resp.URL)
	}
	var count int64
	db.Model(&models.MomentShare{}).Where("moment_id = ?", moment.ID).Count(&count)
	if count != 1 {
		t.Fatalf("expected 1 share row, got %d", count)
	}
}

func TestMomentHandler_RevokeShare_MarksRevoked(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "ms-revoke@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	file := models.File{LibraryID: lib.ID, Name: "v.mp4"}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("file: %v", err)
	}
	moment := models.Moment{LibraryID: lib.ID, FileID: file.ID, CreatedByID: owner.ID,
		StartSeconds: 0, EndSeconds: 1}
	if err := db.Create(&moment).Error; err != nil {
		t.Fatalf("moment: %v", err)
	}
	share := models.MomentShare{
		MomentID: moment.ID, LibraryID: lib.ID, CreatedByID: owner.ID,
		Token: "rev-this",
	}
	if err := db.Create(&share).Error; err != nil {
		t.Fatalf("share: %v", err)
	}

	h := &MomentHandler{db: db}
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("id", "fileId", "momentId", "token")
	c.SetParamValues(lib.ID.String(), file.ID.String(), moment.ID.String(), "rev-this")
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	if err := h.RevokeShare(c); err != nil {
		t.Fatalf("RevokeShare: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	var reloaded models.MomentShare
	if err := db.Where("token = ?", "rev-this").First(&reloaded).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.RevokedAt == nil {
		t.Fatal("expected revoked_at to be set")
	}
}

func TestMomentHandler_RevokeShare_404OnUnknownToken(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "ms-rev-404@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	file := models.File{LibraryID: lib.ID, Name: "v.mp4"}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("file: %v", err)
	}
	moment := models.Moment{LibraryID: lib.ID, FileID: file.ID, CreatedByID: owner.ID,
		StartSeconds: 0, EndSeconds: 1}
	if err := db.Create(&moment).Error; err != nil {
		t.Fatalf("moment: %v", err)
	}

	h := &MomentHandler{db: db}
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("id", "fileId", "momentId", "token")
	c.SetParamValues(lib.ID.String(), file.ID.String(), moment.ID.String(), "ghost")
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	err := h.RevokeShare(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", err)
	}
}
