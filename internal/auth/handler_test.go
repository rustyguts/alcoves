package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	testutil "github.com/rustyguts/alcoves/internal/testing"
	"github.com/stretchr/testify/assert"
)

func TestPostRegister_Success(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	form := url.Values{}
	form.Add("email", "test@example.com")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostRegister(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusFound, rec.Code)
	assert.Equal(t, "/", rec.Header().Get("Location"))

	var user models.User
	db.Connection.Where("email = ?", "test@example.com").First(&user)
	assert.NotEqual(t, uint(0), user.ID)
	assert.Equal(t, "test@example.com", user.Email)
	assert.NotEmpty(t, user.Password)
	assert.True(t, VerifyPassword("password123", user.Password))

	// Verify personal library was created
	var library models.Library
	db.Connection.Where("owner_id = ? AND is_personal = ?", user.ID, true).First(&library)
	assert.NotEqual(t, uint(0), library.ID)
	assert.Equal(t, user.ID, library.OwnerID)
	assert.True(t, library.IsPersonal)
	assert.Equal(t, "My Library", library.Name)
}

func TestPostRegister_InvalidEmail(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

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
}

func TestPostRegister_ShortPassword(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

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
}

func TestPostRegister_DuplicateEmail(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	// Create an existing user
	existingUser := models.User{
		Email:    "existing@example.com",
		Password: "hashedpassword",
	}
	db.Connection.Create(&existingUser)

	form := url.Values{}
	form.Add("email", "existing@example.com")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostRegister(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusConflict, rec.Code)
	assert.Contains(t, rec.Body.String(), "User already exists")
}

func TestPostLogin_Success(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	// Create a user to login with
	hashedPassword, _ := HashPassword("password123")
	user := models.User{
		Email:    "login@example.com",
		Password: hashedPassword,
	}
	db.Connection.Create(&user)

	form := url.Values{}
	form.Add("email", "login@example.com")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostLogin(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusFound, rec.Code)
	assert.Equal(t, "/", rec.Header().Get("Location"))
}

func TestPostLogin_InvalidEmail(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	form := url.Values{}
	form.Add("email", "invalid-email")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostLogin(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid email format")
}

func TestPostLogin_UserNotFound(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	form := url.Values{}
	form.Add("email", "nonexistent@example.com")
	form.Add("password", "password123")

	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostLogin(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestPostLogin_WrongPassword(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	// Create a user with a known password
	hashedPassword, _ := HashPassword("correctpassword")
	user := models.User{
		Email:    "wrongpass@example.com",
		Password: hashedPassword,
	}
	db.Connection.Create(&user)

	form := url.Values{}
	form.Add("email", "wrongpass@example.com")
	form.Add("password", "wrongpassword")

	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostLogin(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid credentials")
}

func TestGetLogin(t *testing.T) {
	e := testutil.SetupTestEcho()

	req := httptest.NewRequest(http.MethodGet, "/login", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := GetLogin(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetRegister(t *testing.T) {
	e := testutil.SetupTestEcho()

	req := httptest.NewRequest(http.MethodGet, "/register", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := GetRegister(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestPostLogout(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	// Create a user and session first
	hashedPassword, _ := HashPassword("password123")
	user := models.User{
		Email:    "logout@example.com",
		Password: hashedPassword,
	}
	db.Connection.Create(&user)

	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	// Create a session for the user
	_, err := CreateSession(c, user.ID)
	assert.NoError(t, err)

	// Now test logout
	err = PostLogout(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusFound, rec.Code)
	assert.Equal(t, "/login", rec.Header().Get("Location"))
}

func TestPostLogout_NoSession(t *testing.T) {
	e := testutil.SetupTestEcho()

	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	// Test logout without a session - should still redirect to login
	err := PostLogout(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusFound, rec.Code)
	assert.Equal(t, "/login", rec.Header().Get("Location"))
}

func TestValidEmail(t *testing.T) {
	tests := []struct {
		email string
		valid bool
	}{
		{"test@example.com", true},
		{"user.name@domain.org", true},
		{"invalid-email", false},
		{"@domain.com", false},
		{"user@", false},
		{"", false},
		{"user name@example.com", false},
	}

	for _, test := range tests {
		t.Run(test.email, func(t *testing.T) {
			result := valid(test.email)
			assert.Equal(t, test.valid, result)
		})
	}
}

func TestPostRegister_EmptyFields(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	form := url.Values{}
	form.Add("email", "")
	form.Add("password", "")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostRegister(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestPostRegister_MultipleValidationErrors(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	form := url.Values{}
	form.Add("email", "invalid-email")
	form.Add("password", "short")

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostRegister(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestPostLogin_EmptyFields(t *testing.T) {
	testutil.SetupTestDatabase(t)
	e := testutil.SetupTestEcho()

	form := url.Values{}
	form.Add("email", "")
	form.Add("password", "")

	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := PostLogin(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}
