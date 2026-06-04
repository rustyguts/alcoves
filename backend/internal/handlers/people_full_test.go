package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func fullPeopleHandler(t *testing.T) (*PeopleHandler, *gorm.DB, *storage.Service, purgeTestFixture) {
	t.Helper()
	db := setupPurgeTestDB(t)
	if err := db.AutoMigrate(&models.Person{}, &models.FaceDetection{}); err != nil {
		t.Fatalf("migrate people: %v", err)
	}
	st := setupPurgeStorage(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })
	faceSvc := facedetection.NewService(db, st, client, &facedetection.FaceConfig{})
	h := NewPeopleHandler(db, st, faceSvc)
	fix := seedLibrary(t, db)
	return h, db, st, fix
}

func peopleCtx(method, body string, fix purgeTestFixture, params map[string]string) (echo.Context, *httptest.ResponseRecorder) {
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

func mkPerson(t *testing.T, db *gorm.DB, libID uuid.UUID, name string, faceCount int, cover *uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var namePtr *string
	if name != "" {
		namePtr = &name
	}
	p := models.Person{ID: id, LibraryID: libID, Name: namePtr, FaceCount: faceCount, CoverFaceDetectionID: cover}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("create person: %v", err)
	}
	return id
}

func mkFace(t *testing.T, db *gorm.DB, libID, fileID uuid.UUID, personID *uuid.UUID, confidence int) uuid.UUID {
	t.Helper()
	id := uuid.New()
	f := models.FaceDetection{ID: id, FileID: fileID, LibraryID: libID, PersonID: personID, BoxX: 1, BoxY: 2, BoxWidth: 3, BoxHeight: 4, ImageWidth: 100, ImageHeight: 100, Confidence: confidence}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create face: %v", err)
	}
	return id
}

func TestPeople_List(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	mkPerson(t, db, fix.LibraryID, "Alice", 3, nil)
	mkPerson(t, db, fix.LibraryID, "Bob", 1, nil)
	mkPerson(t, db, fix.LibraryID, "Zero", 0, nil) // excluded (face_count = 0)
	c, rec := peopleCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.List(c); err != nil {
		t.Fatalf("List: %v", err)
	}
	var resp []personResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2 people, got %d", len(resp))
	}
}

