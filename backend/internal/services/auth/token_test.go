package auth

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func setupTokenTestDB(t *testing.T) (*Service, *gorm.DB, models.User) {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.PersonalAccessToken{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// CASCADE clears rows other test packages left in tables that FK-reference
	// users in the shared test DB; a plain DELETE would FK-fail and leave them.
	db.Exec("TRUNCATE TABLE users RESTART IDENTITY CASCADE")

	svc, err := NewService(db, "test-session-secret-which-is-long-enough")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	user := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: "pat@test.com", DisplayName: "PAT User", Role: "member"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return svc, db, user
}

func TestCreateAndValidateMCPToken(t *testing.T) {
	svc, _, user := setupTokenTestDB(t)

	plaintext, pat, err := svc.CreatePersonalAccessToken(user.ID, "laptop", nil)
	if err != nil {
		t.Fatalf("CreatePersonalAccessToken: %v", err)
	}
	if !strings.HasPrefix(plaintext, PATPrefix) {
		t.Fatalf("token missing prefix: %s", plaintext)
	}
	if pat.TokenHash == plaintext {
		t.Fatalf("stored hash must not equal plaintext")
	}

	got, err := svc.ValidateMCPToken(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("ValidateMCPToken: %v", err)
	}
	if got == nil || got.ID != user.ID {
		t.Fatalf("expected to resolve user %s, got %v", user.ID, got)
	}
}

func TestValidateMCPToken_UpdatesLastUsed(t *testing.T) {
	svc, db, user := setupTokenTestDB(t)
	plaintext, pat, _ := svc.CreatePersonalAccessToken(user.ID, "x", nil)

	if _, err := svc.ValidateMCPToken(context.Background(), plaintext); err != nil {
		t.Fatal(err)
	}
	var reloaded models.PersonalAccessToken
	db.Where("id = ?", pat.ID).First(&reloaded)
	if reloaded.LastUsedAt == nil {
		t.Fatalf("expected last_used_at to be set after validation")
	}
}

func TestValidateMCPToken_Expired(t *testing.T) {
	svc, _, user := setupTokenTestDB(t)
	past := time.Now().Add(-time.Hour)
	plaintext, _, _ := svc.CreatePersonalAccessToken(user.ID, "expired", &past)

	got, err := svc.ValidateMCPToken(context.Background(), plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatalf("expected nil user for expired token")
	}
}

func TestValidateMCPToken_Unknown(t *testing.T) {
	svc, _, _ := setupTokenTestDB(t)
	for _, tok := range []string{"", "not-a-pat", PATPrefix + "deadbeef"} {
		got, err := svc.ValidateMCPToken(context.Background(), tok)
		if err != nil {
			t.Fatalf("unexpected error for %q: %v", tok, err)
		}
		if got != nil {
			t.Fatalf("expected nil user for unknown token %q", tok)
		}
	}
}
