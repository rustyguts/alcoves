package activity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// dialTestClient spins up an httptest server that accepts a websocket,
// drives it through Client.Serve, and returns a connected client websocket
// plus the *Hub so tests can assert room membership. accessSvc may be nil
// to skip access validation.
func dialTestClient(t *testing.T, hub *Hub, accessSvc *access.Service, userID uuid.UUID) (*websocket.Conn, context.Context, func()) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			t.Errorf("accept: %v", err)
			return
		}
		c := NewClient(userID, conn)
		// Serve blocks until the connection closes.
		c.Serve(r.Context(), hub, accessSvc)
	}))

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	cc, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		cancel()
		srv.Close()
		t.Fatalf("dial: %v", err)
	}

	cleanup := func() {
		cc.Close(websocket.StatusNormalClosure, "done")
		cancel()
		srv.Close()
	}
	return cc, ctx, cleanup
}

// readControl reads one JSON control frame off the websocket.
func readControl(t *testing.T, ctx context.Context, cc *websocket.Conn) outMessage {
	t.Helper()
	rctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, data, err := cc.Read(rctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var m outMessage
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal control %q: %v", string(data), err)
	}
	return m
}

func TestNewClient_BuffersSend(t *testing.T) {
	c := NewClient(uuid.New(), nil)
	if c.send == nil {
		t.Fatal("send channel should be initialized")
	}
	if cap(c.send) != 32 {
		t.Errorf("send buffer cap: want 32 got %d", cap(c.send))
	}
}

// TestClient_SubscribeUnsubscribe exercises the read loop's subscribe and
// unsubscribe handling end-to-end over a real websocket, with no access
// service (nil = skip validation).
func TestClient_SubscribeUnsubscribe(t *testing.T) {
	hub := NewHub()
	userID := uuid.New()
	cc, ctx, cleanup := dialTestClient(t, hub, nil, userID)
	defer cleanup()

	libID := uuid.New()
	room := LibraryRoom(libID)

	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "subscribe", Room: room})); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}
	got := readControl(t, ctx, cc)
	if got.Type != "subscribed" || got.Room != room {
		t.Fatalf("subscribe ack: %+v", got)
	}
	waitForRoomCount(t, hub, room, 1)

	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "unsubscribe", Room: room})); err != nil {
		t.Fatalf("write unsubscribe: %v", err)
	}
	got = readControl(t, ctx, cc)
	if got.Type != "unsubscribed" || got.Room != room {
		t.Fatalf("unsubscribe ack: %+v", got)
	}
	waitForRoomCount(t, hub, room, 0)
}

// TestClient_InvalidJSON_UnknownType_Pong covers the remaining read-loop
// branches: invalid JSON, unknown message type, and pong (no-op).
func TestClient_InvalidJSON_UnknownType_Pong(t *testing.T) {
	hub := NewHub()
	cc, ctx, cleanup := dialTestClient(t, hub, nil, uuid.New())
	defer cleanup()

	// Invalid JSON → "invalid json" error frame.
	if err := cc.Write(ctx, websocket.MessageText, []byte("not json")); err != nil {
		t.Fatalf("write bad json: %v", err)
	}
	got := readControl(t, ctx, cc)
	if got.Type != "error" || got.Error != "invalid json" {
		t.Fatalf("bad json control: %+v", got)
	}

	// Unknown type → "unknown type" error frame.
	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "frobnicate"})); err != nil {
		t.Fatalf("write unknown: %v", err)
	}
	got = readControl(t, ctx, cc)
	if got.Type != "error" || got.Error != "unknown type" {
		t.Fatalf("unknown type control: %+v", got)
	}

	// Pong is a silent no-op. Send pong then a subscribe; we should only
	// see the subscribe ack (proving pong produced no frame).
	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "pong"})); err != nil {
		t.Fatalf("write pong: %v", err)
	}
	libID := uuid.New()
	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "subscribe", Room: LibraryRoom(libID)})); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}
	got = readControl(t, ctx, cc)
	if got.Type != "subscribed" {
		t.Fatalf("expected subscribed after pong no-op, got %+v", got)
	}
}