func TestPeople_Update_Name(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	id := mkPerson(t, db, fix.LibraryID, "", 1, nil)
	c, rec := peopleCtx(http.MethodPatch, `{"name":"Carol"}`, fix, map[string]string{"id": fix.LibraryID.String(), "personId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var p models.Person
	db.First(&p, "id = ?", id)
	if p.Name == nil || *p.Name != "Carol" {
		t.Fatalf("name not updated")
	}
}

func TestPeople_Update_Cover(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	pid := mkPerson(t, db, fix.LibraryID, "X", 1, nil)
	faceID := mkFace(t, db, fix.LibraryID, fileID, &pid, 90)
	c, _ := peopleCtx(http.MethodPatch, fmt.Sprintf(`{"coverFaceDetectionId":%q}`, faceID.String()), fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	var p models.Person
	db.First(&p, "id = ?", pid)
	if p.CoverFaceDetectionID == nil {
		t.Fatalf("cover not set")
	}
}

func TestPeople_Update_ClearCover(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	faceID := mkFace(t, db, fix.LibraryID, fileID, nil, 90)
	pid := mkPerson(t, db, fix.LibraryID, "X", 1, &faceID)
	c, _ := peopleCtx(http.MethodPatch, `{"coverFaceDetectionId":""}`, fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	var p models.Person
	db.First(&p, "id = ?", pid)
	if p.CoverFaceDetectionID != nil {
		t.Fatalf("cover not cleared")
	}
}

func TestPeople_Update_NoFields(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	id := mkPerson(t, db, fix.LibraryID, "X", 1, nil)
	c, _ := peopleCtx(http.MethodPatch, `{}`, fix, map[string]string{"id": fix.LibraryID.String(), "personId": id.String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestPeople_Update_NotFound(t *testing.T) {
	h, _, _, fix := fullPeopleHandler(t)
	c, _ := peopleCtx(http.MethodPatch, `{"name":"X"}`, fix, map[string]string{"id": fix.LibraryID.String(), "personId": uuid.New().String()})
	if httpCode(t, h.Update(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestPeople_Update_BadBody(t *testing.T) {
	h, _, _, fix := fullPeopleHandler(t)
	c, _ := peopleCtx(http.MethodPatch, `{bad`, fix, map[string]string{"id": fix.LibraryID.String(), "personId": uuid.New().String()})
	if httpCode(t, h.Update(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestPeople_ListFaces(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	pid := mkPerson(t, db, fix.LibraryID, "X", 2, nil)
	mkFace(t, db, fix.LibraryID, fileID, &pid, 90)
	mkFace(t, db, fix.LibraryID, fileID, &pid, 80)
	c, rec := peopleCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String()})
	if err := h.ListFaces(c); err != nil {
		t.Fatalf("ListFaces: %v", err)
	}
	var resp []faceResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp) != 2 {
		t.Fatalf("expected 2 faces, got %d", len(resp))
	}
}

func TestPeople_Thumbnail_NoCover(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	pid := mkPerson(t, db, fix.LibraryID, "X", 1, nil)
	c, _ := peopleCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String()})
	if httpCode(t, h.Thumbnail(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestPeople_Thumbnail_PersonNotFound(t *testing.T) {
	h, _, _, fix := fullPeopleHandler(t)
	c, _ := peopleCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": uuid.New().String()})
	if httpCode(t, h.Thumbnail(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestPeople_Thumbnail_Cached(t *testing.T) {
	h, db, st, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	faceID := mkFace(t, db, fix.LibraryID, fileID, nil, 90)
	pid := mkPerson(t, db, fix.LibraryID, "X", 1, &faceID)
	cacheKey := fmt.Sprintf("%s/faces/%s.webp", fix.LibraryID.String(), faceID.String())
	st.StoreCacheBuffer(cacheKey, []byte("facecrop"))
	c, rec := peopleCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String()})
	if err := h.Thumbnail(c); err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "facecrop" {
		t.Fatalf("want 200 facecrop, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestPeople_Thumbnail_NotCached(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	faceID := mkFace(t, db, fix.LibraryID, fileID, nil, 90)
	pid := mkPerson(t, db, fix.LibraryID, "X", 1, &faceID)
	c, _ := peopleCtx(http.MethodGet, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String()})
	if httpCode(t, h.Thumbnail(c)) != http.StatusNotFound {
		t.Fatalf("want 404 (no cache)")
	}
}

func TestPeople_SplitFace(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	pid := mkPerson(t, db, fix.LibraryID, "X", 2, nil)
	f1 := mkFace(t, db, fix.LibraryID, fileID, &pid, 90)
	mkFace(t, db, fix.LibraryID, fileID, &pid, 80)
	// make f1 the cover
	db.Model(&models.Person{}).Where("id = ?", pid).Update("cover_face_detection_id", f1)
	c, rec := peopleCtx(http.MethodPost, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String(), "faceId": f1.String()})
	if err := h.SplitFace(c); err != nil {
		t.Fatalf("SplitFace: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["newPersonId"] == nil {
		t.Fatalf("no newPersonId")
	}
	// old person should now have the other face as cover
	var p models.Person
	db.First(&p, "id = ?", pid)
	if p.FaceCount != 1 {
		t.Fatalf("expected face_count 1, got %d", p.FaceCount)
	}
}

func TestPeople_SplitFace_LastFace(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	pid := mkPerson(t, db, fix.LibraryID, "X", 1, nil)
	f1 := mkFace(t, db, fix.LibraryID, fileID, &pid, 90)
	db.Model(&models.Person{}).Where("id = ?", pid).Update("cover_face_detection_id", f1)
	c, _ := peopleCtx(http.MethodPost, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String(), "faceId": f1.String()})
	if err := h.SplitFace(c); err != nil {
		t.Fatalf("SplitFace: %v", err)
	}
	var p models.Person
	db.First(&p, "id = ?", pid)
	if p.CoverFaceDetectionID != nil {
		t.Fatalf("cover should be cleared when no faces remain")
	}
}

func TestPeople_SplitFace_NotFound(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	pid := mkPerson(t, db, fix.LibraryID, "X", 1, nil)
	c, _ := peopleCtx(http.MethodPost, "", fix, map[string]string{"id": fix.LibraryID.String(), "personId": pid.String(), "faceId": uuid.New().String()})
	if httpCode(t, h.SplitFace(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestPeople_Merge(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	fileID := createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	target := mkPerson(t, db, fix.LibraryID, "", 1, nil)
	source := mkPerson(t, db, fix.LibraryID, "Named", 1, nil)
	mkFace(t, db, fix.LibraryID, fileID, &target, 90)
	mkFace(t, db, fix.LibraryID, fileID, &source, 80)
	body := fmt.Sprintf(`{"personIds":[%q,%q]}`, target.String(), source.String())
	c, rec := peopleCtx(http.MethodPost, body, fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Merge(c); err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
	var p models.Person
	db.First(&p, "id = ?", target)
	if p.FaceCount != 2 {
		t.Fatalf("expected merged face_count 2, got %d", p.FaceCount)
	}
	if p.Name == nil || *p.Name != "Named" {
		t.Fatalf("expected name inherited from source")
	}
	// source deleted
	var cnt int64
	db.Model(&models.Person{}).Where("id = ?", source).Count(&cnt)
	if cnt != 0 {
		t.Fatalf("source not deleted")
	}
}

func TestPeople_Merge_TooFew(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	p := mkPerson(t, db, fix.LibraryID, "X", 1, nil)
	body := fmt.Sprintf(`{"personIds":[%q]}`, p.String())
	c, _ := peopleCtx(http.MethodPost, body, fix, map[string]string{"id": fix.LibraryID.String()})
	if h.Merge(c) == nil {
		t.Fatalf("expected error for <2 ids")
	}
}

func TestPeople_Merge_NotFound(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	p := mkPerson(t, db, fix.LibraryID, "X", 1, nil)
	body := fmt.Sprintf(`{"personIds":[%q,%q]}`, p.String(), uuid.New().String())
	c, _ := peopleCtx(http.MethodPost, body, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Merge(c)) != http.StatusNotFound {
		t.Fatalf("want 404")
	}
}

func TestPeople_Merge_BadBody(t *testing.T) {
	h, _, _, fix := fullPeopleHandler(t)
	c, _ := peopleCtx(http.MethodPost, `{bad`, fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Merge(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestPeople_Reprocess_NilSvc(t *testing.T) {
	db := setupPurgeTestDB(t)
	st := setupPurgeStorage(t)
	h := NewPeopleHandler(db, st, nil)
	fix := seedLibrary(t, db)
	c, _ := peopleCtx(http.MethodPost, "", fix, map[string]string{"id": fix.LibraryID.String()})
	if httpCode(t, h.Reprocess(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}

func TestPeople_Reprocess_OK(t *testing.T) {
	h, db, _, fix := fullPeopleHandler(t)
	// an image file to potentially reprocess
	createFile(t, db, fix.LibraryID, fix.UserID, "f.jpg", false, nil)
	c, rec := peopleCtx(http.MethodPost, "", fix, map[string]string{"id": fix.LibraryID.String()})
	if err := h.Reprocess(c); err != nil {
		t.Fatalf("Reprocess: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}
