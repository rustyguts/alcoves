package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/docs"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func documentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := libraryTestDB(t)
	if err := db.AutoMigrate(&models.Document{}, &models.DocumentUpdate{}); err != nil {
		t.Fatalf("migrate doc tables: %v", err)
	}
	db.Exec("TRUNCATE TABLE documents, document_updates RESTART IDENTITY CASCADE")
	return db
}

func documentTestStorage(t *testing.T) *storage.Service {
	t.Helper()
	st := storage.NewService(storage.NewLocalDriver(t.TempDir(), t.TempDir(), t.TempDir()))
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("storage EnsureReady: %v", err)
	}
	return st
}

func mustMarkdownFileRow(t *testing.T, db *gorm.DB, lib models.Library, name string) models.File {
	t.Helper()
	f := models.File{LibraryID: lib.ID, Name: name, MimeType: "text/markdown"}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	return f
}

// docCtx builds an echo context with auth + library-access injected the way
// AuthMiddleware and LibraryAccessMiddleware would. The middleware's
// method-based role split (GET→viewer+, else→admin+) has its own coverage —
// handler tests inject the resolved access directly.
func docCtx(e *echo.Echo, method, path string, body string, userID uuid.UUID, acc *access.LibraryAccess, libID, fileID uuid.UUID) (echo.Context, *httptest.ResponseRecorder) {
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, userID.String())
	c.Set(middleware.ContextKeyLibraryAccess, acc)
	c.SetParamNames("id", "fileId")
	c.SetParamValues(libID.String(), fileID.String())
	return c, rec
}

func adminAccess(lib models.Library) *access.LibraryAccess {
	return &access.LibraryAccess{LibraryID: lib.ID, Role: access.RoleAdmin, IsAdmin: true}
}

func viewerAccess(lib models.Library) *access.LibraryAccess {
	return &access.LibraryAccess{LibraryID: lib.ID, Role: access.RoleViewer}
}

func b64JSON(data []byte) string {
	b, _ := json.Marshal(data)
	return string(b)
}

