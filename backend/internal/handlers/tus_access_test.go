package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
)

// tusCreate issues a creation-with-upload POST with custom metadata + user.
func tusCreate(t *testing.T, h *TusHandler, userID uuid.UUID, metaPairs map[string]string, data []byte) (*httptest.ResponseRecorder, error) {
	t.Helper()
	parts := make([]string, 0, len(metaPairs))
	for k, v := range metaPairs {
		parts = append(parts, encodeMetadata(k, v))
	}
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/tus", bytes.NewReader(data))
	req.Header.Set("Tus-Resumable", tusResumableVersion)
	req.Header.Set("Upload-Length", fmt.Sprintf("%d", len(data)))
	req.Header.Set("Upload-Metadata", strings.Join(parts, ","))
	req.Header.Set("Content-Type", "application/offset+octet-stream")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if userID != uuid.Nil {
		c.Set(middleware.ContextKeyUserID, userID.String())
	}
	return rec, h.Create(c)
}

func TestTus_Create_InvalidLibraryID(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	userID, _ := createTestUserAndLibrary(t, db)
	_, err := tusCreate(t, h, userID, map[string]string{"libraryId": "not-a-uuid", "filename": "f.txt"}, []byte("x"))
	if httpCode(t, err) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestTus_Create_NonMember(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	_, libraryID := createTestUserAndLibrary(t, db)
	stranger := uuid.New()
	db.Create(&models.User{ID: stranger, Email: "tus-stranger@example.com", DisplayName: "S", Role: "member"})
	_, err := tusCreate(t, h, stranger, map[string]string{"libraryId": libraryID.String(), "filename": "f.txt"}, []byte("x"))
	if httpCode(t, err) != http.StatusNotFound {
		t.Fatalf("want 404 (non-member)")
	}
}

func TestTus_Create_ViewerForbidden(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	_, libraryID := createTestUserAndLibrary(t, db)
	viewer := uuid.New()
	db.Create(&models.User{ID: viewer, Email: "tus-viewer@example.com", DisplayName: "V", Role: "member"})
	db.Create(&models.LibraryMember{ID: uuid.New(), LibraryID: libraryID, UserID: viewer, Role: "viewer"})
	_, err := tusCreate(t, h, viewer, map[string]string{"libraryId": libraryID.String(), "filename": "f.txt"}, []byte("x"))
	if httpCode(t, err) != http.StatusForbidden {
		t.Fatalf("want 403 (viewer)")
	}
}

func TestTus_Create_AdminMember(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	_, libraryID := createTestUserAndLibrary(t, db)
	admin := uuid.New()
	db.Create(&models.User{ID: admin, Email: "tus-admin@example.com", DisplayName: "A", Role: "member"})
	db.Create(&models.LibraryMember{ID: uuid.New(), LibraryID: libraryID, UserID: admin, Role: "admin"})
	rec, err := tusCreate(t, h, admin, map[string]string{"libraryId": libraryID.String(), "filename": "f.txt"}, []byte("admin-bytes"))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rec.Code)
	}
}

func TestTus_Create_LibraryNotFound(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	userID, _ := createTestUserAndLibrary(t, db)
	_, err := tusCreate(t, h, userID, map[string]string{"libraryId": uuid.New().String(), "filename": "f.txt"}, []byte("x"))
	if httpCode(t, err) != http.StatusNotFound {
		t.Fatalf("want 404 (library not found)")
	}
}

func TestTus_Create_InvalidFolderID(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)
	_, err := tusCreate(t, h, userID, map[string]string{"libraryId": libraryID.String(), "filename": "f.txt", "folderId": "bad"}, []byte("x"))
	if httpCode(t, err) != http.StatusBadRequest {
		t.Fatalf("want 400 (invalid folderId)")
	}
}

func TestTus_Create_FolderNotInLibrary(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)
	_, err := tusCreate(t, h, userID, map[string]string{"libraryId": libraryID.String(), "filename": "f.txt", "folderId": uuid.New().String()}, []byte("x"))
	if httpCode(t, err) != http.StatusBadRequest {
		t.Fatalf("want 400 (folder not in library)")
	}
}

func TestTus_Create_MissingLibraryId(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	userID, _ := createTestUserAndLibrary(t, db)
	_, err := tusCreate(t, h, userID, map[string]string{"filename": "f.txt"}, []byte("x"))
	if httpCode(t, err) != http.StatusBadRequest {
		t.Fatalf("want 400 (missing libraryId)")
	}
}

func TestTus_Create_MissingFilename(t *testing.T) {
	h, db, _ := setupTusTestHandler(t)
	userID, libraryID := createTestUserAndLibrary(t, db)
	_, err := tusCreate(t, h, userID, map[string]string{"libraryId": libraryID.String()}, []byte("x"))
	if httpCode(t, err) != http.StatusBadRequest {
		t.Fatalf("want 400 (missing filename)")
	}
}

func TestTus_Create_Unauthorized(t *testing.T) {
	h, _, _ := setupTusTestHandler(t)
	_, err := tusCreate(t, h, uuid.Nil, map[string]string{"libraryId": uuid.New().String(), "filename": "f.txt"}, []byte("x"))
	if httpCode(t, err) != http.StatusUnauthorized {
		t.Fatalf("want 401")
	}
}
