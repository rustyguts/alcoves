package handlers

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
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
