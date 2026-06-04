package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
)

func mkUserWithPassword(t *testing.T, db *gorm.DB, email, password string) models.User {
	t.Helper()
	hash, err := authservice.HashPassword(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	u := models.User{ID: uuid.New(), Email: email, DisplayName: "U", Role: "member", PasswordHash: &hash}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func authPost(e *echo.Echo, target, body string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	return e.NewContext(req, rec), rec
}

func TestAuth_Providers(t *testing.T) {
	db := testDB(t)
	e, _ := setupTestEcho(db)
	authSvc, _ := authservice.NewService(db, "test-secret-key-at-least-32-chars-long")
	h := NewAuthHandler(db, authSvc, nil, true, nil)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := h.Providers(c); err != nil {
		t.Fatalf("Providers: %v", err)
	}
	if !strings.Contains(rec.Body.String(), `"google":true`) {
		t.Fatalf("expected google true, got %s", rec.Body.String())
	}
}

func TestAuth_Login_Success(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	mkUserWithPassword(t, db, "login@example.com", "password123")
	c, rec := authPost(e, "/api/auth/login", `{"email":"login@example.com","password":"password123"}`)
	if err := h.Login(c); err != nil {
		t.Fatalf("Login: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var found bool
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == authservice.SessionCookie {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected session cookie")
	}
}

func TestAuth_Login_WrongPassword(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	mkUserWithPassword(t, db, "wp@example.com", "password123")
	c, _ := authPost(e, "/api/auth/login", `{"email":"wp@example.com","password":"wrong-pass"}`)
	if httpCode(t, h.Login(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestAuth_Login_UnknownEmail(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	c, _ := authPost(e, "/api/auth/login", `{"email":"nobody@example.com","password":"password123"}`)
	if httpCode(t, h.Login(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestAuth_Login_Validation(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	c, _ := authPost(e, "/api/auth/login", `{"email":"not-an-email","password":""}`)
	if h.Login(c) == nil {
		t.Fatalf("expected validation error")
	}
}

func TestAuth_Me(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "me@example.com", "password123")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	if err := h.Me(c); err != nil {
		t.Fatalf("Me: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAuth_Me_NotFound(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, uuid.New().String())
	if httpCode(t, h.Me(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestAuth_Me_Unauthorized(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if httpCode(t, h.Me(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestAuth_UpdateMe(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "upd@example.com", "password123")
	c, rec := authPost(e, "/", `{"displayName":"New Name","email":"NEW@Example.com"}`)
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	if err := h.UpdateMe(c); err != nil {
		t.Fatalf("UpdateMe: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var got models.User
	db.First(&got, "id = ?", u.ID)
	if got.DisplayName != "New Name" || got.Email != "new@example.com" {
		t.Fatalf("not updated/normalized: %+v", got)
	}
}

func TestAuth_UpdateMe_NoFields(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "upd2@example.com", "password123")
	c, _ := authPost(e, "/", `{}`)
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	if httpCode(t, h.UpdateMe(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func mkSession(t *testing.T, db *gorm.DB, userID uuid.UUID, token string) models.Session {
	t.Helper()
	s := models.Session{ID: uuid.New(), UserID: userID, SessionToken: token, ExpiresAt: time.Now().Add(24 * time.Hour)}
	if err := db.Create(&s).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	return s
}

func TestAuth_ListSessions(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "ls@example.com", "password123")
	mkSession(t, db, u.ID, "tok-current")
	mkSession(t, db, u.ID, "tok-other")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	c.Set(middleware.ContextKeySessionToken, "tok-current")
	if err := h.ListSessions(c); err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	if !strings.Contains(rec.Body.String(), `"isCurrent":true`) {
		t.Fatalf("expected a current session flagged")
	}
}

func TestAuth_RevokeSession_Other(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "rs@example.com", "password123")
	other := mkSession(t, db, u.ID, "tok-revoke")
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(other.ID.String())
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	c.Set(middleware.ContextKeySessionToken, "tok-current")
	if err := h.RevokeSession(c); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAuth_RevokeSession_Current(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "rsc@example.com", "password123")
	cur := mkSession(t, db, u.ID, "tok-current")
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(cur.ID.String())
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	c.Set(middleware.ContextKeySessionToken, "tok-current")
	if httpCode(t, h.RevokeSession(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (cannot revoke current)")
	}
}

func TestAuth_RevokeSession_NotFound(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "rsnf@example.com", "password123")
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	if httpCode(t, h.RevokeSession(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestAuth_RevokeSession_InvalidID(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	u := mkUserWithPassword(t, db, "rsbad@example.com", "password123")
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	c.Set(middleware.ContextKeyUserID, u.ID.String())
	if httpCode(t, h.RevokeSession(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestAuth_Logout_NoCookie(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := h.Logout(c); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAuth_Session_Unauthenticated(t *testing.T) {
	db := testDB(t)
	e, h := setupTestEcho(db)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := h.Session(c); err != nil {
		t.Fatalf("Session: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	if strings.Contains(rec.Body.String(), `"user"`) {
		t.Fatalf("expected empty object, got %s", rec.Body.String())
	}
}

func TestAuth_NormalizeEmail(t *testing.T) {
	if normalizeEmail("  Foo@Bar.COM ") != "foo@bar.com" {
		t.Fatalf("normalize failed")
	}
}
