package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_mw")
	if err := db.AutoMigrate(
		&models.User{},
		&models.Session{},
		&models.Library{},
		&models.LibraryMember{},
	); err != nil {
		t.Skipf("Skipping test: migrate failed: %v", err)
	}
	// NOTE: intentionally do NOT wipe tables here — this DB (alcoves_test) is
	// shared by the other DB-backed packages in this coverage pass, which may
	// run in parallel. Tests use UUID-unique emails/IDs so leftover rows from
	// concurrent packages are harmless.
	return db
}

// mkUser creates a user with a unique email so parallel test packages sharing
// the DB never collide on the users.email unique index. The `label` is only a
// human-readable hint; uniqueness comes from the UUID suffix.
func mkUser(t *testing.T, db *gorm.DB, label string) models.User {
	t.Helper()
	u := models.User{
		Email:       label + "+" + uuid.NewString() + "@test.com",
		DisplayName: "U",
		Role:        "member",
	}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func mkLibrary(t *testing.T, db *gorm.DB, ownerID uuid.UUID, isDefault bool) models.Library {
	t.Helper()
	lib := models.Library{Name: "Lib", OwnerID: ownerID, IsDefault: isDefault}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	return lib
}

// authedRequest builds a request carrying a valid session cookie for user.
func authedRequest(t *testing.T, svc *authservice.Service, user models.User, method, target string) *http.Request {
	t.Helper()
	// Create a session row + matching encrypted cookie.
	e := echo.New()
	setupReq := httptest.NewRequest(http.MethodGet, "/", nil)
	setupRec := httptest.NewRecorder()
	setupCtx := e.NewContext(setupReq, setupRec)

	token, err := svc.CreateSession(user.ID, setupCtx)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := svc.SetSessionCookie(setupCtx, authservice.SessionPayload{
		SessionToken: token,
		UserID:       user.ID.String(),
	}); err != nil {
		t.Fatalf("SetSessionCookie: %v", err)
	}
	setCookie := setupRec.Header().Get("Set-Cookie")

	req := httptest.NewRequest(method, target, nil)
	req.Header.Set("Cookie", setCookie)
	return req
}

func okHandler(c echo.Context) error {
	return c.String(http.StatusOK, "ok")
}

// ---- AuthMiddleware ----

func TestAuthMiddleware_PublicPathSkips(t *testing.T) {
	db := testDB(t)
	svc, _ := authservice.NewService(db, "middleware-test-secret-long-enough!!")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := AuthMiddleware(svc)(okHandler)
	if err := h(c); err != nil {
		t.Fatalf("handler error on public path: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for public path", rec.Code)
	}
}

func TestAuthMiddleware_NonApiPathSkips(t *testing.T) {
	db := testDB(t)
	svc, _ := authservice.NewService(db, "middleware-test-secret-long-enough!!")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/some/static/asset", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := AuthMiddleware(svc)(okHandler)(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestAuthMiddleware_NoCookieUnauthorized(t *testing.T) {
	db := testDB(t)
	svc, _ := authservice.NewService(db, "middleware-test-secret-long-enough!!")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/123", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := AuthMiddleware(svc)(okHandler)(c)
	if err == nil {
		t.Fatal("expected unauthorized error, got nil")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 HTTPError, got %v", err)
	}
}

func TestAuthMiddleware_ValidSessionPopulatesContext(t *testing.T) {
	db := testDB(t)
	svc, _ := authservice.NewService(db, "middleware-test-secret-long-enough!!")
	user := mkUser(t, db, "mw-auth@test.com")

	e := echo.New()
	req := authedRequest(t, svc, user, http.MethodGet, "/api/users")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	var gotUserID string
	var gotUser *models.User
	var gotToken string
	probe := func(c echo.Context) error {
		gotUserID, _ = c.Get(ContextKeyUserID).(string)
		gotUser, _ = c.Get(ContextKeyUser).(*models.User)
		gotToken, _ = c.Get(ContextKeySessionToken).(string)
		return c.String(http.StatusOK, "ok")
	}

	if err := AuthMiddleware(svc)(probe)(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if gotUserID != user.ID.String() {
		t.Errorf("context userID = %q, want %q", gotUserID, user.ID.String())
	}
	if gotUser == nil || gotUser.ID != user.ID {
		t.Errorf("context user = %v, want user %v", gotUser, user.ID)
	}
	if gotToken == "" {
		t.Error("context sessionToken should be set")
	}
}

func TestAuthMiddleware_InvalidSessionUnauthorized(t *testing.T) {
	db := testDB(t)
	svc, _ := authservice.NewService(db, "middleware-test-secret-long-enough!!")
	user := mkUser(t, db, "mw-invalid@test.com")

	// Build a valid cookie, then delete the session so GetUserBySession returns nil.
	e := echo.New()
	setupRec := httptest.NewRecorder()
	setupCtx := e.NewContext(httptest.NewRequest(http.MethodGet, "/", nil), setupRec)
	token, _ := svc.CreateSession(user.ID, setupCtx)
	_ = svc.SetSessionCookie(setupCtx, authservice.SessionPayload{SessionToken: token, UserID: user.ID.String()})
	setCookie := setupRec.Header().Get("Set-Cookie")
	_ = svc.DeleteSession(token) // invalidate

	req := httptest.NewRequest(http.MethodGet, "/api/users", nil)
	req.Header.Set("Cookie", setCookie)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := AuthMiddleware(svc)(okHandler)(c)
	if err == nil {
		t.Fatal("expected unauthorized for invalidated session")
	}
	if httpErr, ok := err.(*echo.HTTPError); !ok || httpErr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %v", err)
	}
}

// ---- LibraryAccessMiddleware ----

func setUserID(c echo.Context, id uuid.UUID) {
	c.Set(ContextKeyUserID, id.String())
}

func TestLibraryAccessMiddleware_NonLibraryPathPasses(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/users", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := LibraryAccessMiddleware(accessSvc)(okHandler)(c); err != nil {
		t.Fatalf("non-library path should pass: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestLibraryAccessMiddleware_MalformedPathPasses(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)

	e := echo.New()
	// /api/libraries (no id segment) -> passes through.
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := LibraryAccessMiddleware(accessSvc)(okHandler)(c); err != nil {
		t.Fatalf("malformed library path should pass: %v", err)
	}
}

func TestLibraryAccessMiddleware_InvalidUUIDBadRequest(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/not-a-uuid/files", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := LibraryAccessMiddleware(accessSvc)(okHandler)(c)
	if err == nil {
		t.Fatal("expected bad request for invalid library UUID")
	}
	if httpErr, ok := err.(*echo.HTTPError); !ok || httpErr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %v", err)
	}
}

func TestLibraryAccessMiddleware_NoUserUnauthorized(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)

	e := echo.New()
	libID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+libID.String()+"/files", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	// No user ID set in context.

	err := LibraryAccessMiddleware(accessSvc)(okHandler)(c)
	if err == nil {
		t.Fatal("expected unauthorized when no user in context")
	}
	if httpErr, ok := err.(*echo.HTTPError); !ok || httpErr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %v", err)
	}
}

