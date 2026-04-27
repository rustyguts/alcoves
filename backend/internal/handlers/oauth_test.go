package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

// newOAuthHandlerForTest returns an enabled handler with a stub config.
// Only GoogleLogin / state validation are exercised — no DB or token exchange.
func newOAuthHandlerForTest() *OAuthHandler {
	h := &OAuthHandler{enabled: true}
	// oauthConfig only needs to be non-nil for AuthCodeURL.
	h.oauthConfig = nil
	return h
}

func TestGenerateOAuthState_UniqueAndUrlSafe(t *testing.T) {
	a, err := generateOAuthState()
	if err != nil {
		t.Fatalf("generateOAuthState: %v", err)
	}
	b, err := generateOAuthState()
	if err != nil {
		t.Fatalf("generateOAuthState: %v", err)
	}
	if a == b {
		t.Fatalf("expected unique states, got identical: %q", a)
	}
	if len(a) < 32 {
		t.Fatalf("state too short: %d bytes encoded", len(a))
	}
	if strings.ContainsAny(a, "+/=\n\r ") {
		t.Fatalf("state should be url-safe with no padding, got %q", a)
	}
}

func TestGoogleLogin_Disabled(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/google", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &OAuthHandler{enabled: false}
	err := h.GoogleLogin(c)
	if err == nil {
		t.Fatal("expected error when OAuth disabled")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 HTTPError, got %v", err)
	}
}

func TestGoogleCallback_RejectsMissingState(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?code=abc", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := newOAuthHandlerForTest()
	if err := h.GoogleCallback(c); err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("expected redirect, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); !strings.Contains(loc, "error=oauth_state") {
		t.Fatalf("expected oauth_state error redirect, got %q", loc)
	}
}

func TestGoogleCallback_RejectsStateMismatch(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?code=abc&state=attacker", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "victim"})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := newOAuthHandlerForTest()
	if err := h.GoogleCallback(c); err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if loc := rec.Header().Get("Location"); !strings.Contains(loc, "error=oauth_state") {
		t.Fatalf("expected oauth_state error redirect, got %q", loc)
	}
	// Cookie must be cleared regardless of failure to prevent replay.
	if cleared := rec.Result().Cookies(); !cookieCleared(cleared, oauthStateCookie) {
		t.Fatalf("expected state cookie to be cleared on mismatch, cookies=%v", cleared)
	}
}

func TestGoogleCallback_RejectsEmptyCookieValue(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?code=abc&state=", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: ""})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := newOAuthHandlerForTest()
	if err := h.GoogleCallback(c); err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if loc := rec.Header().Get("Location"); !strings.Contains(loc, "error=oauth_state") {
		t.Fatalf("expected oauth_state error redirect, got %q", loc)
	}
}

func cookieCleared(cookies []*http.Cookie, name string) bool {
	for _, c := range cookies {
		if c.Name == name && c.MaxAge < 0 {
			return true
		}
	}
	return false
}
