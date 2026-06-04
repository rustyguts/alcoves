package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
)

func configuredOAuthHandler(t *testing.T) *OAuthHandler {
	t.Helper()
	db := testDB(t)
	authSvc, _ := authservice.NewService(db, "test-secret-key-at-least-32-chars-long")
	return NewOAuthHandler(db, authSvc, "client-id", "client-secret", "http://localhost:3001")
}

func TestOAuth_GoogleLogin_Enabled(t *testing.T) {
	h := configuredOAuthHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/google", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := h.GoogleLogin(c); err != nil {
		t.Fatalf("GoogleLogin: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "accounts.google.com") {
		t.Fatalf("expected redirect to google, got %q", loc)
	}
	// state cookie must be set
	var found bool
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == oauthStateCookie && ck.Value != "" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected state cookie to be set")
	}
}

func TestOAuth_GoogleCallback_EmptyCode(t *testing.T) {
	h := configuredOAuthHandler(t)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?state=match&code=", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "match"})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := h.GoogleCallback(c); err != nil {
		t.Fatalf("GoogleCallback: %v", err)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "error=oauth_failed") {
		t.Fatalf("expected oauth_failed redirect, got %q", loc)
	}
}

func TestOAuth_GoogleCallback_Disabled(t *testing.T) {
	h := &OAuthHandler{enabled: false}
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	err := h.GoogleCallback(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %v", err)
	}
}

func TestOAuth_NewHandler_Disabled(t *testing.T) {
	db := testDB(t)
	authSvc, _ := authservice.NewService(db, "test-secret-key-at-least-32-chars-long")
	h := NewOAuthHandler(db, authSvc, "", "", "http://localhost:3001")
	if h.enabled {
		t.Fatalf("expected disabled when no client id/secret")
	}
}
