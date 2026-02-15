package access

import (
	"testing"

	"github.com/google/uuid"
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
		t.Skipf("Skipping test: database not available: %v", err)
	}

	db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.LibraryMember{},
	)

	db.Exec("DELETE FROM library_members")
	db.Exec("DELETE FROM libraries")
	db.Exec("DELETE FROM users")

	return db
}

func createTestUser(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	user := models.User{
		Email:       email,
		DisplayName: "Test User",
		Role:        "member",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}
	return user
}

func createTestLibrary(t *testing.T, db *gorm.DB, ownerID uuid.UUID, isDefault bool) models.Library {
	t.Helper()
	lib := models.Library{
		Name:      "Test Library",
		IsDefault: isDefault,
		OwnerID:   ownerID,
	}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("Failed to create test library: %v", err)
	}
	return lib
}

func TestOwnerHasAccess(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)

	owner := createTestUser(t, db, "owner@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)

	access, err := svc.GetLibraryAccess(owner.ID, lib.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access == nil {
		t.Fatal("Owner should have access")
	}
	if access.Role != RoleOwner {
		t.Errorf("Expected role 'owner', got %s", access.Role)
	}
	if !access.IsOwner {
		t.Error("Expected IsOwner=true")
	}
	if !access.IsAdmin {
		t.Error("Expected IsAdmin=true")
	}
}

func TestNonMemberHasNoAccess(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)

	owner := createTestUser(t, db, "owner2@test.com")
	stranger := createTestUser(t, db, "stranger@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)

	access, err := svc.GetLibraryAccess(stranger.ID, lib.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access != nil {
		t.Fatal("Non-member should not have access")
	}
}

func TestDefaultLibraryNoSharing(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)

	owner := createTestUser(t, db, "owner3@test.com")
	other := createTestUser(t, db, "other@test.com")
	lib := createTestLibrary(t, db, owner.ID, true) // default/personal library

	// Even if we add membership (shouldn't happen normally), personal library blocks it
	access, err := svc.GetLibraryAccess(other.ID, lib.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access != nil {
		t.Fatal("Personal library should not give access to non-owner")
	}

	// Owner still has access
	access, err = svc.GetLibraryAccess(owner.ID, lib.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access == nil {
		t.Fatal("Owner should still have access to personal library")
	}
}

func TestMemberViewerAccess(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)

	owner := createTestUser(t, db, "owner4@test.com")
	viewer := createTestUser(t, db, "viewer@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)

	// Add viewer membership
	db.Create(&models.LibraryMember{
		LibraryID: lib.ID,
		UserID:    viewer.ID,
		Role:      "viewer",
	})

	access, err := svc.GetLibraryAccess(viewer.ID, lib.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access == nil {
		t.Fatal("Viewer should have access")
	}
	if access.Role != RoleViewer {
		t.Errorf("Expected role 'viewer', got %s", access.Role)
	}
	if access.IsOwner {
		t.Error("Viewer should not be owner")
	}
	if access.IsAdmin {
		t.Error("Viewer should not be admin")
	}
}

func TestMemberAdminAccess(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)

	owner := createTestUser(t, db, "owner5@test.com")
	admin := createTestUser(t, db, "admin@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)

	db.Create(&models.LibraryMember{
		LibraryID: lib.ID,
		UserID:    admin.ID,
		Role:      "admin",
	})

	access, err := svc.GetLibraryAccess(admin.ID, lib.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access == nil {
		t.Fatal("Admin should have access")
	}
	if access.Role != RoleAdmin {
		t.Errorf("Expected role 'admin', got %s", access.Role)
	}
	if access.IsOwner {
		t.Error("Admin member should not be owner")
	}
	if !access.IsAdmin {
		t.Error("Admin member should be admin")
	}
}

func TestNonExistentLibrary(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)

	owner := createTestUser(t, db, "owner6@test.com")

	access, err := svc.GetLibraryAccess(owner.ID, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if access != nil {
		t.Fatal("Access to non-existent library should be nil")
	}
}
