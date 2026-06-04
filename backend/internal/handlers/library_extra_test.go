package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
)

func TestLibraryHandler_List(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "list-owner@example.com")
	other := mustUser(t, db, "list-other@example.com")
	owned := mustLibrary(t, db, owner.ID, "Owned", false)
	_ = owned
	// a library owned by other, where our user is a member
	otherLib := mustLibrary(t, db, other.ID, "Shared", false)
	db.Create(&models.LibraryMember{ID: uuid.New(), LibraryID: otherLib.ID, UserID: owner.ID, Role: "admin"})

	h := NewLibraryHandler(db, access.NewService(db), nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/libraries", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	if err := h.List(c); err != nil {
		t.Fatalf("List: %v", err)
	}
	var resp []libraryResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 { // owned + shared
		t.Fatalf("expected 2 libraries, got %d", len(resp))
	}
}

func TestLibraryHandler_List_RequiresAuth(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/libraries", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if httpCode(t, h.List(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestLibraryHandler_Get_Success(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "get-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: lib.ID, OwnerID: owner.ID, Role: access.RoleOwner, IsOwner: true, IsAdmin: true})
	if err := h.Get(c); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestLibraryHandler_Get_InvalidID(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("bad")
	c.Set(middleware.ContextKeyUserID, uuid.New().String())
	if httpCode(t, h.Get(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestLibraryHandler_Update(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "upd-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "Old", false)
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	body := `{"name":"New","emoji":"📁","faceRecognitionEnabled":true,"objectDetectionEnabled":true,"sharingEnabled":true}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: lib.ID, OwnerID: owner.ID, Role: access.RoleOwner, IsOwner: true, IsAdmin: true})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var got models.Library
	db.First(&got, "id = ?", lib.ID)
	if got.Name != "New" || !got.FaceRecognitionEnabled {
		t.Fatalf("update failed: %+v", got)
	}
}

func TestLibraryHandler_Update_NoFields(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "upd2-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: lib.ID, OwnerID: owner.ID, IsOwner: true})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}
