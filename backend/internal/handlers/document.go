package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/services/docs"
)

// DocumentHandler exposes the Live Documents endpoints: CRDT sync state,
// update append/replay, client-computed compaction, and the per-document
// WebSocket. LibraryAccessMiddleware already enforces the role split — GET
// (state, replay, WS upgrade) needs viewer+, POST/PUT (init, append,
// snapshot) needs admin+ — so viewer read-only comes for free.
type DocumentHandler struct {
	docsSvc *docs.Service
	hub     *docs.Hub
	rt      *docs.Realtime
}

func NewDocumentHandler(docsSvc *docs.Service, hub *docs.Hub, rt *docs.Realtime) *DocumentHandler {
	return &DocumentHandler{docsSvc: docsSvc, hub: hub, rt: rt}
}

func (h *DocumentHandler) RegisterRoutes(g *echo.Group) {
	// Body limits bound the base64+JSON envelope around the decoded-size caps
	// the service enforces (updates ≤256KiB, snapshot+text ≤16MiB each).
	updateLimit := echomw.BodyLimit("1M")
	snapshotLimit := echomw.BodyLimit("48M")

	g.GET("/:id/files/:fileId/doc", h.GetState)
	g.GET("/:id/files/:fileId/doc/updates", h.ListUpdates)
	g.GET("/:id/files/:fileId/doc/ws", h.ServeWS)
	g.POST("/:id/files/:fileId/doc/init", h.Init, updateLimit)
	g.POST("/:id/files/:fileId/doc/updates", h.Append, updateLimit)
	g.PUT("/:id/files/:fileId/doc/snapshot", h.Snapshot, snapshotLimit)
}

// docUpdateJSON rides []byte fields through encoding/json's base64 handling:
// responses carry base64 strings, and malformed base64 in requests fails the
// bind with a 400.
type docUpdateJSON struct {
	Seq  int64  `json:"seq"`
	Data []byte `json:"data"`
}

type docStateResponse struct {
	Exists      bool            `json:"exists"`
	Role        string          `json:"role"`
	Seq         int64           `json:"seq"`
	SnapshotSeq int64           `json:"snapshotSeq"`
	Snapshot    []byte          `json:"snapshot"`
	Updates     []docUpdateJSON `json:"updates"`
	HasMore     bool            `json:"hasMore"`
	Text        string          `json:"text,omitempty"`
}

type docInitRequest struct {
	Update []byte `json:"update"`
}

type docAppendRequest struct {
	Data []byte `json:"data"`
}

type docSnapshotRequest struct {
	Snapshot []byte `json:"snapshot"`
	UpTo     int64  `json:"upTo"`
	Text     string `json:"text"`
}

