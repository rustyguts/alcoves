package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
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
	handler := NewAuthHandler(db, authSvc, false)
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
