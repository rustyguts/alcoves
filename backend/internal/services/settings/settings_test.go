package settings

import (
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("db not available: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.AppSettings{}); err != nil {
		t.Fatalf("auto-migrate: %v", err)
	}
	// Reset to defaults for a clean slate. CASCADE not needed — only this
	// service owns app_settings.
	if err := db.Exec("DELETE FROM app_settings").Error; err != nil {
		t.Fatalf("reset app_settings: %v", err)
	}
	return db
}

func TestSettings_DefaultsToOpen(t *testing.T) {
	db := testDB(t)

	svc, err := NewService(db)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if got := svc.Get().RegistrationMode; got != RegistrationOpen {
		t.Fatalf("expected default mode %q, got %q", RegistrationOpen, got)
	}

	// Row was auto-seeded by NewService.
	var count int64
	db.Model(&models.AppSettings{}).Count(&count)
	if count != 1 {
		t.Fatalf("expected 1 app_settings row, got %d", count)
	}
}

func TestSettings_UpdateRegistrationMode(t *testing.T) {
	db := testDB(t)

	svc, _ := NewService(db)
	if _, err := svc.Update(Settings{RegistrationMode: RegistrationClosed}, nil); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got := svc.Get().RegistrationMode; got != RegistrationClosed {
		t.Fatalf("expected mode %q after update, got %q", RegistrationClosed, got)
	}

	// A second service instance should see the persisted value.
	svc2, err := NewService(db)
	if err != nil {
		t.Fatalf("NewService #2: %v", err)
	}
	if got := svc2.Get().RegistrationMode; got != RegistrationClosed {
		t.Fatalf("second instance saw stale mode %q", got)
	}
}

func TestSettings_RejectsInvalidMode(t *testing.T) {
	db := testDB(t)
	svc, _ := NewService(db)
	if _, err := svc.Update(Settings{RegistrationMode: "banana"}, nil); err == nil {
		t.Fatal("expected validation error, got nil")
	}
	if got := svc.Get().RegistrationMode; got != RegistrationOpen {
		t.Fatalf("invalid update should not mutate cache; got %q", got)
	}
}

func TestSettings_UpdatedByPersists(t *testing.T) {
	db := testDB(t)

	user := models.User{Email: "settings-updater@example.com", DisplayName: "U", Role: "owner"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	svc, _ := NewService(db)
	uid := user.ID
	if _, err := svc.Update(Settings{RegistrationMode: RegistrationInviteOnly}, &uid); err != nil {
		t.Fatalf("Update: %v", err)
	}

	var row models.AppSettings
	if err := db.Where("id = ?", 1).First(&row).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if row.UpdatedBy == nil || *row.UpdatedBy != user.ID {
		t.Fatalf("expected updated_by=%s, got %v", user.ID, row.UpdatedBy)
	}
}

func TestSettings_SeedsRowOnFirstLoad(t *testing.T) {
	db := testDB(t)

	// Sanity check: testDB cleared the table.
	var count int64
	db.Model(&models.AppSettings{}).Count(&count)
	if count != 0 {
		t.Fatalf("precondition: expected empty table, found %d rows", count)
	}

	if _, err := NewService(db); err != nil {
		t.Fatalf("NewService: %v", err)
	}

	db.Model(&models.AppSettings{}).Count(&count)
	if count != 1 {
		t.Fatalf("expected NewService to seed 1 row, got %d", count)
	}
}
