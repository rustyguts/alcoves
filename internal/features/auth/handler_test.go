package auth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gorilla/sessions"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) {
	testDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to connect to test database: %v", err)
	}

	db.DBConn = testDB

	err = testDB.AutoMigrate(&models.User{})
	if err != nil {
		t.Fatalf("Failed to migrate test database: %v", err)
	}
}

type MockRenderer struct{}

func (m *MockRenderer) Render(w io.Writer, name string, data any, c echo.Context) error {
	return nil
}

func setupEcho() *echo.Echo {
	e := echo.New()
	e.Renderer = &MockRenderer{}
	e.Use(session.Middleware(sessions.NewCookieStore([]byte("test-secret-key"))))
	return e
}

func TestPostRegister_Success(t *testing.T) {
	setupTestDB(t)
	e := setupEcho()

	form := url.Values{}
	form.Add("email", "test@example.com")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := session.Middleware(sessions.NewCookieStore([]byte("test-secret-key")))(echo.HandlerFunc(PostRegister))
	err := h(c)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusFound, rec.Code)
	assert.Equal(t, "/", rec.Header().Get("Location"))

	var user models.User
	db.DBConn.Where("email = ?", "test@example.com").First(&user)
	assert.NotEqual(t, uint(0), user.ID)
	assert.Equal(t, "test@example.com", user.Email)
	assert.NotEmpty(t, user.Password)
	assert.True(t, VerifyPassword("password123", user.Password))
}

func TestPostRegister_InvalidEmail(t *testing.T) {
	setupTestDB(t)
	e := setupEcho()

	form := url.Values{}
	form.Add("email", "invalid-email")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostRegister(c)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var userCount int64
	db.DBConn.Model(&models.User{}).Count(&userCount)
	assert.Equal(t, int64(0), userCount)
}

func TestPostRegister_ShortPassword(t *testing.T) {
	setupTestDB(t)
	e := setupEcho()

	form := url.Values{}
	form.Add("email", "test@example.com")
	form.Add("password", "short")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostRegister(c)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var userCount int64
	db.DBConn.Model(&models.User{}).Count(&userCount)
	assert.Equal(t, int64(0), userCount)
}

func TestPostRegister_DuplicateEmail(t *testing.T) {
	setupTestDB(t)
	e := setupEcho()

	existingUser := models.User{
		Email:    "test@example.com",
		Password: "hashedpassword",
	}
	db.DBConn.Create(&existingUser)

	form := url.Values{}
	form.Add("email", "test@example.com")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostRegister(c)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "Failed to create user")

	var userCount int64
	db.DBConn.Model(&models.User{}).Count(&userCount)
	assert.Equal(t, int64(1), userCount)
}