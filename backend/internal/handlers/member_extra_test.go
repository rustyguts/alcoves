package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

func TestMember_ListUsers(t *testing.T) {
	db := libraryTestDB(t)
	if err := db.AutoMigrate(&models.LibraryInviteUse{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	e := newLibEcho()
	owner := mustUser(t, db, "lu-owner@example.com")
	member := mustUser(t, db, "lu-member@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	db.Create(&models.LibraryMember{ID: uuid.New(), LibraryID: lib.ID, UserID: member.ID, Role: "viewer"})
	// an invite created by the owner, with one use by member
	inv := models.LibraryInvite{ID: uuid.New(), LibraryID: lib.ID, InvitedByUserID: owner.ID, Token: uuid.New().String()}
	db.Create(&inv)
	db.Create(&models.LibraryInviteUse{ID: uuid.New(), InviteID: inv.ID, UserID: member.ID, UsedAt: time.Now()})

	h := NewMemberHandler(db, access.NewService(db), nil)
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String()+"/users", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: lib.ID, OwnerID: owner.ID, IsOwner: true, IsAdmin: true, IsDefault: false})

	if err := h.ListUsers(c); err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["canManageUsers"] != true {
		t.Fatalf("expected canManageUsers true")
	}
	members, _ := resp["members"].([]any)
	if len(members) != 2 { // owner + 1 member
		t.Fatalf("expected 2 members, got %d", len(members))
	}
	links, _ := resp["inviteLinks"].([]any)
	if len(links) != 1 {
		t.Fatalf("expected 1 invite link, got %d", len(links))
	}
}

func TestMember_ListUsers_NonManager(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lu2-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewMemberHandler(db, access.NewService(db), nil)
	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String()+"/users", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	// viewer access -> canManage false, invite links hidden
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: lib.ID, Role: access.RoleViewer, IsAdmin: false})
	if err := h.ListUsers(c); err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["canManageUsers"] != false {
		t.Fatalf("expected canManageUsers false")
	}
}

func TestMember_RemoveMember_Success(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "rm-owner@example.com")
	member := mustUser(t, db, "rm-member@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	db.Create(&models.LibraryMember{ID: uuid.New(), LibraryID: lib.ID, UserID: member.ID, Role: "viewer"})

	h := NewMemberHandler(db, access.NewService(db), activity.NewService(db, activity.NewHub(), activity.NewBus(nil)))
	req := httptest.NewRequest(http.MethodDelete, "/api/libraries/"+lib.ID.String()+"/users/"+member.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "memberUserId")
	c.SetParamValues(lib.ID.String(), member.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	if err := h.RemoveMember(c); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var cnt int64
	db.Model(&models.LibraryMember{}).Where("library_id = ? AND user_id = ?", lib.ID, member.ID).Count(&cnt)
	if cnt != 0 {
		t.Fatalf("member not removed")
	}
}

func TestMember_RevokeInvite_Success(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "rv-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	inv := models.LibraryInvite{ID: uuid.New(), LibraryID: lib.ID, InvitedByUserID: owner.ID, Token: uuid.New().String()}
	db.Create(&inv)

	h := NewMemberHandler(db, access.NewService(db), nil)
	req := httptest.NewRequest(http.MethodDelete, "/api/libraries/"+lib.ID.String()+"/users/invites/"+inv.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "inviteId")
	c.SetParamValues(lib.ID.String(), inv.ID.String())
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	if err := h.RevokeInvite(c); err != nil {
		t.Fatalf("RevokeInvite: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var got models.LibraryInvite
	db.First(&got, "id = ?", inv.ID)
	if got.RevokedAt == nil {
		t.Fatalf("not revoked")
	}
}