// TestClient_SubscribeRejectsBadRooms covers handleSubscribe's reject paths:
// non-library room, malformed library id.
func TestClient_SubscribeRejectsBadRooms(t *testing.T) {
	hub := NewHub()
	cc, ctx, cleanup := dialTestClient(t, hub, nil, uuid.New())
	defer cleanup()

	// Non library: prefix → unsupported room.
	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "subscribe", Room: "random:xyz"})); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := readControl(t, ctx, cc)
	if got.Type != "error" || got.Error != "unsupported room" {
		t.Fatalf("unsupported room control: %+v", got)
	}

	// Bad uuid in library room → invalid library id.
	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "subscribe", Room: "library:not-a-uuid"})); err != nil {
		t.Fatalf("write: %v", err)
	}
	got = readControl(t, ctx, cc)
	if got.Type != "error" || got.Error != "invalid library id" {
		t.Fatalf("invalid library id control: %+v", got)
	}
}

// TestClient_SubscribeAccessDenied covers handleSubscribe's access-service
// branch when the user has no access to the requested library.
func TestClient_SubscribeAccessDenied(t *testing.T) {
	db := clientAccessDB(t)
	accessSvc := access.NewService(db)

	owner := mustUser(t, db, "client-owner")
	stranger := mustUser(t, db, "client-stranger")
	lib := mustLibrary(t, db, owner.ID, "AccessLib")

	hub := NewHub()
	cc, ctx, cleanup := dialTestClient(t, hub, accessSvc, stranger.ID)
	defer cleanup()

	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "subscribe", Room: LibraryRoom(lib.ID)})); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := readControl(t, ctx, cc)
	if got.Type != "error" || got.Error != "access denied" {
		t.Fatalf("expected access denied, got %+v", got)
	}
}

// TestClient_SubscribeAccessGranted covers handleSubscribe's success path
// through the access service (owner has access).
func TestClient_SubscribeAccessGranted(t *testing.T) {
	db := clientAccessDB(t)
	accessSvc := access.NewService(db)

	owner := mustUser(t, db, "client-owner-ok")
	lib := mustLibrary(t, db, owner.ID, "AccessLibOK")

	hub := NewHub()
	cc, ctx, cleanup := dialTestClient(t, hub, accessSvc, owner.ID)
	defer cleanup()

	room := LibraryRoom(lib.ID)
	if err := cc.Write(ctx, websocket.MessageText, mustJSON(t, inMessage{Type: "subscribe", Room: room})); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := readControl(t, ctx, cc)
	if got.Type != "subscribed" || got.Room != room {
		t.Fatalf("expected subscribed, got %+v", got)
	}
	waitForRoomCount(t, hub, room, 1)
}

// TestClient_WriteLoopDeliversBroadcast verifies the write pump drains the
// send channel and writes onto the wire, and that Broadcast reaches a
// real connected client.
func TestClient_WriteLoopDeliversBroadcast(t *testing.T) {
	hub := NewHub()
	userID := uuid.New()
	cc, ctx, cleanup := dialTestClient(t, hub, nil, userID)
	defer cleanup()

	// The client auto-joins its user room on Register inside Serve. Wait
	// for it to register, then broadcast to that room.
	room := UserRoom(userID)
	waitForRoomCount(t, hub, room, 1)

	hub.Broadcast(room, []byte(`{"type":"activity","hello":"world"}`))

	rctx, rcancel := context.WithTimeout(ctx, 2*time.Second)
	defer rcancel()
	_, data, err := cc.Read(rctx)
	if err != nil {
		t.Fatalf("read broadcast: %v", err)
	}
	if !strings.Contains(string(data), `"hello":"world"`) {
		t.Fatalf("unexpected broadcast payload: %s", string(data))
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func waitForRoomCount(t *testing.T, hub *Hub, room string, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if hub.RoomCount(room) == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("room %q count never reached %d (last=%d)", room, want, hub.RoomCount(room))
}

// clientAccessDB builds a DB with the tables the access service needs.
func clientAccessDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_activity")
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.LibraryMember{}); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users, libraries, library_members RESTART IDENTITY CASCADE")
	return db
}
