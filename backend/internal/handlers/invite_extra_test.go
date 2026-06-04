package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

func TestInvite_Accept_Success(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "acc-owner@example.com")
	joiner := mustUser(t, db, "acc-joiner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	inv := mkInviteRow(t, db, lib, owner, nil)

	h := NewInviteHandler(db, activity.NewService(db, activity.NewHub(), activity.NewBus(nil)))
	e := newLibEcho()
	c, rec := newInviteCtx(e, http.MethodPost, "/api/invites/"+inv.Token+"/accept", "", joiner.ID, "token", inv.Token)
	if err := h.Accept(c); err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var cnt int64
	db.Model(&models.LibraryMember{}).Where("library_id = ? AND user_id = ?", lib.ID, joiner.ID).Count(&cnt)
	if cnt != 1 {
		t.Fatalf("expected joiner to be added as member")
	}
}

func TestInvite_Accept_NotFound(t *testing.T) {
	db := inviteHandlerTestDB(t)
	joiner := mustUser(t, db, "acc-nf-joiner@example.com")
	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, _ := newInviteCtx(e, http.MethodPost, "/api/invites/nope/accept", "", joiner.ID, "token", "nope")
	if httpCode(t, h.Accept(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestInvite_Accept_Unauthorized(t *testing.T) {
	db := inviteHandlerTestDB(t)
	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, _ := newInviteCtx(e, http.MethodPost, "/api/invites/x/accept", "", uuid.Nil, "token", "x")
	if httpCode(t, h.Accept(c)) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}

func TestInvite_Accept_Revoked(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "acc-rev-owner@example.com")
	joiner := mustUser(t, db, "acc-rev-joiner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	now := time.Now()
	inv := mkInviteRow(t, db, lib, owner, func(i *models.LibraryInvite) { i.RevokedAt = &now })
	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, _ := newInviteCtx(e, http.MethodPost, "/api/invites/"+inv.Token+"/accept", "", joiner.ID, "token", inv.Token)
	if httpCode(t, h.Accept(c)) != http.StatusGone {
		t.Fatalf("want 410 (revoked)")
	}
}

func TestInvite_Lookup_Revoked(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "lk-rev-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	now := time.Now()
	inv := mkInviteRow(t, db, lib, owner, func(i *models.LibraryInvite) { i.RevokedAt = &now })
	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, rec := newInviteCtx(e, http.MethodGet, "/api/invites/"+inv.Token, "", uuid.Nil, "token", inv.Token)
	if err := h.Lookup(c); err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestInvite_Lookup_NotFound(t *testing.T) {
	db := inviteHandlerTestDB(t)
	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, _ := newInviteCtx(e, http.MethodGet, "/api/invites/nope", "", uuid.Nil, "token", "nope")
	if httpCode(t, h.Lookup(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}