func parseDocParams(c echo.Context) (libraryID, fileID uuid.UUID, err error) {
	libraryID, err = uuid.Parse(c.Param("id"))
	if err != nil {
		return uuid.Nil, uuid.Nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	fileID, err = uuid.Parse(c.Param("fileId"))
	if err != nil {
		return uuid.Nil, uuid.Nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid file ID")
	}
	return libraryID, fileID, nil
}

// docRole reduces the library role to the document role the client needs:
// owner/admin edit, viewer reads.
func docRole(c echo.Context) string {
	if acc := middleware.GetLibraryAccess(c); acc != nil && acc.IsAdmin {
		return "editor"
	}
	return "viewer"
}

func mapDocsError(err error) error {
	switch {
	case errors.Is(err, docs.ErrFileNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	case errors.Is(err, docs.ErrNotMarkdown):
		return echo.NewHTTPError(http.StatusUnsupportedMediaType, "File is not a markdown document")
	case errors.Is(err, docs.ErrTrashed):
		return echo.NewHTTPError(http.StatusConflict, "File is in the trash")
	case errors.Is(err, docs.ErrNotInitialized):
		return echo.NewHTTPError(http.StatusConflict, "Document not initialized")
	case errors.Is(err, docs.ErrStaleSnapshot):
		return echo.NewHTTPError(http.StatusConflict, "Snapshot is stale")
	case errors.Is(err, docs.ErrTooLarge):
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "Payload exceeds size limit")
	case errors.Is(err, docs.ErrEmptyUpdate):
		return echo.NewHTTPError(http.StatusBadRequest, "Update must not be empty")
	default:
		return internalError("Document operation failed", err)
	}
}

func docStateJSON(state *docs.State, role string) docStateResponse {
	resp := docStateResponse{
		Exists:      state.Exists,
		Role:        role,
		Seq:         state.Seq,
		SnapshotSeq: state.SnapshotSeq,
		Snapshot:    state.Snapshot,
		Updates:     make([]docUpdateJSON, len(state.Updates)),
		HasMore:     state.HasMore,
		Text:        state.Text,
	}
	for i, u := range state.Updates {
		resp.Updates[i] = docUpdateJSON{Seq: u.Seq, Data: u.Data}
	}
	return resp
}

// GetState returns the full sync state (snapshot + updates newer than it), or
// {exists:false, text} for an eligible file with no CRDT state yet.
func (h *DocumentHandler) GetState(c echo.Context) error {
	libraryID, fileID, err := parseDocParams(c)
	if err != nil {
		return err
	}
	state, err := h.docsSvc.GetState(c.Request().Context(), libraryID, fileID)
	if err != nil {
		return mapDocsError(err)
	}
	return c.JSON(http.StatusOK, docStateJSON(state, docRole(c)))
}

// Init seeds the document exactly once. A lost race returns 409 with the
// winner's full state so the client discards its local doc and resyncs.
func (h *DocumentHandler) Init(c echo.Context) error {
	libraryID, fileID, err := parseDocParams(c)
	if err != nil {
		return err
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	var req docInitRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	conflicted, winner, err := h.docsSvc.Init(c.Request().Context(), libraryID, fileID, userID, req.Update)
	if err != nil {
		return mapDocsError(err)
	}
	if conflicted {
		return c.JSON(http.StatusConflict, docStateJSON(winner, docRole(c)))
	}
	return c.JSON(http.StatusCreated, map[string]int64{"seq": 1})
}

// Append adds one opaque update to the log and relays it to the room.
func (h *DocumentHandler) Append(c echo.Context) error {
	libraryID, fileID, err := parseDocParams(c)
	if err != nil {
		return err
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	var req docAppendRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	seq, err := h.docsSvc.AppendUpdate(c.Request().Context(), libraryID, fileID, userID, req.Data)
	if err != nil {
		return mapDocsError(err)
	}
	return c.JSON(http.StatusOK, map[string]int64{"seq": seq})
}

// ListUpdates is the gap-replay / polling fallback: updates with seq > since.
func (h *DocumentHandler) ListUpdates(c echo.Context) error {
	libraryID, fileID, err := parseDocParams(c)
	if err != nil {
		return err
	}
	since := int64(0)
	if raw := c.QueryParam("since"); raw != "" {
		since, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || since < 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid since parameter")
		}
	}
	page, err := h.docsSvc.ListUpdates(c.Request().Context(), libraryID, fileID, since)
	if err != nil {
		return mapDocsError(err)
	}
	updates := make([]docUpdateJSON, len(page.Updates))
	for i, u := range page.Updates {
		updates[i] = docUpdateJSON{Seq: u.Seq, Data: u.Data}
	}
	return c.JSON(http.StatusOK, map[string]any{
		"seq":     page.Seq,
		"updates": updates,
		"hasMore": page.HasMore,
	})
}

// Snapshot applies a client-computed compaction and materializes the markdown
// into the file blob. A stale snapshot returns 409 — benign for the client.
func (h *DocumentHandler) Snapshot(c echo.Context) error {
	libraryID, fileID, err := parseDocParams(c)
	if err != nil {
		return err
	}
	var req docSnapshotRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := h.docsSvc.Compact(c.Request().Context(), libraryID, fileID, req.Snapshot, req.UpTo, req.Text); err != nil {
		return mapDocsError(err)
	}
	return c.JSON(http.StatusOK, map[string]int64{"snapshotSeq": req.UpTo})
}

// ServeWS upgrades to the per-document WebSocket (server→client update and
// awareness fan-out; inbound accepts only awareness + pong). Viewer+ access
// was verified by LibraryAccessMiddleware before the upgrade.
func (h *DocumentHandler) ServeWS(c echo.Context) error {
	if h.hub == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "websocket disabled")
	}
	libraryID, fileID, err := parseDocParams(c)
	if err != nil {
		return err
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	// Verifies file∈library + markdown eligibility, and fetches the current
	// seq for the hello frame so the client can gap-replay before trusting
	// live frames.
	seq, err := h.docsSvc.HeadSeq(c.Request().Context(), libraryID, fileID)
	if err != nil {
		return mapDocsError(err)
	}
	conn, err := websocket.Accept(c.Response(), c.Request(), &websocket.AcceptOptions{
		InsecureSkipVerify: true, // origin already enforced by Echo CORS
	})
	if err != nil {
		return err
	}
	client := docs.NewClient(userID, fileID, conn)
	client.SendHello(seq)
	// Block in the handler: Echo cancels the per-request context on return,
	// which would tear the connection down immediately. Derive a fresh
	// context so the pumps live for the lifetime of the WS.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client.Serve(ctx, h.hub, h.rt)
	return nil
}