func TestDocumentGetState_UnseededReturnsTextAndRole(t *testing.T) {
	db := documentTestDB(t)
	st := documentTestStorage(t)
	e := newLibEcho()
	h := NewDocumentHandler(docs.NewService(db, st, nil, nil), nil, nil)

	owner := mustUser(t, db, "doc-owner@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)
	file := mustMarkdownFileRow(t, db, lib, "notes.md")
	if err := st.StoreFile(lib.ID.String(), file.ID.String(), []byte("# Seed me")); err != nil {
		t.Fatalf("store blob: %v", err)
	}

	c, rec := docCtx(e, http.MethodGet, "/", "", owner.ID, adminAccess(lib), lib.ID, file.ID)
	if err := h.GetState(c); err != nil {
		t.Fatalf("GetState: %v", err)
	}
	var resp docStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Exists || resp.Text != "# Seed me" || resp.Role != "editor" {
		t.Fatalf("resp = %+v, want exists=false text='# Seed me' role=editor", resp)
	}

	// Viewer role reduction.
	c, rec = docCtx(e, http.MethodGet, "/", "", owner.ID, viewerAccess(lib), lib.ID, file.ID)
	if err := h.GetState(c); err != nil {
		t.Fatalf("GetState viewer: %v", err)
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Role != "viewer" {
		t.Fatalf("role = %q, want viewer", resp.Role)
	}
}

func TestDocumentInitAppendGetRoundtrip(t *testing.T) {
	db := documentTestDB(t)
	e := newLibEcho()
	h := NewDocumentHandler(docs.NewService(db, documentTestStorage(t), nil, nil), nil, nil)

	owner := mustUser(t, db, "doc-rt@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)
	file := mustMarkdownFileRow(t, db, lib, "notes.md")

	c, rec := docCtx(e, http.MethodPost, "/", fmt.Sprintf(`{"update":%s}`, b64JSON([]byte{1, 2})), owner.ID, adminAccess(lib), lib.ID, file.ID)
	if err := h.Init(c); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("init status = %d body=%s, want 201", rec.Code, rec.Body)
	}

	c, rec = docCtx(e, http.MethodPost, "/", fmt.Sprintf(`{"data":%s}`, b64JSON([]byte{3})), owner.ID, adminAccess(lib), lib.ID, file.ID)
	if err := h.Append(c); err != nil {
		t.Fatalf("Append: %v", err)
	}
	var appendResp map[string]int64
	_ = json.Unmarshal(rec.Body.Bytes(), &appendResp)
	if appendResp["seq"] != 2 {
		t.Fatalf("append seq = %d, want 2", appendResp["seq"])
	}

	c, rec = docCtx(e, http.MethodGet, "/", "", owner.ID, adminAccess(lib), lib.ID, file.ID)
	if err := h.GetState(c); err != nil {
		t.Fatalf("GetState: %v", err)
	}
	var state docStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !state.Exists || state.Seq != 2 || len(state.Updates) != 2 {
		t.Fatalf("state = %+v, want exists seq=2 two updates", state)
	}
	if !bytes.Equal(state.Updates[0].Data, []byte{1, 2}) || !bytes.Equal(state.Updates[1].Data, []byte{3}) {
		t.Fatalf("update data roundtrip failed: %+v", state.Updates)
	}

	// Replay with ?since=1.
	c, rec = docCtx(e, http.MethodGet, "/?since=1", "", owner.ID, adminAccess(lib), lib.ID, file.ID)
	if err := h.ListUpdates(c); err != nil {
		t.Fatalf("ListUpdates: %v", err)
	}
	var page struct {
		Seq     int64           `json:"seq"`
		Updates []docUpdateJSON `json:"updates"`
		HasMore bool            `json:"hasMore"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if page.Seq != 2 || len(page.Updates) != 1 || page.Updates[0].Seq != 2 {
		t.Fatalf("page = %+v, want seq=2 one update", page)
	}
}

func TestDocumentInit_ConflictReturnsWinnerState(t *testing.T) {
	db := documentTestDB(t)
	e := newLibEcho()
	svc := docs.NewService(db, documentTestStorage(t), nil, nil)
	h := NewDocumentHandler(svc, nil, nil)

	owner := mustUser(t, db, "doc-conflict@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)
	file := mustMarkdownFileRow(t, db, lib, "notes.md")

	if conflicted, _, err := svc.Init(context.Background(), lib.ID, file.ID, owner.ID, []byte{9, 9}); err != nil || conflicted {
		t.Fatalf("pre-seed Init: conflicted=%v err=%v", conflicted, err)
	}

	c, rec := docCtx(e, http.MethodPost, "/", fmt.Sprintf(`{"update":%s}`, b64JSON([]byte{1})), owner.ID, adminAccess(lib), lib.ID, file.ID)
	if err := h.Init(c); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	var winner docStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &winner); err != nil {
		t.Fatalf("unmarshal winner: %v", err)
	}
	if !winner.Exists || winner.Seq != 1 || len(winner.Updates) != 1 || !bytes.Equal(winner.Updates[0].Data, []byte{9, 9}) {
		t.Fatalf("winner = %+v, want the pre-seeded state", winner)
	}
}

func TestDocumentSnapshot_MaterializesAndGuards(t *testing.T) {
	db := documentTestDB(t)
	st := documentTestStorage(t)
	e := newLibEcho()
	svc := docs.NewService(db, st, nil, nil)
	h := NewDocumentHandler(svc, nil, nil)

	owner := mustUser(t, db, "doc-snap@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)
	file := mustMarkdownFileRow(t, db, lib, "notes.md")

	if conflicted, _, err := svc.Init(context.Background(), lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}

	body := fmt.Sprintf(`{"snapshot":%s,"upTo":1,"text":"# Materialized"}`, b64JSON([]byte{0xCC}))
	c, rec := docCtx(e, http.MethodPut, "/", body, owner.ID, adminAccess(lib), lib.ID, file.ID)
	if err := h.Snapshot(c); err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s, want 200", rec.Code, rec.Body)
	}
	blob, err := st.ReadFileBuffer(lib.ID.String(), file.ID.String())
	if err != nil || string(blob) != "# Materialized" {
		t.Fatalf("blob = %q err=%v", blob, err)
	}

	// Identical retry is stale → 409 (benign for clients).
	c, _ = docCtx(e, http.MethodPut, "/", body, owner.ID, adminAccess(lib), lib.ID, file.ID)
	err = h.Snapshot(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusConflict {
		t.Fatalf("stale snapshot err = %v, want 409", err)
	}
}

func TestDocumentValidation(t *testing.T) {
	db := documentTestDB(t)
	e := newLibEcho()
	h := NewDocumentHandler(docs.NewService(db, documentTestStorage(t), nil, nil), nil, nil)

	owner := mustUser(t, db, "doc-val@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)

	png := models.File{LibraryID: lib.ID, Name: "photo.png", MimeType: "image/png"}
	if err := db.Create(&png).Error; err != nil {
		t.Fatalf("create png: %v", err)
	}
	c, _ := docCtx(e, http.MethodGet, "/", "", owner.ID, adminAccess(lib), lib.ID, png.ID)
	err := h.GetState(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("non-markdown err = %v, want 415", err)
	}

	file := mustMarkdownFileRow(t, db, lib, "notes.md")

	// Invalid base64 fails the bind → 400.
	c, _ = docCtx(e, http.MethodPost, "/", `{"data":"!!!not-base64!!!"}`, owner.ID, adminAccess(lib), lib.ID, file.ID)
	err = h.Append(c)
	httpErr, ok = err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusBadRequest {
		t.Fatalf("bad base64 err = %v, want 400", err)
	}

	// Append before init → 409.
	c, _ = docCtx(e, http.MethodPost, "/", fmt.Sprintf(`{"data":%s}`, b64JSON([]byte{1})), owner.ID, adminAccess(lib), lib.ID, file.ID)
	err = h.Append(c)
	httpErr, ok = err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusConflict {
		t.Fatalf("append-before-init err = %v, want 409", err)
	}

	// Bad ?since= → 400.
	c, _ = docCtx(e, http.MethodGet, "/?since=banana", "", owner.ID, adminAccess(lib), lib.ID, file.ID)
	err = h.ListUpdates(c)
	httpErr, ok = err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusBadRequest {
		t.Fatalf("bad since err = %v, want 400", err)
	}

	// Unknown file → 404.
	c, _ = docCtx(e, http.MethodGet, "/", "", owner.ID, adminAccess(lib), lib.ID, uuid.New())
	err = h.GetState(c)
	httpErr, ok = err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusNotFound {
		t.Fatalf("missing file err = %v, want 404", err)
	}
}

// TestDocumentCreate_ViaUploadWithEncodedName covers the "New Document" path:
// the frontend creates an empty markdown file through the direct-upload
// endpoint with a URI-encoded name (browsers reject non-ISO-8859-1 headers).
func TestDocumentCreate_ViaUploadWithEncodedName(t *testing.T) {
	db := documentTestDB(t)
	st := documentTestStorage(t)
	e := newLibEcho()
	ingest := files.NewServiceWithIngest(db, files.IngestDeps{Storage: st})
	fh := NewFileHandler(db, ingest, st, nil, nil, nil, nil, nil, nil)
	dh := NewDocumentHandler(docs.NewService(db, st, nil, nil), nil, nil)

	owner := mustUser(t, db, "doc-create@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("X-Upload-Name", "r%C3%A9sum%C3%A9%20notes.md") // encodeURIComponent("résumé notes.md")
	req.Header.Set("X-Upload-Name-Encoded", "1")
	req.Header.Set("X-Upload-Mime-Type", "text/markdown")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyUserID, owner.ID.String())
	c.SetParamNames("id")
	c.SetParamValues(lib.ID.String())

	if err := fh.Upload(c); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	var created models.File
	if err := db.Where("library_id = ? AND mime_type = ?", lib.ID, "text/markdown").First(&created).Error; err != nil {
		t.Fatalf("load created file: %v", err)
	}
	if created.Name != "résumé notes.md" {
		t.Fatalf("name = %q, want decoded 'résumé notes.md'", created.Name)
	}
	if created.Size != 0 {
		t.Fatalf("size = %d, want 0 (empty document)", created.Size)
	}

	// The fresh empty document opens unseeded with empty text.
	dc, drec := docCtx(e, http.MethodGet, "/", "", owner.ID, adminAccess(lib), lib.ID, created.ID)
	if err := dh.GetState(dc); err != nil {
		t.Fatalf("GetState on new doc: %v", err)
	}
	var state docStateResponse
	_ = json.Unmarshal(drec.Body.Bytes(), &state)
	if state.Exists || state.Text != "" {
		t.Fatalf("new doc state = %+v, want exists=false empty text", state)
	}
}

func TestDocumentServeWS_DisabledWithoutHub(t *testing.T) {
	db := documentTestDB(t)
	e := newLibEcho()
	h := NewDocumentHandler(docs.NewService(db, documentTestStorage(t), nil, nil), nil, nil)

	owner := mustUser(t, db, "doc-ws-off@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)
	file := mustMarkdownFileRow(t, db, lib, "notes.md")

	c, _ := docCtx(e, http.MethodGet, "/", "", owner.ID, viewerAccess(lib), lib.ID, file.ID)
	err := h.ServeWS(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusServiceUnavailable {
		t.Fatalf("ServeWS without hub err = %v, want 503", err)
	}
}

// TestDocumentServeWS_EndToEnd upgrades through a real Echo server: hello
// frame carries the current seq, and an HTTP append fans out to the socket.
func TestDocumentServeWS_EndToEnd(t *testing.T) {
	db := documentTestDB(t)
	st := documentTestStorage(t)
	hub := docs.NewHub()
	rt := docs.NewRealtime(hub, nil)
	svc := docs.NewService(db, st, nil, rt)
	h := NewDocumentHandler(svc, hub, rt)

	owner := mustUser(t, db, "doc-ws@example.com")
	lib := mustLibrary(t, db, owner.ID, "Docs", false)
	file := mustMarkdownFileRow(t, db, lib, "notes.md")
	if conflicted, _, err := svc.Init(context.Background(), lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}

	e := newLibEcho()
	g := e.Group("/api/libraries", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(middleware.ContextKeyUserID, owner.ID.String())
			c.Set(middleware.ContextKeyLibraryAccess, adminAccess(lib))
			return next(c)
		}
	})
	h.RegisterRoutes(g)
	srv := httptest.NewServer(e)
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsURL := fmt.Sprintf("ws%s/api/libraries/%s/files/%s/doc/ws",
		strings.TrimPrefix(srv.URL, "http"), lib.ID, file.ID)
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "done") })

	readWS := func() docs.Frame {
		t.Helper()
		rctx, rcancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rcancel()
		_, data, err := conn.Read(rctx)
		if err != nil {
			t.Fatalf("ws read: %v", err)
		}
		var f docs.Frame
		if err := json.Unmarshal(data, &f); err != nil {
			t.Fatalf("ws frame %q: %v", data, err)
		}
		return f
	}

	if hello := readWS(); hello.Type != "hello" || hello.Seq != 1 {
		t.Fatalf("hello = %+v, want type=hello seq=1", hello)
	}

	// An append through the service (as the HTTP handler would do) reaches
	// the socket as an update frame.
	seq, err := svc.AppendUpdate(context.Background(), lib.ID, file.ID, owner.ID, []byte{7, 7})
	if err != nil || seq != 2 {
		t.Fatalf("AppendUpdate: seq=%d err=%v", seq, err)
	}
	if f := readWS(); f.Type != "update" || f.Seq != 2 || !bytes.Equal(f.Data, []byte{7, 7}) {
		t.Fatalf("update frame = %+v, want seq=2 data=[7 7]", f)
	}
}
