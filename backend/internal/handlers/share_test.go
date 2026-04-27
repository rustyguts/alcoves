package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func TestFirstNonEmpty(t *testing.T) {
	if got := firstNonEmpty("", "", "third"); got != "third" {
		t.Fatalf("expected third, got %q", got)
	}
	if got := firstNonEmpty("first", "second"); got != "first" {
		t.Fatalf("expected first, got %q", got)
	}
	if got := firstNonEmpty("", "", ""); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestShareHandler_resolveBase(t *testing.T) {
	cases := []struct {
		name    string
		baseURL string
		host    string
		fwdHost string
		fwdProt string
		want    string
	}{
		{name: "x-forwarded headers win", baseURL: "https://config", host: "internal:3001",
			fwdHost: "share.example.com", fwdProt: "https", want: "https://share.example.com"},
		{name: "config baseURL when no forwarded", baseURL: "https://config.example.com/", host: "x", want: "https://config.example.com"},
		{name: "fallback to host", baseURL: "", host: "fallback.local:3001", want: "http://fallback.local:3001"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &ShareHandler{baseURL: tc.baseURL}
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Host = tc.host
			if tc.fwdHost != "" {
				req.Header.Set("X-Forwarded-Host", tc.fwdHost)
			}
			if tc.fwdProt != "" {
				req.Header.Set("X-Forwarded-Proto", tc.fwdProt)
			}
			c := echo.New().NewContext(req, httptest.NewRecorder())
			if got := h.resolveBase(c); got != tc.want {
				t.Fatalf("resolveBase=%q want %q", got, tc.want)
			}
		})
	}
}

func TestShareHandler_Metadata_404OnUnknownToken(t *testing.T) {
	db := libraryTestDB(t)
	h := NewShareHandler(db, nil, "http://localhost:3000")

	req := httptest.NewRequest(http.MethodGet, "/api/share/nope", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues("nope")

	err := h.Metadata(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", err)
	}
}

func TestShareHandler_Metadata_404OnRevoked(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "share-revoked@example.com")
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
	now := time.Now()
	share := models.MomentShare{
		MomentID: moment.ID, LibraryID: lib.ID, CreatedByID: owner.ID,
		Token: "revoked-tok", RevokedAt: &now,
	}
	if err := db.Create(&share).Error; err != nil {
		t.Fatalf("share: %v", err)
	}

	h := NewShareHandler(db, nil, "http://localhost:3000")
	req := httptest.NewRequest(http.MethodGet, "/api/share/revoked-tok", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues("revoked-tok")

	err := h.Metadata(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for revoked share, got %v", err)
	}
}

func TestShareHandler_Metadata_ReturnsMetadataForActiveShare(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "share-active@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	file := models.File{LibraryID: lib.ID, Name: "video.mp4"}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("file: %v", err)
	}
	moment := models.Moment{LibraryID: lib.ID, FileID: file.ID, CreatedByID: owner.ID,
		Name: "Best clip", StartSeconds: 0, EndSeconds: 1}
	if err := db.Create(&moment).Error; err != nil {
		t.Fatalf("moment: %v", err)
	}
	share := models.MomentShare{
		MomentID: moment.ID, LibraryID: lib.ID, CreatedByID: owner.ID,
		Token: "active-tok",
	}
	if err := db.Create(&share).Error; err != nil {
		t.Fatalf("share: %v", err)
	}

	h := NewShareHandler(db, nil, "https://share.example.com")
	req := httptest.NewRequest(http.MethodGet, "/api/share/active-tok", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues("active-tok")

	if err := h.Metadata(c); err != nil {
		t.Fatalf("Metadata: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp shareMetadataResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Token != "active-tok" {
		t.Fatalf("token mismatch: %q", resp.Token)
	}
	if resp.Title != "Best clip" {
		t.Fatalf("expected title 'Best clip', got %q", resp.Title)
	}
	if resp.ShareURL != "https://share.example.com/s/active-tok" {
		t.Fatalf("unexpected share url: %q", resp.ShareURL)
	}
	if resp.Ready {
		t.Fatal("expected ready=false (no exported version)")
	}
	if resp.VideoURL != "" || resp.ThumbnailURL != "" {
		t.Fatal("non-ready shares must not expose video/thumbnail URLs")
	}
}

func TestShareHandler_Video_404WhenNotExported(t *testing.T) {
	db := libraryTestDB(t)
	owner := mustUser(t, db, "share-vid@example.com")
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
		Token: "novid-tok",
	}
	if err := db.Create(&share).Error; err != nil {
		t.Fatalf("share: %v", err)
	}

	h := NewShareHandler(db, nil, "https://x")
	req := httptest.NewRequest(http.MethodGet, "/api/share/novid-tok/video", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues("novid-tok")

	err := h.Video(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", err)
	}
}
