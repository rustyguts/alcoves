package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
)

func setupTokenHandler(t *testing.T) (*TokenHandler, *gorm.DB, models.User) {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.PersonalAccessToken{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	authSvc, err := authservice.NewService(db, "tokens-handler-test-secret-long-enough")
	if err != nil {
		t.Fatalf("auth service: %v", err)
	}
	user := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: "owner@test.com", DisplayName: "Owner", Role: "member"}
	db.Create(&user)
	return NewTokenHandler(db, authSvc), db, user
}

func tokenEcho() *echo.Echo {
	e := echo.New()
	e.Validator = NewValidator()
	return e
}

func TestTokenHandler_CreateListDelete(t *testing.T) {
	h, _, user := setupTokenHandler(t)
	e := tokenEcho()

	// Create
	req := httptest.NewRequest(http.MethodPost, "/api/auth/tokens", strings.NewReader(`{"name":"laptop"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, user.ID.String())
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), authservice.PATPrefix) {
		t.Fatalf("create response should include the plaintext token, got %s", rec.Body.String())
	}

	// List
	lreq := httptest.NewRequest(http.MethodGet, "/api/auth/tokens", nil)
	lrec := httptest.NewRecorder()
	lc := e.NewContext(lreq, lrec)
	lc.Set(middleware.ContextKeyUserID, user.ID.String())
	if err := h.List(lc); err != nil {
		t.Fatalf("List: %v", err)
	}
	if !strings.Contains(lrec.Body.String(), `"laptop"`) {
		t.Fatalf("list should include the token name, got %s", lrec.Body.String())
	}
	// The list must never leak the plaintext or the hash.
	if strings.Contains(lrec.Body.String(), authservice.PATPrefix) || strings.Contains(lrec.Body.String(), "tokenHash") {
		t.Fatalf("list leaked secret material: %s", lrec.Body.String())
	}

	// Find the created token id.
	var pat models.PersonalAccessToken
	h.db.Where("user_id = ?", user.ID).First(&pat)

	// Delete
	dreq := httptest.NewRequest(http.MethodDelete, "/api/auth/tokens/"+pat.ID.String(), nil)
	drec := httptest.NewRecorder()
	dc := e.NewContext(dreq, drec)
	dc.SetParamNames("id")
	dc.SetParamValues(pat.ID.String())
	dc.Set(middleware.ContextKeyUserID, user.ID.String())
	if err := h.Delete(dc); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	// Deleting again → 404.
	drec2 := httptest.NewRecorder()
	dc2 := e.NewContext(httptest.NewRequest(http.MethodDelete, "/", nil), drec2)
	dc2.SetParamNames("id")
	dc2.SetParamValues(pat.ID.String())
	dc2.Set(middleware.ContextKeyUserID, user.ID.String())
	err := h.Delete(dc2)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on second delete, got %v", err)
	}
}

func TestTokenHandler_ScopedToUser(t *testing.T) {
	h, db, user := setupTokenHandler(t)
	other := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: "other@test.com", DisplayName: "Other", Role: "member"}
	db.Create(&other)

	// `user` creates a token.
	e := tokenEcho()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"mine"}`))
	req.Header.Set("Content-Type", "application/json")
	c := e.NewContext(req, httptest.NewRecorder())
	c.Set(middleware.ContextKeyUserID, user.ID.String())
	if err := h.Create(c); err != nil {
		t.Fatal(err)
	}

	// `other` lists — must see none.
	lrec := httptest.NewRecorder()
	lc := e.NewContext(httptest.NewRequest(http.MethodGet, "/", nil), lrec)
	lc.Set(middleware.ContextKeyUserID, other.ID.String())
	if err := h.List(lc); err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(lrec.Body.String()) != "[]" {
		t.Fatalf("other user should see no tokens, got %s", lrec.Body.String())
	}

	// `other` cannot delete `user`'s token.
	var pat models.PersonalAccessToken
	db.Where("user_id = ?", user.ID).First(&pat)
	drec := httptest.NewRecorder()
	dc := e.NewContext(httptest.NewRequest(http.MethodDelete, "/", nil), drec)
	dc.SetParamNames("id")
	dc.SetParamValues(pat.ID.String())
	dc.Set(middleware.ContextKeyUserID, other.ID.String())
	err := h.Delete(dc)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404 deleting another user's token, got %v", err)
	}
}
