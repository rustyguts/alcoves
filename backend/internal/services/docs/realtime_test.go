package docs

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// dialDocClient stands up a real WS server running Client.Serve for one doc
// room and dials it, mirroring the activity package's WS test harness.
func dialDocClient(t *testing.T, hub *Hub, rt *Realtime, fileID uuid.UUID, helloSeq int64) *websocket.Conn {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		client := NewClient(uuid.New(), fileID, conn)
		client.SendHello(helloSeq)
		client.Serve(r.Context(), hub, rt)
	}))
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "test done") })
	return conn
}

func readFrame(t *testing.T, conn *websocket.Conn) Frame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var f Frame
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("unmarshal frame %q: %v", data, err)
	}
	return f
}

// expectNoFrame asserts nothing arrives within the window (ping frames are
// ignored — they fire on a 25s ticker, well outside the window anyway).
func expectNoFrame(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	if _, data, err := conn.Read(ctx); err == nil {
		t.Fatalf("expected no frame, got %s", data)
	}
}

func writeFrame(t *testing.T, conn *websocket.Conn, f Frame) {
	t.Helper()
	b, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatalf("write frame: %v", err)
	}
}

func waitForRoomCount(t *testing.T, hub *Hub, fileID uuid.UUID, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if hub.RoomCount(fileID) == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("room %s never reached %d clients (have %d)", fileID, want, hub.RoomCount(fileID))
}

func TestHelloAndRoomScopedBroadcast(t *testing.T) {
	hub := NewHub()
	rt := NewRealtime(hub, nil)
	docA, docB := uuid.New(), uuid.New()

	connA1 := dialDocClient(t, hub, rt, docA, 7)
	connA2 := dialDocClient(t, hub, rt, docA, 7)
	connB := dialDocClient(t, hub, rt, docB, 0)

	for _, conn := range []*websocket.Conn{connA1, connA2} {
		hello := readFrame(t, conn)
		if hello.Type != frameHello || hello.Seq != 7 {
			t.Fatalf("hello = %+v, want type=hello seq=7", hello)
		}
	}
	if hello := readFrame(t, connB); hello.Type != frameHello || hello.Seq != 0 {
		t.Fatalf("hello B = %+v, want type=hello seq=0", hello)
	}

	waitForRoomCount(t, hub, docA, 2)
	waitForRoomCount(t, hub, docB, 1)

	rt.PublishUpdate(docA, 8, []byte{1, 2, 3})
	for _, conn := range []*websocket.Conn{connA1, connA2} {
		f := readFrame(t, conn)
		if f.Type != frameUpdate || f.Seq != 8 || !bytes.Equal(f.Data, []byte{1, 2, 3}) {
			t.Fatalf("update = %+v, want seq=8 data=[1 2 3]", f)
		}
	}
	expectNoFrame(t, connB)
}

func TestAwarenessRelayedToRoom(t *testing.T) {
	hub := NewHub()
	rt := NewRealtime(hub, nil)
	doc := uuid.New()

	connA := dialDocClient(t, hub, rt, doc, 0)
	connB := dialDocClient(t, hub, rt, doc, 0)
	readFrame(t, connA) // hello
	readFrame(t, connB) // hello
	waitForRoomCount(t, hub, doc, 2)

	writeFrame(t, connA, Frame{Type: frameAwareness, Data: []byte{9, 9}})

	// The sender is in the room too, so both receive the relay (idempotent
	// for y-protocols awareness).
	for _, conn := range []*websocket.Conn{connA, connB} {
		f := readFrame(t, conn)
		if f.Type != frameAwareness || !bytes.Equal(f.Data, []byte{9, 9}) {
			t.Fatalf("awareness = %+v, want data=[9 9]", f)
		}
	}
}

func TestInboundFrameValidation(t *testing.T) {
	hub := NewHub()
	rt := NewRealtime(hub, nil)
	doc := uuid.New()

	conn := dialDocClient(t, hub, rt, doc, 0)
	readFrame(t, conn) // hello
	waitForRoomCount(t, hub, doc, 1)

	// Oversized awareness → error, not relayed.
	writeFrame(t, conn, Frame{Type: frameAwareness, Data: make([]byte, MaxAwarenessBytes+1)})
	if f := readFrame(t, conn); f.Type != frameError {
		t.Fatalf("oversized awareness reply = %+v, want error", f)
	}

	// Empty awareness → error.
	writeFrame(t, conn, Frame{Type: frameAwareness})
	if f := readFrame(t, conn); f.Type != frameError {
		t.Fatalf("empty awareness reply = %+v, want error", f)
	}

	// There is no doc-write path over WS — update frames are rejected.
	writeFrame(t, conn, Frame{Type: frameUpdate, Seq: 1, Data: []byte{1}})
	if f := readFrame(t, conn); f.Type != frameError {
		t.Fatalf("inbound update reply = %+v, want error", f)
	}

	// Garbage JSON → error.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, []byte("{nope")); err != nil {
		t.Fatalf("write garbage: %v", err)
	}
	if f := readFrame(t, conn); f.Type != frameError {
		t.Fatalf("garbage reply = %+v, want error", f)
	}

	// Pong is accepted silently.
	writeFrame(t, conn, Frame{Type: framePong})
	expectNoFrame(t, conn)
}

func TestBusRelayAcrossReplicas(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb1 := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rdb2 := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb1.Close(); _ = rdb2.Close() })

	// Two "replicas", each with its own hub + Run loop sharing one Redis.
	hub1, hub2 := NewHub(), NewHub()
	rt1, rt2 := NewRealtime(hub1, rdb1), NewRealtime(hub2, rdb2)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done1, done2 := make(chan struct{}), make(chan struct{})
	go func() { defer close(done1); _ = rt1.Run(ctx) }()
	go func() { defer close(done2); _ = rt2.Run(ctx) }()
	t.Cleanup(func() { cancel(); <-done1; <-done2 })

	// Give both PSubscribes a moment to become live.
	time.Sleep(50 * time.Millisecond)

	doc := uuid.New()
	conn1 := dialDocClient(t, hub1, rt1, doc, 0)
	conn2 := dialDocClient(t, hub2, rt2, doc, 0)
	readFrame(t, conn1) // hello
	readFrame(t, conn2) // hello
	waitForRoomCount(t, hub1, doc, 1)
	waitForRoomCount(t, hub2, doc, 1)

	// A publish on replica 1 reaches clients on BOTH replicas (including its
	// own, via the same Redis path — no self-delivery special case).
	rt1.PublishUpdate(doc, 42, []byte{4, 2})
	for _, conn := range []*websocket.Conn{conn1, conn2} {
		f := readFrame(t, conn)
		if f.Type != frameUpdate || f.Seq != 42 || !bytes.Equal(f.Data, []byte{4, 2}) {
			t.Fatalf("relayed update = %+v, want seq=42 data=[4 2]", f)
		}
	}

	// Awareness sent by a client on replica 2 reaches the client on replica 1.
	writeFrame(t, conn2, Frame{Type: frameAwareness, Data: []byte{7}})
	f := readFrame(t, conn1)
	if f.Type != frameAwareness || !bytes.Equal(f.Data, []byte{7}) {
		t.Fatalf("cross-replica awareness = %+v, want data=[7]", f)
	}
}
