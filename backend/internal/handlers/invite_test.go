package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/invites"
)

// Port of the TypeScript invite utility tests

func testNormalizeEmail(input string) (string, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return "", fmt.Errorf("email is required")
	}
	s = strings.ToLower(s)
	if !regexp.MustCompile(`^[^@\s]+@[^@\s]+$`).MatchString(s) {
		return "", fmt.Errorf("invalid email format")
	}
	return s, nil
}

func testParseInviteRole(input string) (string, error) {
	switch input {
	case "", "viewer":
		return "viewer", nil
	case "admin":
		return "admin", nil
	default:
		return "", fmt.Errorf("invalid role: %s (must be 'viewer' or 'admin')", input)
	}
}

func testGenerateInviteToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func TestNormalizeEmailTrimsAndLowercases(t *testing.T) {
	v, err := testNormalizeEmail("  User@Example.COM  ")
	if err != nil || v != "user@example.com" {
		t.Fatalf("Expected 'user@example.com', got %q, %v", v, err)
	}
}

func TestNormalizeEmailRejectsEmpty(t *testing.T) {
	_, err := testNormalizeEmail("")
	if err == nil {
		t.Fatal("Expected error for empty email")
	}
	_, err = testNormalizeEmail("   ")
	if err == nil {
		t.Fatal("Expected error for whitespace email")
	}
}

func TestNormalizeEmailRejectsInvalid(t *testing.T) {
	_, err := testNormalizeEmail("not-an-email")
	if err == nil {
		t.Fatal("Expected error for invalid email format")
	}
}

func TestNormalizeEmailAcceptsValid(t *testing.T) {
	v, err := testNormalizeEmail("a@b.c")
	if err != nil || v != "a@b.c" {
		t.Fatalf("Expected 'a@b.c', got %q, %v", v, err)
	}
	v, err = testNormalizeEmail("user+tag@example.com")
	if err != nil || v != "user+tag@example.com" {
		t.Fatalf("Expected 'user+tag@example.com', got %q, %v", v, err)
	}
}

func TestParseInviteRoleDefaults(t *testing.T) {
	v, err := testParseInviteRole("")
	if err != nil || v != "viewer" {
		t.Fatalf("Expected 'viewer', got %q, %v", v, err)
	}
	v, err = testParseInviteRole("viewer")
	if err != nil || v != "viewer" {
		t.Fatalf("Expected 'viewer', got %q, %v", v, err)
	}
}

func TestParseInviteRoleAdmin(t *testing.T) {
	v, err := testParseInviteRole("admin")
	if err != nil || v != "admin" {
		t.Fatalf("Expected 'admin', got %q, %v", v, err)
	}
}

func TestParseInviteRoleInvalid(t *testing.T) {
	_, err := testParseInviteRole("owner")
	if err == nil {
		t.Fatal("Expected error for 'owner' role")
	}
	_, err = testParseInviteRole("moderator")
	if err == nil {
		t.Fatal("Expected error for 'moderator' role")
	}
}

func TestGenerateInviteTokenFormat(t *testing.T) {
	token := testGenerateInviteToken()
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(token) {
		t.Fatalf("Token should be base64url, got %q", token)
	}
	if len(token) <= 10 {
		t.Fatalf("Token should be >10 chars, got %d", len(token))
	}
}

func TestGenerateInviteTokenUniqueness(t *testing.T) {
	tokens := map[string]bool{}
	for i := 0; i < 50; i++ {
		tokens[testGenerateInviteToken()] = true
	}
	if len(tokens) != 50 {
		t.Fatalf("Expected 50 unique tokens, got %d", len(tokens))
	}
}

// Test the actual normalizeEmail function from auth.go
func TestAuthNormalizeEmail(t *testing.T) {
	if v := normalizeEmail("  User@Example.COM  "); v != "user@example.com" {
		t.Fatalf("Expected 'user@example.com', got %q", v)
	}
}

// ─── InviteHandler tests ─────────────────────────────────────

// inviteHandlerTestDB returns a DB with all invite-relevant tables migrated +
// truncated. Mirrors libraryTestDB but adds library_invite_uses.
func inviteHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := libraryTestDB(t)
	if err := db.AutoMigrate(&models.LibraryInviteUse{}); err != nil {
		t.Fatalf("auto-migrate library_invite_uses: %v", err)
	}
	db.Exec("TRUNCATE TABLE library_invite_uses CASCADE")
	return db
}

func mkInviteRow(t *testing.T, db *gorm.DB, lib models.Library, owner models.User, mut func(*models.LibraryInvite)) models.LibraryInvite {
	t.Helper()
	inv := models.LibraryInvite{
		LibraryID:       lib.ID,
		InvitedByUserID: owner.ID,
		Token:           uuid.NewString(),
	}
	if mut != nil {
		mut(&inv)
	}
	if err := db.Create(&inv).Error; err != nil {
		t.Fatalf("create invite: %v", err)
	}
	return inv
}

func newInviteCtx(e *echo.Echo, method, target, body string, userID uuid.UUID, paramName, paramValue string) (echo.Context, *httptest.ResponseRecorder) {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames(paramName)
	c.SetParamValues(paramValue)
	if userID != uuid.Nil {
		c.Set(middleware.ContextKeyUserID, userID.String())
	}
	return c, rec
}

