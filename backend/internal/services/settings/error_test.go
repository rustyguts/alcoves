package settings

import (
	"encoding/json"
	"testing"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func openDB(t *testing.T) *gorm.DB {
	t.Helper()
	return testsupport.OpenSchema(t, "svc_settings")
}

func closedPool(t *testing.T) *gorm.DB {
	t.Helper()
	db := openDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db handle: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close pool: %v", err)
	}
	return db
}

// TestNewService_ReloadErrorPropagates covers NewService's `return nil, err`
// and reload's `load app_settings` error branch (closed pool → the initial
// SELECT errors with a non-ErrRecordNotFound error).
func TestNewService_ReloadErrorPropagates(t *testing.T) {
	if _, err := NewService(closedPool(t)); err == nil {
		t.Fatal("expected NewService to fail when the connection pool is closed")
	}
}

// TestReload_CoercesInvalidStoredMode seeds a row with a bad registration
// mode; reload must coerce it back to RegistrationOpen.
func TestReload_CoercesInvalidStoredMode(t *testing.T) {
	db := testDB(t) // clears app_settings
	raw, _ := json.Marshal(map[string]any{"registration_mode": "garbage"})
	if err := db.Create(&models.AppSettings{ID: 1, Settings: raw}).Error; err != nil {
		t.Fatalf("seed bad row: %v", err)
	}

	svc, err := NewService(db)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if got := svc.Get().RegistrationMode; got != RegistrationOpen {
		t.Fatalf("invalid stored mode should coerce to open, got %q", got)
	}
}

// TestReload_SeedCreateError makes the seed INSERT fail: the row is absent
// (First → ErrRecordNotFound) but the table has been replaced by one whose
// schema rejects the insert (dropping the NOT NULL `settings` default and
// the column makes Create fail). We drop the settings column so the
// generated INSERT references a non-existent column.
func TestReload_SeedCreateError(t *testing.T) {
	db := testDB(t) // ensures table exists + empty
	// Remove the column the Create writes, so First returns ErrRecordNotFound
	// (table present, no rows) and the subsequent Create errors.
	if err := db.Exec("ALTER TABLE app_settings DROP COLUMN settings").Error; err != nil {
		t.Fatalf("drop settings column: %v", err)
	}
	t.Cleanup(func() { db.AutoMigrate(&models.AppSettings{}) })

	if _, err := NewService(db); err == nil {
		t.Fatal("expected seed app_settings Create error")
	}

	if err := db.AutoMigrate(&models.AppSettings{}); err != nil {
		t.Fatalf("restore settings column: %v", err)
	}
}

// TestUpdate_DBUpdateError covers Update's persistence-error branch: build a
// valid service, then close the pool so the Updates statement fails.
func TestUpdate_DBUpdateError(t *testing.T) {
	db := testDB(t)
	svc, err := NewService(db)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	sqlDB, _ := db.DB()
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close pool: %v", err)
	}
	if _, err := svc.Update(Settings{RegistrationMode: RegistrationClosed}, nil); err == nil {
		t.Fatal("expected Update to fail after the pool was closed")
	}
}

// TestUpdate_ReloadErrorAfterPersist covers the reload-after-update error
// branch. We let the UPDATE succeed, then drop the `settings` column before
// reload's SELECT runs. Because Update + reload happen in one call we can't
// interleave; instead we drop a column reload depends on AFTER a successful
// initial NewService but rely on the fact that Update's own SELECT in reload
// will fail. To make the UPDATE succeed but the reload SELECT fail, we drop
// a non-updated column reload reads.
func TestUpdate_ReloadErrorAfterPersist(t *testing.T) {
	db := testDB(t)
	svc, err := NewService(db)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	// Drop the updated_by column: the Updates map only touches settings/
	// updated_at (updatedBy nil), so the UPDATE succeeds; reload's First
	// loads the full AppSettings struct (which includes updated_by), so the
	// SELECT * errors on the missing column.
	if err := db.Exec("ALTER TABLE app_settings DROP COLUMN updated_by").Error; err != nil {
		t.Fatalf("drop updated_by: %v", err)
	}
	t.Cleanup(func() { db.AutoMigrate(&models.AppSettings{}) })

	if _, err := svc.Update(Settings{RegistrationMode: RegistrationClosed}, nil); err == nil {
		t.Fatal("expected reload-after-update error with missing updated_by column")
	}

	if err := db.AutoMigrate(&models.AppSettings{}); err != nil {
		t.Fatalf("restore updated_by: %v", err)
	}
}
