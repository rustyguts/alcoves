package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
)

func fullHFHandler(t *testing.T) (*HighlightFilterHandler, *gorm.DB, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	if err := db.AutoMigrate(&models.HighlightFilter{}); err != nil {
		t.Fatalf("migrate highlight_filters: %v", err)
	}
	h := NewHighlightFilterHandler(db)
	fix := seedLibrary(t, db)
	return h, db, fix
}

func hfCtx(method, body string, fix purgeTestFixture, params map[string]string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	e.Validator = NewValidator()
	req := httptest.NewRequest(method, "/", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	names := make([]string, 0, len(params))
	vals := make([]string, 0, len(params))
	for k, v := range params {
		names = append(names, k)
		vals = append(vals, v)
	}
	c.SetParamNames(names...)
	c.SetParamValues(vals...)
	c.Set(middleware.ContextKeyUserID, fix.UserID.String())
	c.Set(middleware.ContextKeyLibraryAccess, &access.LibraryAccess{LibraryID: fix.LibraryID, OwnerID: fix.UserID, IsOwner: true})
	return c, rec
}

func mkHF(t *testing.T, db *gorm.DB, libID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	f := models.HighlightFilter{BaseModel: models.BaseModel{ID: id}, LibraryID: libID, Name: name, Expression: "word:hello", ProximitySeconds: 5, Color: "#3B82F6"}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create hf: %v", err)
	}
	return id
}

func TestHF_List(t *testing.T) {
	h, db, fix := fullHFHandler(t)
	mkHF(t, db, fix.LibraryID, "A")
	mkHF(t, db, fix.LibraryID, "B")
	c, rec := hfCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.List(c); err != nil {
		t.Fatalf("List: %v", err)
	}
	var resp []map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2, got %d", len(resp))
	}
}

func TestHF_Create(t *testing.T) {
	h, _, fix := fullHFHandler(t)
	c, rec := hfCtx(http.MethodPost, `{"name":"Goals","expression":"word:goal","proximitySeconds":90,"color":"#ff0000"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	// proximity should be clamped to 60
	if resp["proximitySeconds"].(float64) != 60 {
		t.Fatalf("expected clamp to 60, got %v", resp["proximitySeconds"])
	}
}

func TestHF_Create_Defaults(t *testing.T) {
	h, _, fix := fullHFHandler(t)
	c, rec := hfCtx(http.MethodPost, `{"name":"X","expression":"word:x"}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["proximitySeconds"].(float64) != 5 || resp["color"] != "#3B82F6" {
		t.Fatalf("defaults wrong: %v", resp)
	}
}

func TestHF_Create_Validation(t *testing.T) {
	h, _, fix := fullHFHandler(t)
	c, _ := hfCtx(http.MethodPost, `{"name":"","expression":""}`, fix, map[string]string{"id": fix.LibraryID.String()})
	if h.Create(c) == nil {
		t.Fatalf("expected validation error")
	}
}

func TestHF_Create_InvalidLibrary(t *testing.T) {
	h, _, fix := fullHFHandler(t)
	c, _ := hfCtx(http.MethodPost, `{"name":"X","expression":"y"}`, fix, map[string]string{"id": "bad"})
	if httpCode(t, h.Create(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestHF_Update(t *testing.T) {
	h, db, fix := fullHFHandler(t)
	id := mkHF(t, db, fix.LibraryID, "old")
	c, rec := hfCtx(http.MethodPatch, `{"name":"new","expression":"word:z","proximitySeconds":100,"color":"#000"}`, fix, map[string]string{"id": fix.LibraryID.String(), "filterId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var f models.HighlightFilter
	db.First(&f, "id = ?", id)
	if f.Name != "new" || f.ProximitySeconds != 60 {
		t.Fatalf("update failed: %+v", f)
	}
}

func TestHF_Update_EmptyName(t *testing.T) {
	h, db, fix := fullHFHandler(t)
	id := mkHF(t, db, fix.LibraryID, "old")
	c, _ := hfCtx(http.MethodPatch, `{"name":"  "}`, fix, map[string]string{"id": fix.LibraryID.String(), "filterId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestHF_Update_EmptyExpression(t *testing.T) {
	h, db, fix := fullHFHandler(t)
	id := mkHF(t, db, fix.LibraryID, "old")
	c, _ := hfCtx(http.MethodPatch, `{"expression":"   "}`, fix, map[string]string{"id": fix.LibraryID.String(), "filterId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestHF_Update_NoFields(t *testing.T) {
	h, db, fix := fullHFHandler(t)
	id := mkHF(t, db, fix.LibraryID, "old")
	c, _ := hfCtx(http.MethodPatch, `{}`, fix, map[string]string{"id": fix.LibraryID.String(), "filterId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestHF_Update_NotFound(t *testing.T) {
	h, _, fix := fullHFHandler(t)
	c, _ := hfCtx(http.MethodPatch, `{"name":"x"}`, fix, map[string]string{"id": fix.LibraryID.String(), "filterId": uuid.New().String()})
	if httpCode(t, h.Update(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestHF_Delete(t *testing.T) {
	h, db, fix := fullHFHandler(t)
	id := mkHF(t, db, fix.LibraryID, "x")
	c, rec := hfCtx(http.MethodDelete, "", fix, map[string]string{"id": fix.LibraryID.String(), "filterId": id.String()})
	if err := h.Delete(c); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestHF_Delete_NotFound(t *testing.T) {
	h, _, fix := fullHFHandler(t)
	c, _ := hfCtx(http.MethodDelete, "", fix, map[string]string{"id": fix.LibraryID.String(), "filterId": uuid.New().String()})
	if httpCode(t, h.Delete(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestHF_ClampProximity(t *testing.T) {
	if clampProximity(-5) != 0 || clampProximity(100) != 60 || clampProximity(30) != 30 {
		t.Fatalf("clampProximity wrong")
	}
}
