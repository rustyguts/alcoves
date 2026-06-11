package access

import (
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_access")

	db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.LibraryMember{},
	)

	// TRUNCATE … CASCADE clears everything in one statement and tolerates a
	// schema that a prior error-path test may have temporarily mangled.
	db.Exec("TRUNCATE TABLE library_members, libraries, users RESTART IDENTITY CASCADE")

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

func TestListAccessibleLibraries(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)

	user := createTestUser(t, db, "lister@test.com")
	otherOwner := createTestUser(t, db, "otherowner@test.com")

	// User owns two libraries; created_at ordering follows insert order.
	owned1 := createTestLibrary(t, db, user.ID, false)
	owned2 := createTestLibrary(t, db, user.ID, false)

	// User is an admin member of one library and a viewer of another, both
	// owned by someone else. Created in this order to assert member ordering.
	adminLib := createTestLibrary(t, db, otherOwner.ID, false)
	viewerLib := createTestLibrary(t, db, otherOwner.ID, false)
	db.Create(&models.LibraryMember{LibraryID: adminLib.ID, UserID: user.ID, Role: "admin"})
	db.Create(&models.LibraryMember{LibraryID: viewerLib.ID, UserID: user.ID, Role: "viewer"})

	libs, err := svc.ListAccessibleLibraries(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(libs) != 4 {
		t.Fatalf("Expected 4 libraries, got %d", len(libs))
	}

	// Owned first (by created_at), then members (by created_at).
	expected := []struct {
		id      uuid.UUID
		role    LibraryAccessRole
		isOwner bool
		isAdmin bool
	}{
		{owned1.ID, RoleOwner, true, true},
		{owned2.ID, RoleOwner, true, true},
		{adminLib.ID, RoleAdmin, false, true},
		{viewerLib.ID, RoleViewer, false, false},
	}

	for i, exp := range expected {
		got := libs[i]
		if got.Library.ID != exp.id {
			t.Errorf("entry %d: expected library %s, got %s", i, exp.id, got.Library.ID)
		}
		if got.Access.LibraryID != exp.id {
			t.Errorf("entry %d: expected access LibraryID %s, got %s", i, exp.id, got.Access.LibraryID)
		}
		if got.Access.Role != exp.role {
			t.Errorf("entry %d: expected role %s, got %s", i, exp.role, got.Access.Role)
		}
		if got.Access.IsOwner != exp.isOwner {
			t.Errorf("entry %d: expected IsOwner %v, got %v", i, exp.isOwner, got.Access.IsOwner)
		}
		if got.Access.IsAdmin != exp.isAdmin {
			t.Errorf("entry %d: expected IsAdmin %v, got %v", i, exp.isAdmin, got.Access.IsAdmin)
		}
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
