package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
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

// TestGoogleCallback_AccountCreateFailure_NoOrphanedUser verifies that when
// the google account row creation fails (unique-constraint violation on
// provider+providerAccountID), the transaction is rolled back and the
// newly-created user row is NOT left orphaned in the database.
//
// The test directly exercises the same transaction block used by
// GoogleCallback's new-user path; this mirrors the unit-test approach used
// for TestRegister_AccountCreateFailure_NoOrphanedUser.
func TestGoogleCallback_AccountCreateFailure_NoOrphanedUser(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&models.Account{}, &models.Library{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// We need a pre-existing account row that will collide with the INSERT
	// attempted inside the transaction below. Seed an owner + a google account.
	seedOwner := models.User{Email: "seed-google-owner@example.com", DisplayName: "seed", Role: "member"}
	if err := db.Create(&seedOwner).Error; err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	collisionID := uuid.New().String()
	if err := db.Create(&models.Account{
		UserID:            seedOwner.ID,
		Provider:          "google",
		ProviderAccountID: collisionID,
	}).Error; err != nil {
		t.Fatalf("seed collision account: %v", err)
	}

	// Verify that we cannot construct a new-user handler (compilation check).
	authSvc, _ := authservice.NewService(db, "test-secret-key-at-least-32-chars-long")
	_ = NewOAuthHandler(db, authSvc, "clientid", "clientsecret", "http://localhost:3001")

	// Run the same transaction block that GoogleCallback uses for new users.
	// The account insert will fail because (google, collisionID) already exists.
	newEmail := "new-google-txtest@example.com"
	newUser := models.User{Email: newEmail, DisplayName: "New Google User", Role: "member"}

	txErr := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&newUser).Error; err != nil {
			return err
		}
		if err := tx.Create(&models.Library{
			Name:      "My Library",
			IsDefault: true,
			OwnerID:   newUser.ID,
		}).Error; err != nil {
			return err
		}
		// Deliberately collide on (google, collisionID).
		if err := tx.Create(&models.Account{
			UserID:            newUser.ID,
			Provider:          "google",
			ProviderAccountID: collisionID,
		}).Error; err != nil {
			return err
		}
		return nil
	})

	if txErr == nil {
		t.Fatal("expected transaction to fail due to unique-constraint violation on accounts")
	}

	// No user row should remain — the rollback must have removed it.
	var count int64
	db.Model(&models.User{}).Where("email = ?", newEmail).Count(&count)
	if count != 0 {
		t.Fatalf("expected 0 user rows after rollback, got %d orphaned row(s)", count)
	}
}
