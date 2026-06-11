package handlers

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	gormpostgres "gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// assertNotFound asserts that err is a 404 echo.HTTPError with the
// "File not found" message, matching the helpers' contract.
func assertNotFound(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	he, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %T (%v)", err, err)
	}
	if he.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, he.Code)
	}
	if he.Message != "File not found" {
		t.Fatalf("expected message %q, got %q", "File not found", he.Message)
	}
}

func TestFindActiveFile(t *testing.T) {
	db := setupPurgeTestDB(t)
	fx := seedLibrary(t, db)

	activeID := createFile(t, db, fx.LibraryID, fx.UserID, "active.jpg", false, nil)
	trashedID := createFile(t, db, fx.LibraryID, fx.UserID, "trashed.jpg", true, nil)

	t.Run("returns active file", func(t *testing.T) {
		file, err := findActiveFile(db, fx.LibraryID.String(), activeID.String())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if file == nil || file.ID != activeID {
			t.Fatalf("expected file %s, got %+v", activeID, file)
		}
	})

	t.Run("404 for trashed file", func(t *testing.T) {
		file, err := findActiveFile(db, fx.LibraryID.String(), trashedID.String())
		if file != nil {
			t.Fatalf("expected nil file, got %+v", file)
		}
		assertNotFound(t, err)
	})

	t.Run("404 for wrong library", func(t *testing.T) {
		otherLib := uuid.New().String()
		file, err := findActiveFile(db, otherLib, activeID.String())
		if file != nil {
			t.Fatalf("expected nil file, got %+v", file)
		}
		assertNotFound(t, err)
	})
}

func TestFindFileAnyState(t *testing.T) {
	db := setupPurgeTestDB(t)
	fx := seedLibrary(t, db)

	trashedID := createFile(t, db, fx.LibraryID, fx.UserID, "trashed.jpg", true, nil)

	t.Run("returns trashed file (ignores trash state)", func(t *testing.T) {
		file, err := findFileAnyState(db, fx.LibraryID.String(), trashedID.String())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if file == nil || file.ID != trashedID {
			t.Fatalf("expected file %s, got %+v", trashedID, file)
		}
		if file.TrashedAt == nil {
			t.Fatalf("expected trashed_at to be set on loaded file")
		}
	})

	t.Run("404 for wrong library", func(t *testing.T) {
		otherLib := uuid.New().String()
		file, err := findFileAnyState(db, otherLib, trashedID.String())
		if file != nil {
			t.Fatalf("expected nil file, got %+v", file)
		}
		assertNotFound(t, err)
	})
}

func TestInternalError(t *testing.T) {
	cause := errors.New("pq: connection refused")
	he := internalError("Failed to do thing", cause)

	if he.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, he.Code)
	}
	if he.Message != "Failed to do thing" {
		t.Fatalf("expected message %q, got %q", "Failed to do thing", he.Message)
	}
	if he.Internal != cause {
		t.Fatalf("expected Internal to carry the cause %v, got %v", cause, he.Internal)
	}
	// The cause must be reachable through the Unwrap chain so errors.Is/As and
	// Sentry's exception-chain capture see the root cause.
	if !errors.Is(he, cause) {
		t.Fatalf("expected errors.Is(he, cause) to hold")
	}
}

// TestInternalErrorRendersSameResponse proves the wire format did not move:
// Echo renders Message, never Internal, so internalError(msg, err) produces a
// byte-identical HTTP response to the old echo.NewHTTPError(500, msg).
func TestInternalErrorRendersSameResponse(t *testing.T) {
	e := echo.New()
	render := func(err error) (int, string) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		e.HTTPErrorHandler(err, c)
		return rec.Code, rec.Body.String()
	}

	oldCode, oldBody := render(echo.NewHTTPError(http.StatusInternalServerError, "Failed to do thing"))
	newCode, newBody := render(internalError("Failed to do thing", errors.New("pq: connection refused")))

	if newCode != oldCode {
		t.Fatalf("status changed: old %d, new %d", oldCode, newCode)
	}
	if newBody != oldBody {
		t.Fatalf("body changed:\nold: %s\nnew: %s", oldBody, newBody)
	}
	if strings.Contains(newBody, "connection refused") {
		t.Fatalf("internal cause leaked into the client response: %s", newBody)
	}
}

// TestHandler500CarriesInternalCause is a representative handler-level check:
// a forced DB failure path returns the unchanged generic 500 message while the
// HTTPError now carries the underlying cause for logs/Sentry.
func TestHandler500CarriesInternalCause(t *testing.T) {
	db, err := gorm.Open(gormpostgres.Open(testsupport.BaseDSN), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	_ = sqlDB.Close() // force every subsequent query to fail

	h := NewHighlightFilterHandler(db)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())

	err = h.List(c)
	he, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %T (%v)", err, err)
	}
	if he.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, he.Code)
	}
	if he.Message != "Failed to list highlight filters" {
		t.Fatalf("expected unchanged message, got %q", he.Message)
	}
	if he.Internal == nil {
		t.Fatalf("expected Internal to carry the DB error, got nil")
	}
}