func TestInvite_Lookup_ReturnsExhausted(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "lookup-exh-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	one := 1
	inv := mkInviteRow(t, db, lib, owner, func(i *models.LibraryInvite) {
		i.MaxUses = &one
		i.UseCount = 1
	})

	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, rec := newInviteCtx(e, http.MethodGet, "/api/invites/"+inv.Token, "", uuid.Nil, "token", inv.Token)
	if err := h.Lookup(c); err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["status"] != "exhausted" {
		t.Fatalf("expected status=exhausted, got %v", resp["status"])
	}
	if resp["canAccept"] != false {
		t.Fatalf("expected canAccept=false, got %v", resp["canAccept"])
	}
}

func TestInvite_Lookup_ReturnsExpired(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "lookup-exp-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	past := time.Now().Add(-time.Hour)
	inv := mkInviteRow(t, db, lib, owner, func(i *models.LibraryInvite) {
		i.ExpiresAt = &past
	})

	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, rec := newInviteCtx(e, http.MethodGet, "/api/invites/"+inv.Token, "", uuid.Nil, "token", inv.Token)
	if err := h.Lookup(c); err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["status"] != "expired" {
		t.Fatalf("expected status=expired, got %v", resp["status"])
	}
}

func TestInvite_Lookup_AlreadyMember(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "lookup-am-owner@example.com")
	member := mustUser(t, db, "lookup-am-member@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	if err := db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: member.ID, Role: "viewer"}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	inv := mkInviteRow(t, db, lib, owner, nil)

	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, rec := newInviteCtx(e, http.MethodGet, "/api/invites/"+inv.Token, "", member.ID, "token", inv.Token)
	if err := h.Lookup(c); err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["status"] != "already_member" {
		t.Fatalf("expected status=already_member, got %v", resp["status"])
	}
}

func TestInvite_Lookup_AnonGetsCanAccept(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "lookup-anon-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	inv := mkInviteRow(t, db, lib, owner, nil)

	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, rec := newInviteCtx(e, http.MethodGet, "/api/invites/"+inv.Token, "", uuid.Nil, "token", inv.Token)
	if err := h.Lookup(c); err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["canAccept"] != true {
		t.Fatalf("expected canAccept=true for anon, got %v", resp["canAccept"])
	}
	if resp["status"] != "pending" {
		t.Fatalf("expected status=pending, got %v", resp["status"])
	}
}

func TestInvite_Accept_Idempotent(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "accept-idem-owner@example.com")
	joiner := mustUser(t, db, "accept-idem-joiner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	inv := mkInviteRow(t, db, lib, owner, nil)

	h := NewInviteHandler(db, nil)
	e := newLibEcho()

	for i := 0; i < 2; i++ {
		c, rec := newInviteCtx(e, http.MethodPost, "/api/invites/"+inv.Token+"/accept", "", joiner.ID, "token", inv.Token)
		if err := h.Accept(c); err != nil {
			t.Fatalf("Accept #%d: %v", i, err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("Accept #%d: expected 200, got %d", i, rec.Code)
		}
	}

	var useCount int64
	db.Model(&models.LibraryInviteUse{}).Where("invite_id = ? AND user_id = ?", inv.ID, joiner.ID).Count(&useCount)
	if useCount != 1 {
		t.Fatalf("expected 1 usage row after duplicate accept, got %d", useCount)
	}
}

func TestInvite_Accept_410OnExpired(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "accept-exp-owner@example.com")
	joiner := mustUser(t, db, "accept-exp-joiner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	past := time.Now().Add(-time.Hour)
	inv := mkInviteRow(t, db, lib, owner, func(i *models.LibraryInvite) {
		i.ExpiresAt = &past
	})

	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, _ := newInviteCtx(e, http.MethodPost, "/api/invites/"+inv.Token+"/accept", "", joiner.ID, "token", inv.Token)
	err := h.Accept(c)
	if err == nil {
		t.Fatal("expected error")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusGone {
		t.Fatalf("expected 410 Gone, got %v", err)
	}
}

func TestInvite_Accept_410OnExhausted(t *testing.T) {
	db := inviteHandlerTestDB(t)
	owner := mustUser(t, db, "accept-exh-owner@example.com")
	joiner := mustUser(t, db, "accept-exh-joiner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	one := 1
	inv := mkInviteRow(t, db, lib, owner, func(i *models.LibraryInvite) {
		i.MaxUses = &one
		i.UseCount = 1
	})

	h := NewInviteHandler(db, nil)
	e := newLibEcho()
	c, _ := newInviteCtx(e, http.MethodPost, "/api/invites/"+inv.Token+"/accept", "", joiner.ID, "token", inv.Token)
	err := h.Accept(c)
	if err == nil {
		t.Fatal("expected error")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusGone {
		t.Fatalf("expected 410 Gone, got %v", err)
	}
}

// Sanity: keep invites import live so test file compiles even if redeem
// helpers stop being used directly here.
var _ = invites.ErrNotFound