func TestLibraryAccessMiddleware_OwnerReadAccess(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)
	owner := mkUser(t, db, "lib-owner@test.com")
	lib := mkLibrary(t, db, owner.ID, false)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String()+"/files", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserID(c, owner.ID)

	var gotAccess *access.LibraryAccess
	probe := func(c echo.Context) error {
		gotAccess = GetLibraryAccess(c)
		return c.String(http.StatusOK, "ok")
	}
	if err := LibraryAccessMiddleware(accessSvc)(probe)(c); err != nil {
		t.Fatalf("owner read access error: %v", err)
	}
	if gotAccess == nil || !gotAccess.IsOwner {
		t.Errorf("expected owner access in context, got %v", gotAccess)
	}
}

func TestLibraryAccessMiddleware_OwnerWriteAccess(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)
	owner := mkUser(t, db, "lib-writer@test.com")
	lib := mkLibrary(t, db, owner.ID, false)

	e := echo.New()
	// POST = write -> RequireLibraryAdmin path.
	req := httptest.NewRequest(http.MethodPost, "/api/libraries/"+lib.ID.String()+"/files", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserID(c, owner.ID)

	if err := LibraryAccessMiddleware(accessSvc)(okHandler)(c); err != nil {
		t.Fatalf("owner write access error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestLibraryAccessMiddleware_ViewerCannotWrite(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)
	owner := mkUser(t, db, "lib-owner2@test.com")
	viewer := mkUser(t, db, "lib-viewer@test.com")
	lib := mkLibrary(t, db, owner.ID, false)
	if err := db.Create(&models.LibraryMember{
		LibraryID: lib.ID, UserID: viewer.ID, Role: "viewer",
	}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/api/libraries/"+lib.ID.String()+"/files/x", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserID(c, viewer.ID)

	err := LibraryAccessMiddleware(accessSvc)(okHandler)(c)
	if err == nil {
		t.Fatal("expected forbidden for viewer write")
	}
	if httpErr, ok := err.(*echo.HTTPError); !ok || httpErr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %v", err)
	}
}

func TestLibraryAccessMiddleware_NoAccessNotFound(t *testing.T) {
	db := testDB(t)
	accessSvc := access.NewService(db)
	owner := mkUser(t, db, "lib-owner3@test.com")
	stranger := mkUser(t, db, "stranger@test.com")
	lib := mkLibrary(t, db, owner.ID, false)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String()+"/files", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserID(c, stranger.ID)

	err := LibraryAccessMiddleware(accessSvc)(okHandler)(c)
	if err == nil {
		t.Fatal("expected not found for stranger")
	}
	if httpErr, ok := err.(*echo.HTTPError); !ok || httpErr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %v", err)
	}
}

// TestNeedsAuth_AdditionalPaths covers the public-route branches not exercised
// by the existing TestNeedsAuth table (version, _meta, invites, share).
func TestNeedsAuth_AdditionalPaths(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/api/version", false},
		{"/api/_meta/registration", false},
		{"/api/invites/abc123", false},          // anon lookup allowed
		{"/api/invites/abc123/accept", true},    // accept still needs auth
		{"/api/share/tok/video", false},         // public share streaming
		{"/api/auth/google/callback/extra", false},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			if got := needsAuth(tc.path); got != tc.want {
				t.Errorf("needsAuth(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}
