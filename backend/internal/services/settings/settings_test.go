package settings

import (
	"testing"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_settings")
	if err := db.AutoMigrate(&models.User{}, &models.AppSettings{}); err != nil {
		t.Fatalf("auto-migrate: %v", err)
	}
	// Reset to defaults for a clean slate. CASCADE not needed — only this
	// service owns app_settings. We also clear the per-test settings
	// updater since TestSettings_UpdatedByPersists creates a fixed-email
	// user; without this, a re-run of the suite fails on the unique-email
	// constraint left over from the prior run.
	if err := db.Exec("DELETE FROM app_settings").Error; err != nil {
		t.Fatalf("reset app_settings: %v", err)
	}
	if err := db.Exec("DELETE FROM users WHERE email = ?", "settings-updater@example.com").Error; err != nil {
		t.Fatalf("reset test user: %v", err)
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

func TestSettings_InferenceDefaultsSeededOnFreshInstall(t *testing.T) {
	// New deployments start with sensible inference defaults so the
	// worker doesn't need an env var to pick a model.
	db := testDB(t)
	svc, err := NewService(db)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	got := svc.Get()
	if got.WhisperModel != "large-v3" {
		t.Errorf("WhisperModel default: got %q want %q", got.WhisperModel, "large-v3")
	}
	if got.WhisperLanguage != "auto" {
		t.Errorf("WhisperLanguage default: got %q want %q", got.WhisperLanguage, "auto")
	}
	if got.AudioDetectModel != "efficientat_mn10" {
		t.Errorf("AudioDetectModel default: got %q want %q", got.AudioDetectModel, "efficientat_mn10")
	}
}

func TestSettings_UpdateInferenceFieldsRoundTrip(t *testing.T) {
	db := testDB(t)
	svc, _ := NewService(db)

	updated, err := svc.Update(Settings{
		WhisperModel:     "large-v3-turbo-q5_0",
		WhisperLanguage:  "en",
		AudioDetectModel: "ced_base",
	}, nil)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.WhisperModel != "large-v3-turbo-q5_0" {
		t.Errorf("WhisperModel: got %q", updated.WhisperModel)
	}
	if updated.WhisperLanguage != "en" {
		t.Errorf("WhisperLanguage: got %q", updated.WhisperLanguage)
	}
	if updated.AudioDetectModel != "ced_base" {
		t.Errorf("AudioDetectModel: got %q", updated.AudioDetectModel)
	}

	// Confirm persistence by spinning up a fresh service against the
	// same DB; an in-memory cache would miss the on-disk row.
	svc2, _ := NewService(db)
	g := svc2.Get()
	if g.WhisperModel != "large-v3-turbo-q5_0" || g.AudioDetectModel != "ced_base" {
		t.Errorf("second service instance saw stale values: %+v", g)
	}
}

func TestSettings_PartialUpdateLeavesOtherFieldsIntact(t *testing.T) {
	// Admin saving just the audio_detect_model must not wipe the
	// registration_mode the previous admin set — Update merges into the
	// cached row rather than overwriting.
	db := testDB(t)
	svc, _ := NewService(db)
	_, _ = svc.Update(Settings{RegistrationMode: RegistrationInviteOnly}, nil)
	_, _ = svc.Update(Settings{AudioDetectModel: "ced_tiny"}, nil)
	got := svc.Get()
	if got.RegistrationMode != RegistrationInviteOnly {
		t.Errorf("RegistrationMode wiped by unrelated update: got %q", got.RegistrationMode)
	}
	if got.AudioDetectModel != "ced_tiny" {
		t.Errorf("AudioDetectModel: got %q want ced_tiny", got.AudioDetectModel)
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
