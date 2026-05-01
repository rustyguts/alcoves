package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
)

func TestMemberHandler_RemoveMember_RejectsSelf(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "self-remove@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodDelete,
		"/api/libraries/"+lib.ID.String()+"/users/"+owner.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "memberUserId")
	c.SetParamValues(lib.ID.String(), owner.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	err := h.RemoveMember(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 self-removal, got %v", err)
	}
}

func TestMemberHandler_RemoveMember_404OnMissing(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "rm-missing@example.com")
	other := mustUser(t, db, "rm-other@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodDelete,
		"/api/libraries/"+lib.ID.String()+"/users/"+other.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "memberUserId")
	c.SetParamValues(lib.ID.String(), other.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	err := h.RemoveMember(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", err)
	}
}

func TestMemberHandler_UpdateMemberRole_ValidatesRole(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "role-bad@example.com")
	other := mustUser(t, db, "role-target@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodPatch,
		"/api/libraries/"+lib.ID.String()+"/users/"+other.ID.String(),
		strings.NewReader(`{"role":"superuser"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "memberUserId")
	c.SetParamValues(lib.ID.String(), other.ID.String())

	if err := h.UpdateMemberRole(c); err == nil {
		t.Fatal("expected validation error for role=superuser")
	}
}

func TestMemberHandler_UpdateMemberRole_404WhenNoMember(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "role-noop@example.com")
	other := mustUser(t, db, "role-target2@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodPatch,
		"/api/libraries/"+lib.ID.String()+"/users/"+other.ID.String(),
		strings.NewReader(`{"role":"admin"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "memberUserId")
	c.SetParamValues(lib.ID.String(), other.ID.String())

	err := h.UpdateMemberRole(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", err)
	}
}

func TestMemberHandler_UpdateMemberRole_Updates(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "role-ok-owner@example.com")
	other := mustUser(t, db, "role-ok-target@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	if err := db.Create(&models.LibraryMember{
		LibraryID: lib.ID, UserID: other.ID, Role: "viewer",
	}).Error; err != nil {
		t.Fatalf("seed member: %v", err)
	}
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodPatch,
		"/api/libraries/"+lib.ID.String()+"/users/"+other.ID.String(),
		strings.NewReader(`{"role":"admin"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "memberUserId")
	c.SetParamValues(lib.ID.String(), other.ID.String())

	if err := h.UpdateMemberRole(c); err != nil {
		t.Fatalf("UpdateMemberRole: %v", err)
	}
	var lm models.LibraryMember
	if err := db.Where("library_id = ? AND user_id = ?", lib.ID, other.ID).First(&lm).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if lm.Role != "admin" {
		t.Fatalf("expected role=admin, got %q", lm.Role)
	}
}

func TestMemberHandler_CreateInviteLink_PersistsRow(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "inv-ok@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodPost,
		"/api/libraries/"+lib.ID.String()+"/users/invite-link",
		strings.NewReader(`{"maxUses":5}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	if err := h.CreateInviteLink(c); err != nil {
		t.Fatalf("CreateInviteLink: %v", err)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["token"].(string) == "" {
		t.Fatal("expected non-empty token")
	}
	var inv models.LibraryInvite
	if err := db.Where("library_id = ?", lib.ID).First(&inv).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if inv.MaxUses == nil || *inv.MaxUses != 5 {
		t.Fatalf("expected maxUses=5, got %v", inv.MaxUses)
	}
}

func TestMemberHandler_CreateInviteLink_RejectsBadMaxUses(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "inv-bad-max@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodPost,
		"/api/libraries/"+lib.ID.String()+"/users/invite-link",
		strings.NewReader(`{"maxUses":0}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	if err := h.CreateInviteLink(c); err == nil {
		t.Fatal("expected validation error for maxUses=0")
	}
}

func TestMemberHandler_CreateInviteLink_ExpiresAtPersists(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "inv-exp@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	future := time.Now().Add(48 * time.Hour).Format(time.RFC3339Nano)
	body := `{"expiresAt":"` + future + `"}`

	req := httptest.NewRequest(http.MethodPost,
		"/api/libraries/"+lib.ID.String()+"/users/invite-link",
		strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	if err := h.CreateInviteLink(c); err != nil {
		t.Fatalf("CreateInviteLink: %v", err)
	}
	var inv models.LibraryInvite
	if err := db.Where("library_id = ?", lib.ID).First(&inv).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if inv.ExpiresAt == nil {
		t.Fatal("expected expires_at to persist")
	}
}

func TestMemberHandler_CreateInviteLink_RejectsPastExpires(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "inv-past@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	past := time.Now().Add(-time.Hour).Format(time.RFC3339Nano)
	body := `{"expiresAt":"` + past + `"}`

	req := httptest.NewRequest(http.MethodPost,
		"/api/libraries/"+lib.ID.String()+"/users/invite-link",
		strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())

	err := h.CreateInviteLink(c)
	if err == nil {
		t.Fatal("expected validation error for past expiresAt")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %v", err)
	}
}

func TestMemberHandler_RevokeInvite_404OnMissing(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "rev-miss@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db))

	req := httptest.NewRequest(http.MethodDelete,
		"/api/libraries/"+lib.ID.String()+"/users/invites/00000000-0000-0000-0000-000000000000", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "inviteId")
	c.SetParamValues(lib.ID.String(), "00000000-0000-0000-0000-000000000000")

	err := h.RevokeInvite(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", err)
	}
}
