package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
)

// libraryTestDB connects to the shared test postgres and migrates all tables
// touched by library/member/moment/share handler tests.
func libraryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Library{},
		&models.LibraryMember{},
		&models.LibraryInvite{},
		&models.File{},
		&models.Folder{},
		&models.Tag{},
		&models.Moment{},
		&models.MomentShare{},
		&models.LibraryActivity{},
		&models.UserNotificationDismissal{},
	); err != nil {
		t.Fatalf("Failed to migrate: %v", err)
	}

	// CASCADE handles any FKs from tables migrated by other test files
	// (sessions, accounts, etc.) without requiring this helper to know about them.
	db.Exec("TRUNCATE TABLE users, libraries, files, folders, tags, moments, moment_shares, library_members, library_invites, library_activities, user_notification_dismissals RESTART IDENTITY CASCADE")
	return db
}

func mustUser(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	u := models.User{Email: email, DisplayName: email, Role: "member"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func mustLibrary(t *testing.T, db *gorm.DB, ownerID uuid.UUID, name string, isDefault bool) models.Library {
	t.Helper()
	lib := models.Library{Name: name, IsDefault: isDefault, OwnerID: ownerID}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	return lib
}

func newLibEcho() *echo.Echo {
	e := echo.New()
	e.Validator = NewValidator()
	return e
}

func ctxWithUser(e *echo.Echo, req *http.Request, rec http.ResponseWriter, userID uuid.UUID) echo.Context {
	c := e.NewContext(req, rec.(*httptest.ResponseRecorder))
	c.Set(middleware.ContextKeyUserID, userID.String())
	return c
}

func TestLibraryHandler_Create_Validation(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-create@example.com")
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/libraries",
		strings.NewReader(`{"name":""}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)

	if err := h.Create(c); err == nil {
		t.Fatal("expected validation error on empty name")
	}
}

func TestLibraryHandler_Create_Success(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-create-ok@example.com")
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/libraries",
		strings.NewReader(`{"name":"My Lib"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := ctxWithUser(e, req, rec, owner.ID)

	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	var resp libraryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Name != "My Lib" || resp.OwnerID != owner.ID.String() {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if resp.IsDefault {
		t.Fatal("Create should never produce a default library")
	}
}

func TestLibraryHandler_Create_RequiresAuth(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/libraries",
		strings.NewReader(`{"name":"X"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec) // no user set

	err := h.Create(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %v", err)
	}
}

func TestLibraryHandler_Get_NoAccess(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-get@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/libraries/"+lib.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	// no LibraryAccess set in context — handler must 404

	err := h.Get(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing access, got %v", err)
	}
}

func TestLibraryHandler_Delete_NonOwnerForbidden(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-del-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "L", false)
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/libraries/"+lib.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	// admin (not owner) attempts delete
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{
		LibraryID: lib.ID,
		Role:      access.RoleAdmin,
		IsAdmin:   true,
		IsDefault: false,
	})

	err := h.Delete(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %v", err)
	}
}

func TestLibraryHandler_Delete_DefaultBlocked(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-del-default@example.com")
	lib := mustLibrary(t, db, owner.ID, "Default", true)
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/libraries/"+lib.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{
		LibraryID: lib.ID,
		Role:      access.RoleOwner,
		IsOwner:   true,
		IsAdmin:   true,
		IsDefault: true,
	})

	err := h.Delete(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %v", err)
	}
}

func TestLibraryHandler_Delete_NonEmptyBlocked(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-del-files@example.com")
	lib := mustLibrary(t, db, owner.ID, "Has Files", false)
	if err := db.Create(&models.File{LibraryID: lib.ID, Name: "f.mp4"}).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}

	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/libraries/"+lib.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{
		LibraryID: lib.ID,
		Role:      access.RoleOwner,
		IsOwner:   true,
		IsAdmin:   true,
	})

	err := h.Delete(c)
	he, ok := err.(*echo.HTTPError)
	if !ok || he.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-empty library, got %v", err)
	}
}

func TestLibraryHandler_Delete_OwnerEmptySucceeds(t *testing.T) {
	db := libraryTestDB(t)
	e := newLibEcho()
	owner := mustUser(t, db, "lib-del-ok@example.com")
	lib := mustLibrary(t, db, owner.ID, "Empty", false)
	h := NewLibraryHandler(db, access.NewService(db), nil, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/libraries/"+lib.ID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{
		LibraryID: lib.ID,
		Role:      access.RoleOwner,
		IsOwner:   true,
		IsAdmin:   true,
	})

	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var count int64
	db.Model(&models.Library{}).Where("id = ?", lib.ID).Count(&count)
	if count != 0 {
		t.Fatalf("expected library deleted, %d rows remain", count)
	}
}
