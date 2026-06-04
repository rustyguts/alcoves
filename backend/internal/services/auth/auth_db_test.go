package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// testDB connects to the dedicated parallel-safe test database, migrates the
// models this package touches, and truncates them between tests. Tests skip
// (zero coverage) only if the DB is genuinely unreachable.
func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_auth")
	if err := db.AutoMigrate(&models.User{}, &models.Session{}); err != nil {
		t.Skipf("Skipping test: migrate failed: %v", err)
	}
	// NOTE: do NOT wipe tables — alcoves_test is shared with the middleware
	// and models packages, which may run in parallel. Unique UUID emails/tokens
	// keep tests isolated without truncation.
	return db
}

func newSvc(t *testing.T, db *gorm.DB) *Service {
	t.Helper()
	svc, err := NewService(db, "a-test-secret-that-is-plenty-long-enough")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func newCtx(t *testing.T) (echo.Context, *httptest.ResponseRecorder) {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "test-agent")
	rec := httptest.NewRecorder()
	return e.NewContext(req, rec), rec
}

// createUser inserts a user with a unique email (label + UUID) so this
// package's tests never collide with the other DB-backed packages sharing
// alcoves_test on the users.email unique index.
func createUser(t *testing.T, db *gorm.DB, label string) models.User {
	t.Helper()
	u := models.User{
		Email:       label + "+" + uuid.NewString() + "@test.com",
		DisplayName: "Test",
		Role:        "member",
	}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func TestCreateAndValidateSession(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	user := createUser(t, db, "create@test.com")

	c, _ := newCtx(t)
	token, err := svc.CreateSession(user.ID, c)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if token == "" {
		t.Fatal("CreateSession returned empty token")
	}

	session, err := svc.ValidateSession(token)
	if err != nil {
		t.Fatalf("ValidateSession: %v", err)
	}
	if session == nil {
		t.Fatal("ValidateSession returned nil for valid token")
	}
	if session.UserID != user.ID {
		t.Errorf("session.UserID = %v, want %v", session.UserID, user.ID)
	}
	if session.UserAgent == nil || *session.UserAgent != "test-agent" {
		t.Errorf("session.UserAgent = %v, want 'test-agent'", session.UserAgent)
	}
}

func TestValidateSession_NotFound(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)

	session, err := svc.ValidateSession(uuid.NewString())
	if err != nil {
		t.Fatalf("ValidateSession: %v", err)
	}
	if session != nil {
		t.Error("expected nil session for unknown token")
	}
}

func TestValidateSession_Expired(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	user := createUser(t, db, "expired@test.com")

	// Insert an already-expired session directly.
	expired := models.Session{
		UserID:       user.ID,
		SessionToken: uuid.NewString(),
		ExpiresAt:    time.Now().Add(-time.Hour),
	}
	if err := db.Create(&expired).Error; err != nil {
		t.Fatalf("create expired session: %v", err)
	}

	session, err := svc.ValidateSession(expired.SessionToken)
	if err != nil {
		t.Fatalf("ValidateSession: %v", err)
	}
	if session != nil {
		t.Error("expected nil session for expired token")
	}

	// Expired session should have been deleted.
	var count int64
	db.Model(&models.Session{}).Where("session_token = ?", expired.SessionToken).Count(&count)
	if count != 0 {
		t.Error("expired session should be deleted on validation")
	}
}

func TestDeleteSession(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	user := createUser(t, db, "delete@test.com")

	c, _ := newCtx(t)
	token, err := svc.CreateSession(user.ID, c)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	if err := svc.DeleteSession(token); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	session, _ := svc.ValidateSession(token)
	if session != nil {
		t.Error("session should be gone after DeleteSession")
	}
}

func TestDeleteSessionByID(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	user := createUser(t, db, "delbyid@test.com")
	other := createUser(t, db, "other@test.com")

	c, _ := newCtx(t)
	token, _ := svc.CreateSession(user.ID, c)
	session, _ := svc.ValidateSession(token)
	if session == nil {
		t.Fatal("setup: session should exist")
	}

	// Wrong user can't delete it.
	if err := svc.DeleteSessionByID(session.ID, other.ID); err != nil {
		t.Fatalf("DeleteSessionByID (wrong user): %v", err)
	}
	if s, _ := svc.ValidateSession(token); s == nil {
		t.Error("session should survive delete by wrong user")
	}

	// Correct user deletes it.
	if err := svc.DeleteSessionByID(session.ID, user.ID); err != nil {
		t.Fatalf("DeleteSessionByID: %v", err)
	}
	if s, _ := svc.ValidateSession(token); s != nil {
		t.Error("session should be gone after DeleteSessionByID by owner")
	}
}

func TestSetAndGetSessionCookie(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)

	c, rec := newCtx(t)
	payload := SessionPayload{SessionToken: "tok-123", UserID: "uid-456"}
	if err := svc.SetSessionCookie(c, payload); err != nil {
		t.Fatalf("SetSessionCookie: %v", err)
	}

	// Extract Set-Cookie and replay it on a fresh request.
	setCookie := rec.Header().Get("Set-Cookie")
	if setCookie == "" {
		t.Fatal("no Set-Cookie header written")
	}

	e := echo.New()
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("Cookie", setCookie)
	c2 := e.NewContext(req2, httptest.NewRecorder())

	got, err := svc.GetSessionFromCookie(c2)
	if err != nil {
		t.Fatalf("GetSessionFromCookie: %v", err)
	}
	if got.SessionToken != "tok-123" || got.UserID != "uid-456" {
		t.Errorf("decoded payload = %+v, want {tok-123 uid-456}", got)
	}
}

