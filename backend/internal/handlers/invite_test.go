package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"testing"
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
