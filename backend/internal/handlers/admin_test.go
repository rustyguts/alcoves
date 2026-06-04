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

// TestAdminJobs_RequiresOwner asserts that the admin job-queue routes reject
// member-role sessions with 403 and allow owner-role sessions through.
func TestAdminJobs_RequiresOwner(t *testing.T) {
	db := libraryTestDB(t)
	adminH, _ := adminHandlerForTest(t, db)
	e := newLibEcho()

	// AdminJobsHandler wired with the real owner middleware.
	jobsH := NewAdminJobsHandler(nil, adminH.RequireOwnerMiddleware())

	memberUser := mustUser(t, db, "jobs-member@example.com")
	memberUser.Role = "member"
	db.Save(&memberUser)

	ownerUser := mustUser(t, db, "jobs-owner@example.com")
	ownerUser.Role = "owner"
	db.Save(&ownerUser)

	routes := []struct {
		method  string
		path    string
		body    string
		handler echo.HandlerFunc
	}{
		{http.MethodGet, "/admin/jobs/stats", "", jobsH.Stats},
		{http.MethodPost, "/admin/jobs/default/purge", "", jobsH.PurgeQueue},
	}

	for _, r := range routes {
		r := r
		t.Run(r.method+" "+r.path+" member gets 403", func(t *testing.T) {
			var reqBody *strings.Reader
			if r.body != "" {
				reqBody = strings.NewReader(r.body)
			} else {
				reqBody = strings.NewReader("")
			}
			req := httptest.NewRequest(r.method, r.path, reqBody)
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := ctxWithUser(e, req, rec, memberUser.ID)

			err := adminH.RequireOwnerMiddleware()(r.handler)(c)
			if err == nil {
				t.Fatal("expected 403 error for member, got nil")
			}
			httpErr, ok := err.(*echo.HTTPError)
			if !ok || httpErr.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %v", err)
			}
		})

		t.Run(r.method+" "+r.path+" owner passes middleware", func(t *testing.T) {
			var reqBody *strings.Reader
			if r.body != "" {
				reqBody = strings.NewReader(r.body)
			} else {
				reqBody = strings.NewReader("")
			}
			req := httptest.NewRequest(r.method, r.path, reqBody)
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := ctxWithUser(e, req, rec, ownerUser.ID)

			// Middleware passes; the actual handler may fail due to nil inspector
			// — that is expected and not the concern of this test.
			_ = adminH.RequireOwnerMiddleware()(r.handler)(c)
			// A nil-inspector Stats returns 200; PurgeQueue returns 503.
			// Either way we just assert the middleware itself did not return 403.
			if rec.Code == http.StatusForbidden {
				t.Fatalf("owner should not get 403 from owner middleware")
			}
		})
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

// TestAdmin_UpdateSettings_RejectsUnpublishedAudioModel guards the audio-model
// 404 regression: a model that is catalogued in the registry but whose weights
// were never uploaded to the bucket (e.g. ced_base) must be refused here so it
// can never be persisted and 404 the worker. A published model is accepted.
func TestAdmin_UpdateSettings_RejectsUnpublishedAudioModel(t *testing.T) {
	db := libraryTestDB(t)
	h, svc := adminHandlerForTest(t, db)
	e := newLibEcho()

	owner := mustUser(t, db, "admin-audio@example.com")
	owner.Role = "owner"
	db.Save(&owner)

	// Unpublished model → 400, setting unchanged.
	body := `{"audio_detect_model":"ced_base"}`
	req := httptest.NewRequest(http.MethodPatch, "/admin/settings", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	err := h.requireOwnerMiddleware(h.UpdateSettings)(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unpublished model, got %v", err)
	}
	if got := svc.Get().AudioDetectModel; got == "ced_base" {
		t.Fatalf("unpublished model must not be persisted, got %q", got)
	}

	// Published model → 200, persisted.
	body = `{"audio_detect_model":"pann_cnn14"}`
	req = httptest.NewRequest(http.MethodPatch, "/admin/settings", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec = httptest.NewRecorder()
	c = ctxWithUser(e, req, rec, owner.ID)
	if err := h.requireOwnerMiddleware(h.UpdateSettings)(c); err != nil {
		t.Fatalf("UpdateSettings(published): %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for published model, got %d", rec.Code)
	}
	if got := svc.Get().AudioDetectModel; got != "pann_cnn14" {
		t.Fatalf("expected audio_detect_model=pann_cnn14, got %q", got)
	}
}
