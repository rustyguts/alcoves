package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/services/access"
)

func TestGetLibraryAccess(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	// Test with no library access set
	la := GetLibraryAccess(c)
	if la != nil {
		t.Errorf("Expected nil, got %v", la)
	}

	// Test with library access set
	libraryID := uuid.New()
	ownerID := uuid.New()
	testAccess := &access.LibraryAccess{
		LibraryID:   libraryID,
		LibraryName: "Test Library",
		OwnerID:     ownerID,
		IsDefault:   true,
		Role:        access.RoleAdmin,
		IsOwner:     true,
		IsAdmin:     true,
	}
	c.Set(ContextKeyLibraryAccess, testAccess)
	la = GetLibraryAccess(c)
	if la == nil {
		t.Fatal("Expected library access, got nil")
	}
	if la.LibraryID != libraryID {
		t.Errorf("Expected LibraryID %v, got %v", libraryID, la.LibraryID)
	}
	if la.OwnerID != ownerID {
		t.Errorf("Expected OwnerID %v, got %v", ownerID, la.OwnerID)
	}
	if la.Role != access.RoleAdmin {
		t.Errorf("Expected Role 'admin', got %s", la.Role)
	}
	if !la.IsOwner {
		t.Error("Expected IsOwner to be true")
	}
	if !la.IsAdmin {
		t.Error("Expected IsAdmin to be true")
	}
	if !la.IsDefault {
		t.Error("Expected IsDefault to be true")
	}
	if la.LibraryName != "Test Library" {
		t.Errorf("Expected LibraryName 'Test Library', got %s", la.LibraryName)
	}
}

func TestReadMethods(t *testing.T) {
	// Verify read methods map contains expected methods
	if !readMethods["GET"] {
		t.Error("Expected GET to be a read method")
	}
	if !readMethods["HEAD"] {
		t.Error("Expected HEAD to be a read method")
	}
	if !readMethods["OPTIONS"] {
		t.Error("Expected OPTIONS to be a read method")
	}
	if readMethods["POST"] {
		t.Error("POST should not be a read method")
	}
	if readMethods["PUT"] {
		t.Error("PUT should not be a read method")
	}
	if readMethods["DELETE"] {
		t.Error("DELETE should not be a read method")
	}
	if readMethods["PATCH"] {
		t.Error("PATCH should not be a read method")
	}
}
