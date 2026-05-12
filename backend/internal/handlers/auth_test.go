package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
)

// testDB creates a test database connection. Skips if DB is unavailable.
func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}

	// Auto-migrate test tables
	err = db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.Account{},
		&models.Session{},
	)
	if err != nil {
		t.Fatalf("Failed to migrate: %v", err)
	}

	// Clean tables before each test. CASCADE drops rows in any dependent
	// tables that other test files migrated (library_members, files, etc.).
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	return db
}

func setupTestEcho(db *gorm.DB) (*echo.Echo, *AuthHandler) {
	e := echo.New()
	e.Validator = NewValidator()

	authSvc, _ := authservice.NewService(db, "test-secret-key-at-least-32-chars-long")
	settingsSvc, _ := settings.NewService(db)
	handler := NewAuthHandler(db, authSvc, settingsSvc, false, nil)
	return e, handler
}

func TestRegisterHandler(t *testing.T) {
	db := testDB(t)
	e, handler := setupTestEcho(db)

	body := `{"name":"Test User","email":"test@example.com","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := handler.Register(c); err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	var resp userResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)

	if resp.Email != "test@example.com" {
		t.Errorf("Expected email test@example.com, got %s", resp.Email)
	}
	if resp.DisplayName != "Test User" {
		t.Errorf("Expected displayName 'Test User', got %s", resp.DisplayName)
	}
	// First user should be owner
	if resp.Role != "owner" {
		t.Errorf("Expected role 'owner' for first user, got %s", resp.Role)
	}

	// Should have set a session cookie
	cookies := rec.Result().Cookies()
	found := false
	for _, cookie := range cookies {
		if cookie.Name == authservice.SessionCookie {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected session cookie to be set")
	}

	// Verify default library was created
	var lib models.Library
	if err := db.Where("owner_id = ? AND is_default = true", resp.ID).First(&lib).Error; err != nil {
		t.Error("Expected default library to be created")
	}
}

func TestRegisterDuplicate(t *testing.T) {
	db := testDB(t)
	e, handler := setupTestEcho(db)

	body := `{"name":"Test User","email":"dup@example.com","password":"password123"}`

	// First registration
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	handler.Register(c)

	// Second registration with same email
	req = httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)

	err := handler.Register(c)
	if err == nil {
		t.Fatal("Expected error for duplicate email")
	}

	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusConflict {
		t.Errorf("Expected 409 Conflict, got %v", err)
	}
}

func TestLoginHandler(t *testing.T) {
	db := testDB(t)
	e, handler := setupTestEcho(db)

	// Register first
	regBody := `{"name":"Login Test","email":"login@example.com","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(regBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	handler.Register(e.NewContext(req, rec))

	// Login
	loginBody := `{"email":"login@example.com","password":"password123"}`
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(loginBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec = httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := handler.Login(c); err != nil {
		t.Fatalf("Login failed: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	var resp userResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Email != "login@example.com" {
		t.Errorf("Expected email login@example.com, got %s", resp.Email)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	db := testDB(t)
	e, handler := setupTestEcho(db)

	// Register
	regBody := `{"name":"Test","email":"wrong@example.com","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(regBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	handler.Register(e.NewContext(req, httptest.NewRecorder()))

	// Login with wrong password
	loginBody := `{"email":"wrong@example.com","password":"wrongpassword"}`
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(loginBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	err := handler.Login(e.NewContext(req, rec))
	if err == nil {
		t.Fatal("Expected error for wrong password")
	}

	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 Unauthorized, got %v", err)
	}
}

// setMode rewrites the cached registration mode by directly updating the
// app_settings row, then forcing a service reload via re-instantiation.
// Returns a freshly-built handler bound to the new service so subsequent
// Register() calls see the new mode.
func setMode(t *testing.T, db *gorm.DB, mode string) (*echo.Echo, *AuthHandler) {
	t.Helper()
	if err := db.AutoMigrate(&models.AppSettings{}); err != nil {
		t.Fatalf("auto-migrate app_settings: %v", err)
	}
	if err := db.Exec("DELETE FROM app_settings").Error; err != nil {
		t.Fatalf("reset app_settings: %v", err)
	}
	settingsSvc, err := settings.NewService(db)
	if err != nil {
		t.Fatalf("settings.NewService: %v", err)
	}
	if _, err := settingsSvc.Update(settings.Settings{RegistrationMode: mode}, nil); err != nil {
		t.Fatalf("settings.Update: %v", err)
	}

	e := echo.New()
	e.Validator = NewValidator()
	authSvc, _ := authservice.NewService(db, "test-secret-key-at-least-32-chars-long")
	handler := NewAuthHandler(db, authSvc, settingsSvc, false, nil)
	return e, handler
}

// preExistingUser inserts a user so the bootstrap branch (zero users) is
// skipped on the next Register() call.
func preExistingUser(t *testing.T, db *gorm.DB, email string) {
	t.Helper()
	u := models.User{Email: email, DisplayName: email, Role: "owner"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func TestRegister_OpenMode_AllowsAnyone(t *testing.T) {
	db := testDB(t)
	preExistingUser(t, db, "first@example.com")
	e, handler := setMode(t, db, settings.RegistrationOpen)

	body := `{"name":"Two","email":"second@example.com","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	if err := handler.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("register: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestRegister_ClosedMode_Rejects(t *testing.T) {
	db := testDB(t)
	preExistingUser(t, db, "boot@example.com")
	e, handler := setMode(t, db, settings.RegistrationClosed)

	body := `{"name":"Blocked","email":"blocked@example.com","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	err := handler.Register(e.NewContext(req, rec))
	if err == nil {
		t.Fatal("expected forbidden error")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %v", err)
	}

	// User row was NOT created.
	var count int64
	db.Model(&models.User{}).Where("email = ?", "blocked@example.com").Count(&count)
	if count != 0 {
		t.Fatalf("expected no user row, got %d", count)
	}
}

func TestRegister_BootstrapBypassesMode(t *testing.T) {
	db := testDB(t)
	e, handler := setMode(t, db, settings.RegistrationClosed)

	body := `{"name":"First","email":"bootstrap@example.com","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	if err := handler.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("first register should succeed: %v", err)
	}

	var resp userResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Role != "owner" {
		t.Fatalf("expected role=owner for bootstrap, got %q", resp.Role)
	}
}

func TestRegister_InviteOnlyMode_RequiresToken(t *testing.T) {
	db := testDB(t)
	preExistingUser(t, db, "owner-io@example.com")
	e, handler := setMode(t, db, settings.RegistrationInviteOnly)

	body := `{"name":"NoToken","email":"notoken@example.com","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	err := handler.Register(e.NewContext(req, rec))
	if err == nil {
		t.Fatal("expected forbidden")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %v", err)
	}
}

func TestRegister_InviteOnlyMode_AcceptsValidToken(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(
		&models.Library{}, &models.LibraryMember{},
		&models.LibraryInvite{}, &models.LibraryInviteUse{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	owner := mustUser(t, db, "owner-io2@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)

	token := "test-invite-token-" + owner.ID.String()
	if err := db.Create(&models.LibraryInvite{
		LibraryID:       lib.ID,
		InvitedByUserID: owner.ID,
		Token:           token,
	}).Error; err != nil {
		t.Fatalf("create invite: %v", err)
	}

	e, handler := setMode(t, db, settings.RegistrationInviteOnly)

	body := `{"name":"Joiner","email":"joiner@example.com","password":"password123","inviteToken":"` + token + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	if err := handler.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("register with token: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var newUser models.User
	if err := db.Where("email = ?", "joiner@example.com").First(&newUser).Error; err != nil {
		t.Fatalf("user not created: %v", err)
	}

	// Membership row exists.
	var memberCount int64
	db.Model(&models.LibraryMember{}).
		Where("library_id = ? AND user_id = ?", lib.ID, newUser.ID).
		Count(&memberCount)
	if memberCount != 1 {
		t.Fatalf("expected 1 membership, got %d", memberCount)
	}

	// Usage row exists.
	var useCount int64
	db.Model(&models.LibraryInviteUse{}).
		Where("user_id = ?", newUser.ID).
		Count(&useCount)
	if useCount != 1 {
		t.Fatalf("expected 1 invite use, got %d", useCount)
	}
}

func TestRegister_RejectsRevokedInvite(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(
		&models.Library{}, &models.LibraryMember{},
		&models.LibraryInvite{}, &models.LibraryInviteUse{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	owner := mustUser(t, db, "owner-rev@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)

	now := time.Now()
	token := "revoked-" + owner.ID.String()
	if err := db.Create(&models.LibraryInvite{
		LibraryID:       lib.ID,
		InvitedByUserID: owner.ID,
		Token:           token,
		RevokedAt:       &now,
	}).Error; err != nil {
		t.Fatalf("create invite: %v", err)
	}

	e, handler := setMode(t, db, settings.RegistrationInviteOnly)

	body := `{"name":"Late","email":"late@example.com","password":"password123","inviteToken":"` + token + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	err := handler.Register(e.NewContext(req, rec))
	if err == nil {
		t.Fatal("expected error for revoked invite")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %v", err)
	}
}

func TestRegisterValidation(t *testing.T) {
	db := testDB(t)
	e, handler := setupTestEcho(db)

	tests := []struct {
		name string
		body string
	}{
		{"missing name", `{"email":"test@example.com","password":"password123"}`},
		{"missing email", `{"name":"Test","password":"password123"}`},
		{"short password", `{"name":"Test","email":"test@example.com","password":"short"}`},
		{"invalid email", `{"name":"Test","email":"notanemail","password":"password123"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(tt.body))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			err := handler.Register(c)
			if err == nil {
				t.Error("Expected validation error")
			}
		})
	}
}
