package access

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// brokenDB returns a *gorm.DB whose underlying connection pool has been
// closed, so every query returns a non-ErrRecordNotFound error. This drives
// the GetLibraryAccess / RequireLibraryAccess DB-error branches.
func brokenDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_access")
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db handle: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close pool: %v", err)
	}
	return db
}

func TestGetLibraryAccess_DBErrorOnLibraryLookup(t *testing.T) {
	svc := NewService(brokenDB(t))
	_, err := svc.GetLibraryAccess(uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("expected a DB error from a closed connection pool")
	}
}

func TestRequireLibraryAccess_DBErrorIs500(t *testing.T) {
	svc := NewService(brokenDB(t))
	_, err := svc.RequireLibraryAccess(newEchoCtx(), uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("expected error")
	}
	if got := httpStatus(t, err); got != http.StatusInternalServerError {
		t.Fatalf("expected 500 on DB error, got %d", got)
	}
}

// TestGetLibraryAccess_DBErrorOnMemberLookup drives the second DB-error
// branch: the library row loads fine, but the membership query fails.
// We close the pool only after seeding, so the library SELECT will also
// fail; to isolate the member branch we instead use a DB missing the
// library_members table.
func TestGetLibraryAccess_DBErrorOnMemberLookup(t *testing.T) {
	db := testsupport.OpenSchema(t, "svc_access")
	// Ensure libraries+users exist but drop library_members so the
	// membership query errors with "relation does not exist".
	if err := db.Exec("DROP TABLE IF EXISTS library_members CASCADE").Error; err != nil {
		t.Fatalf("drop members: %v", err)
	}
	// Recreate libraries/users cleanly so the first SELECT succeeds.
	db.Exec("DELETE FROM library_members")
	db.Exec("DELETE FROM libraries")
	db.Exec("DELETE FROM users")

	owner := createTestUser(t, db, "memberr-owner@test.com")
	stranger := createTestUser(t, db, "memberr-stranger@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)

	svc := NewService(db)
	_, err := svc.GetLibraryAccess(stranger.ID, lib.ID)
	if err == nil {
		t.Fatal("expected member-lookup error with missing library_members table")
	}

	// Restore library_members for other tests that share this DB.
	db.AutoMigrate(&models.LibraryMember{})
}
