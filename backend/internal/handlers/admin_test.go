package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
)

// adminHandlerForTest builds an AdminHandler with a settings service and
// returns both. Tests share the same DB the auth/library suites use.
func adminHandlerForTest(t *testing.T, db *gorm.DB) (*AdminHandler, *settings.Service) {
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
	return NewAdminHandler(db, nil, settingsSvc), settingsSvc
}

func TestAdmin_GetSettings_RequiresOwner(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()

	memberUser := mustUser(t, db, "non-owner@example.com")
	memberUser.Role = "member"
	db.Save(&memberUser)

	req := httptest.NewRequest(http.MethodGet, "/admin/settings", nil)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, memberUser.ID)

	err := h.requireOwnerMiddleware(h.GetSettings)(c)
	if err == nil {
		t.Fatal("expected forbidden error for non-owner")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %v", err)
	}
}

func TestAdmin_UpdateSettings_PersistsAndReloads(t *testing.T) {
	db := libraryTestDB(t)
	h, svc := adminHandlerForTest(t, db)
	e := newLibEcho()

	owner := mustUser(t, db, "admin-owner@example.com")
	owner.Role = "owner"
	db.Save(&owner)

	body := `{"registration_mode":"closed"}`
	req := httptest.NewRequest(http.MethodPatch, "/admin/settings", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)

	chain := h.requireOwnerMiddleware(h.UpdateSettings)
	if err := chain(c); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	if got := svc.Get().RegistrationMode; got != settings.RegistrationClosed {
		t.Fatalf("expected mode=closed, got %q", got)
	}

	// GET returns the new mode.
	getReq := httptest.NewRequest(http.MethodGet, "/admin/settings", nil)
	getRec := httptest.NewRecorder()
	getCtx := ctxWithUser(e, getReq, getRec, owner.ID)
	if err := h.requireOwnerMiddleware(h.GetSettings)(getCtx); err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	var resp settings.Settings
	if err := json.Unmarshal(getRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.RegistrationMode != settings.RegistrationClosed {
		t.Fatalf("GET returned %q", resp.RegistrationMode)
	}
}

func TestAdmin_UpdateSettings_ValidatesMode(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()

	owner := mustUser(t, db, "admin-bad@example.com")
	owner.Role = "owner"
	db.Save(&owner)

	body := `{"registration_mode":"banana"}`
	req := httptest.NewRequest(http.MethodPatch, "/admin/settings", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)

	err := h.requireOwnerMiddleware(h.UpdateSettings)(c)
	if err == nil {
		t.Fatal("expected validation error")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %v", err)
	}
}
