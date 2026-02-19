package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestNeedsAuth(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/", false},
		{"/health", false},
		{"/api/auth/login", false},
		{"/api/auth/register", false},
		{"/api/auth/logout", false},
		{"/api/auth/providers", false},
		{"/api/auth/google", false},
		{"/api/auth/google/callback", false},
		{"/api/auth/me", true},
		{"/api/auth/sessions", true},
		{"/api/_auth/session", false},
		{"/api/files/proxy/abc", false},
		{"/api/libraries/123", true},
		{"/api/users", true},
		{"/api/admin", true},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			result := needsAuth(tt.path)
			if result != tt.expected {
				t.Errorf("needsAuth(%s) = %v, want %v", tt.path, result, tt.expected)
			}
		})
	}
}

func TestGetUserID(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	// Test with no user ID set
	id := GetUserID(c)
	if id != uuid.Nil {
		t.Errorf("Expected uuid.Nil, got %v", id)
	}

	// Test with valid user ID
	testID := uuid.New()
	c.Set(ContextKeyUserID, testID.String())
	id = GetUserID(c)
	if id != testID {
		t.Errorf("Expected %v, got %v", testID, id)
	}

	// Test with invalid string
	c.Set(ContextKeyUserID, "not-a-uuid")
	id = GetUserID(c)
	if id != uuid.Nil {
		t.Errorf("Expected uuid.Nil for invalid UUID, got %v", id)
	}

	// Test with wrong type
	c.Set(ContextKeyUserID, 12345)
	id = GetUserID(c)
	if id != uuid.Nil {
		t.Errorf("Expected uuid.Nil for wrong type, got %v", id)
	}
}

func TestRequireUserID(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	// Test with no user ID (should error)
	id, err := RequireUserID(c)
	if err == nil {
		t.Error("Expected error when no user ID, got nil")
	}
	if id != uuid.Nil {
		t.Errorf("Expected uuid.Nil, got %v", id)
	}

	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, httpErr.Code)
	}

	// Test with valid user ID
	testID := uuid.New()
	c.Set(ContextKeyUserID, testID.String())
	id, err = RequireUserID(c)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if id != testID {
		t.Errorf("Expected %v, got %v", testID, id)
	}
}
