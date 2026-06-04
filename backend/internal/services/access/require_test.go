package access

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func newEchoCtx() echo.Context {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	return e.NewContext(req, rec)
}

func httpStatus(t *testing.T, err error) int {
	t.Helper()
	if err == nil {
		t.Fatal("expected an *echo.HTTPError, got nil")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %T: %v", err, err)
	}
	return he.Code
}

func TestRequireLibraryAccess_OwnerOK(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)

	acc, err := svc.RequireLibraryAccess(newEchoCtx(), owner.ID, lib.ID)
	if err != nil {
		t.Fatalf("owner should pass RequireLibraryAccess: %v", err)
	}
	if !acc.IsOwner {
		t.Error("expected owner access")
	}
}

func TestRequireLibraryAccess_NotFoundIs404(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	stranger := createTestUser(t, db, "req-stranger@test.com")

	_, err := svc.RequireLibraryAccess(newEchoCtx(), stranger.ID, uuid.New())
	if got := httpStatus(t, err); got != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", got)
	}
}

func TestRequireLibraryAccess_NonMemberIs404(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner2@test.com")
	stranger := createTestUser(t, db, "req-stranger2@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)

	_, err := svc.RequireLibraryAccess(newEchoCtx(), stranger.ID, lib.ID)
	if got := httpStatus(t, err); got != http.StatusNotFound {
		t.Fatalf("expected 404 for non-member, got %d", got)
	}
}

func TestRequireLibraryAdmin_ViewerIs403(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner3@test.com")
	viewer := createTestUser(t, db, "req-viewer@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: viewer.ID, Role: "viewer"})

	_, err := svc.RequireLibraryAdmin(newEchoCtx(), viewer.ID, lib.ID)
	if got := httpStatus(t, err); got != http.StatusForbidden {
		t.Fatalf("expected 403 for viewer, got %d", got)
	}
}

func TestRequireLibraryAdmin_AdminOK(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner4@test.com")
	admin := createTestUser(t, db, "req-admin@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: admin.ID, Role: "admin"})

	acc, err := svc.RequireLibraryAdmin(newEchoCtx(), admin.ID, lib.ID)
	if err != nil {
		t.Fatalf("admin member should pass RequireLibraryAdmin: %v", err)
	}
	if !acc.IsAdmin {
		t.Error("expected admin access")
	}
}

// TestRequireLibraryAdmin_PropagatesAccessError covers the early-return when
// the underlying RequireLibraryAccess fails (404 for a missing library).
func TestRequireLibraryAdmin_PropagatesAccessError(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner4b@test.com")
	_, err := svc.RequireLibraryAdmin(newEchoCtx(), owner.ID, uuid.New())
	if got := httpStatus(t, err); got != http.StatusNotFound {
		t.Fatalf("expected propagated 404, got %d", got)
	}
}

func TestRequireCollaborativeLibraryAdmin_OwnerOnCollaborativeOK(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner5@test.com")
	lib := createTestLibrary(t, db, owner.ID, false) // not default => collaborative

	acc, err := svc.RequireCollaborativeLibraryAdmin(newEchoCtx(), owner.ID, lib.ID)
	if err != nil {
		t.Fatalf("owner of collaborative library should pass: %v", err)
	}
	if acc.IsDefault {
		t.Error("library should not be default")
	}
}

// TestRequireCollaborativeLibraryAdmin_PersonalIs400 covers the personal/
// default rejection branch (owner of a default library is admin but
// collaboration is disabled).
func TestRequireCollaborativeLibraryAdmin_PersonalIs400(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner6@test.com")
	lib := createTestLibrary(t, db, owner.ID, true) // default/personal

	_, err := svc.RequireCollaborativeLibraryAdmin(newEchoCtx(), owner.ID, lib.ID)
	if got := httpStatus(t, err); got != http.StatusBadRequest {
		t.Fatalf("expected 400 for personal library, got %d", got)
	}
}

// TestRequireCollaborativeLibraryAdmin_PropagatesAdminError covers the
// early-return when the inner RequireLibraryAdmin fails (viewer => 403).
func TestRequireCollaborativeLibraryAdmin_PropagatesAdminError(t *testing.T) {
	db := testDB(t)
	svc := NewService(db)
	owner := createTestUser(t, db, "req-owner7@test.com")
	viewer := createTestUser(t, db, "req-viewer7@test.com")
	lib := createTestLibrary(t, db, owner.ID, false)
	db.Create(&models.LibraryMember{LibraryID: lib.ID, UserID: viewer.ID, Role: "viewer"})

	_, err := svc.RequireCollaborativeLibraryAdmin(newEchoCtx(), viewer.ID, lib.ID)
	if got := httpStatus(t, err); got != http.StatusForbidden {
		t.Fatalf("expected propagated 403, got %d", got)
	}
}
