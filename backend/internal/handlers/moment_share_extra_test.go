package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func TestMomentShare_ListShares(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	if err := db.AutoMigrate(&models.MomentShare{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	db.Create(&models.MomentShare{ID: uuid.New(), MomentID: mid, LibraryID: fix.LibraryID, CreatedByID: fix.UserID, Token: uuid.New().String()})
	db.Create(&models.MomentShare{ID: uuid.New(), MomentID: mid, LibraryID: fix.LibraryID, CreatedByID: fix.UserID, Token: uuid.New().String()})
	c, rec := momentCtx(http.MethodGet, "", fix, pp(fix, fileID, mid.String()))
	if err := h.ListShares(c); err != nil {
		t.Fatalf("ListShares: %v", err)
	}
	var resp []momentShareResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2 shares, got %d", len(resp))
	}
}

func TestMomentShare_CreateShare_Enabled(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	if err := db.AutoMigrate(&models.MomentShare{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Model(&models.Library{}).Where("id = ?", fix.LibraryID).Update("sharing_enabled", true)
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, rec := momentCtx(http.MethodPost, "", fix, pp(fix, fileID, mid.String()))
	if err := h.CreateShare(c); err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rec.Code)
	}
	var resp momentShareResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Token == "" || resp.URL == "" {
		t.Fatalf("expected token+url: %+v", resp)
	}
}

func TestMomentShare_CreateShare_Disabled(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	if err := db.AutoMigrate(&models.MomentShare{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	c, _ := momentCtx(http.MethodPost, "", fix, pp(fix, fileID, mid.String()))
	if httpCode(t, h.CreateShare(c)) != http.StatusForbidden {
		t.Fatalf("want 403 (sharing disabled)")
	}
}

func TestMomentShare_RevokeShare_MissingToken(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	if err := db.AutoMigrate(&models.MomentShare{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	// token param empty
	c, _ := momentCtx(http.MethodDelete, "", fix, pp(fix, fileID, mid.String()))
	if httpCode(t, h.RevokeShare(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 (missing token)")
	}
}

func TestMomentShare_RevokeShare_Success(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	if err := db.AutoMigrate(&models.MomentShare{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	token := uuid.New().String()
	db.Create(&models.MomentShare{ID: uuid.New(), MomentID: mid, LibraryID: fix.LibraryID, CreatedByID: fix.UserID, Token: token})
	params := pp(fix, fileID, mid.String())
	params["token"] = token
	c, rec := momentCtx(http.MethodDelete, "", fix, params)
	if err := h.RevokeShare(c); err != nil {
		t.Fatalf("RevokeShare: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rec.Code)
	}
}

func TestMomentShare_RevokeShare_NotFound(t *testing.T) {
	h, db, _, fix, fileID := fullMomentHandler(t)
	if err := db.AutoMigrate(&models.MomentShare{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mid := mkMoment(t, db, fix, fileID, 1, 5)
	params := pp(fix, fileID, mid.String())
	params["token"] = "no-such-token"
	c, _ := momentCtx(http.MethodDelete, "", fix, params)
	if httpCode(t, h.RevokeShare(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}