func TestGetSessionFromCookie_NoCookie(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	c, _ := newCtx(t)
	if _, err := svc.GetSessionFromCookie(c); err == nil {
		t.Error("expected error when no cookie present")
	}
}

func TestGetSessionFromCookie_BadEncoding(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: "!!!not-base64!!!"})
	c := e.NewContext(req, httptest.NewRecorder())

	if _, err := svc.GetSessionFromCookie(c); err == nil {
		t.Error("expected error for non-base64 cookie value")
	}
}

func TestGetSessionFromCookie_TooShort(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// Valid base64 but shorter than the GCM nonce size.
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: "AAAA"})
	c := e.NewContext(req, httptest.NewRecorder())

	if _, err := svc.GetSessionFromCookie(c); err == nil {
		t.Error("expected error for too-short ciphertext")
	}
}

func TestGetSessionFromCookie_WrongKey(t *testing.T) {
	db := testDB(t)
	svc1 := newSvc(t, db)
	svc2, _ := NewService(db, "a-different-secret-that-is-long-enough!")

	c, rec := newCtx(t)
	if err := svc1.SetSessionCookie(c, SessionPayload{SessionToken: "x", UserID: "y"}); err != nil {
		t.Fatalf("SetSessionCookie: %v", err)
	}
	setCookie := rec.Header().Get("Set-Cookie")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Cookie", setCookie)
	c2 := e.NewContext(req, httptest.NewRecorder())

	if _, err := svc2.GetSessionFromCookie(c2); err == nil {
		t.Error("expected decrypt failure with a different key")
	}
}

func TestClearSessionCookie(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	c, rec := newCtx(t)

	svc.ClearSessionCookie(c)
	setCookie := rec.Header().Get("Set-Cookie")
	if setCookie == "" {
		t.Fatal("ClearSessionCookie wrote no Set-Cookie header")
	}
	// Cleared cookie should set Max-Age to a non-positive value.
	if !contains(setCookie, "Max-Age=0") && !contains(setCookie, "Max-Age=-1") {
		t.Errorf("expected expiring cookie, got %q", setCookie)
	}
}

func TestGetUserBySession_Valid(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	user := createUser(t, db, "bysession@test.com")

	// Create a session and a matching cookie.
	c, rec := newCtx(t)
	token, err := svc.CreateSession(user.ID, c)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := svc.SetSessionCookie(c, SessionPayload{SessionToken: token, UserID: user.ID.String()}); err != nil {
		t.Fatalf("SetSessionCookie: %v", err)
	}
	setCookie := rec.Header().Get("Set-Cookie")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Cookie", setCookie)
	c2 := e.NewContext(req, httptest.NewRecorder())

	gotUser, gotToken, err := svc.GetUserBySession(c2)
	if err != nil {
		t.Fatalf("GetUserBySession: %v", err)
	}
	if gotUser == nil {
		t.Fatal("expected user, got nil")
	}
	if gotUser.ID != user.ID {
		t.Errorf("user.ID = %v, want %v", gotUser.ID, user.ID)
	}
	if gotToken != token {
		t.Errorf("token = %q, want %q", gotToken, token)
	}
}

func TestGetUserBySession_NoCookie(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)
	c, _ := newCtx(t)

	user, token, err := svc.GetUserBySession(c)
	if err == nil {
		t.Error("expected error when no cookie present")
	}
	if user != nil || token != "" {
		t.Errorf("expected nil/empty, got %v/%q", user, token)
	}
}

func TestGetUserBySession_InvalidSessionToken(t *testing.T) {
	db := testDB(t)
	svc := newSvc(t, db)

	// Cookie that decrypts fine but references a non-existent session token.
	c, rec := newCtx(t)
	if err := svc.SetSessionCookie(c, SessionPayload{SessionToken: uuid.NewString(), UserID: uuid.NewString()}); err != nil {
		t.Fatalf("SetSessionCookie: %v", err)
	}
	setCookie := rec.Header().Get("Set-Cookie")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Cookie", setCookie)
	c2 := e.NewContext(req, httptest.NewRecorder())

	user, token, err := svc.GetUserBySession(c2)
	if err != nil {
		t.Fatalf("GetUserBySession: %v", err)
	}
	if user != nil || token != "" {
		t.Errorf("expected nil user/empty token for missing session, got %v/%q", user, token)
	}
}

// NOTE: the "session valid but user row missing" branch of GetUserBySession
// (the gorm.ErrRecordNotFound user lookup) is guarded by the sessions→users
// foreign key, so an orphaned session can't be inserted to reach it without
// mutating shared schema. That single branch is left uncovered intentionally.

func TestStrPtr(t *testing.T) {
	if strPtr("") != nil {
		t.Error("strPtr(\"\") should be nil")
	}
	p := strPtr("hi")
	if p == nil || *p != "hi" {
		t.Errorf("strPtr(\"hi\") = %v, want pointer to \"hi\"", p)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
