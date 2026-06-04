package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/filehash"
)

func TestAdmin_Stats(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "stats-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	createFile(t, db, lib.ID, owner.ID, "a.jpg", false, nil)

	req := httptest.NewRequest(http.MethodGet, "/admin/stats", nil)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	if err := h.Stats(c); err != nil {
		t.Fatalf("Stats: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["files"].(float64) < 1 {
		t.Fatalf("expected >=1 file, got %v", resp["files"])
	}
}

func TestAdmin_ListUsers(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "lu-admin@example.com")
	mustUser(t, db, "lu-admin2@example.com")
	req := httptest.NewRequest(http.MethodGet, "/admin/users", nil)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	if err := h.ListUsers(c); err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	var resp []map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) < 2 {
		t.Fatalf("expected >=2 users")
	}
}

func TestAdmin_UpdateUser(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "uu-owner@example.com")
	target := mustUser(t, db, "uu-target@example.com")

	body := `{"role":"owner"}`
	req := httptest.NewRequest(http.MethodPatch, "/admin/users/"+target.ID.String(), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	c.SetParamNames("userId")
	c.SetParamValues(target.ID.String())
	if err := h.UpdateUser(c); err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var u models.User
	db.First(&u, "id = ?", target.ID)
	if u.Role != "owner" {
		t.Fatalf("role not updated")
	}
}

func TestAdmin_UpdateUser_BadRole(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "uu2-owner@example.com")
	target := mustUser(t, db, "uu2-target@example.com")
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"role":"superadmin"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	c.SetParamNames("userId")
	c.SetParamValues(target.ID.String())
	if httpCode(t, h.UpdateUser(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestAdmin_UpdateUser_NoFields(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "uu3-owner@example.com")
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	c.SetParamNames("userId")
	c.SetParamValues(uuid.New().String())
	if httpCode(t, h.UpdateUser(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestAdmin_UpdateUser_NotFound(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "uu4-owner@example.com")
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"role":"member"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	c.SetParamNames("userId")
	c.SetParamValues(uuid.New().String())
	if httpCode(t, h.UpdateUser(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestAdmin_UpdateUser_InvalidID(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "uu5-owner@example.com")
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"role":"member"}`))
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	c.SetParamNames("userId")
	c.SetParamValues("bad")
	if httpCode(t, h.UpdateUser(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestAdmin_BackfillHashes(t *testing.T) {
	db := libraryTestDB(t)
	_, settingsSvc := adminHandlerForTest(t, db)
	_ = settingsSvc
	st := setupPurgeStorage(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })
	hashSvc := filehash.NewService(db, st, client)
	h := NewAdminHandler(db, hashSvc, settingsSvc)

	owner := mustUser(t, db, "bf-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	createFile(t, db, lib.ID, owner.ID, "a.jpg", false, nil)

	e := newLibEcho()
	req := httptest.NewRequest(http.MethodPost, "/admin/backfill-hashes", nil)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	if err := h.BackfillHashes(c); err != nil {
		t.Fatalf("BackfillHashes: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestAdmin_RequireOwner_Allows(t *testing.T) {
	db := libraryTestDB(t)
	h, _ := adminHandlerForTest(t, db)
	e := newLibEcho()
	owner := mustUser(t, db, "ro-owner@example.com")
	owner.Role = "owner"
	db.Save(&owner)
	req := httptest.NewRequest(http.MethodGet, "/admin/stats", nil)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)
	if err := h.requireOwnerMiddleware(h.Stats)(c); err != nil {
		t.Fatalf("expected owner allowed: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}
