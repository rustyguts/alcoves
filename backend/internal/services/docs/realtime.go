package docs

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Frame is the JSON message exchanged over the doc WebSocket (both
// directions) and, verbatim, the Redis fan-out payload. Data JSON-encodes as
// base64, so opaque Yjs bytes ride inside text frames.
//
// Server→client: hello (current seq — the client gap-replays over HTTP
// before applying live frames), update, awareness, ping, error.
// Client→server: awareness, pong. There is deliberately NO document-write
// path over the WebSocket — writes go through HTTP POST where auth, role
// gating, and sequence assignment already live.
type Frame struct {
	Type  string `json:"type"`
	Seq   int64  `json:"seq,omitempty"`
	Data  []byte `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

const (
	frameHello     = "hello"
	frameUpdate    = "update"
	frameAwareness = "awareness"
	frameReset     = "reset"
	framePing      = "ping"
	framePong      = "pong"
	frameError     = "error"
)

// docChannel is the Redis Pub/Sub channel for one document's events.
func docChannel(fileID uuid.UUID) string { return "doc:" + fileID.String() }

// Hub manages in-process WebSocket subscribers, one room per document.
// Broadcasts are non-blocking: a full send buffer drops the frame — safe
// because the DB update log is the source of truth and clients detect seq
// gaps and replay over HTTP.
type Hub struct {
	mu    sync.RWMutex
	rooms map[uuid.UUID]map[*Client]struct{}
}

func NewHub() *Hub {
	return &Hub{rooms: map[uuid.UUID]map[*Client]struct{}{}}
}

// Register joins a client to its document's room. Access was verified by the
// middleware before the upgrade.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.rooms[c.FileID]; !ok {
		h.rooms[c.FileID] = map[*Client]struct{}{}
	}
	h.rooms[c.FileID][c] = struct{}{}
}

// Unregister removes a client from its room.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.rooms[c.FileID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.rooms, c.FileID)
		}
	}
}

// Broadcast pushes a payload to every client in a document's room.
func (h *Hub) Broadcast(fileID uuid.UUID, payload []byte) {
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.rooms[fileID]))
	for c := range h.rooms[fileID] {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- payload:
		default:
			log.Printf("docs.Hub: dropped frame for slow client user=%s doc=%s", c.UserID, c.FileID)
		}
	}
}

// RoomCount is for tests / observability.
func (h *Hub) RoomCount(fileID uuid.UUID) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[fileID])
}

// Realtime fans committed document events out to connected clients and
// implements Publisher for the Service. With a Redis client the path is
// always publish→Redis→every replica's Run loop→local Hub, so local and
// remote processes take one identical path; without Redis it degrades to a
// direct local broadcast (tests).
type Realtime struct {
	hub   *Hub
	redis *redis.Client
}

// NewRealtime constructs the fan-out layer. hub may be nil (worker mode —
// publishes still reach API replicas via Redis); redisClient may be nil
// (direct local broadcast only).
func NewRealtime(hub *Hub, redisClient *redis.Client) *Realtime {
	return &Realtime{hub: hub, redis: redisClient}
}

// PublishUpdate broadcasts a committed update to a document's room.
func (r *Realtime) PublishUpdate(fileID uuid.UUID, seq int64, data []byte) {
	r.publish(fileID, Frame{Type: frameUpdate, Seq: seq, Data: data})
}

// PublishAwareness relays a presence/cursor frame. Never persisted.
func (r *Realtime) PublishAwareness(fileID uuid.UUID, data []byte) {
	r.publish(fileID, Frame{Type: frameAwareness, Data: data})
}

// PublishReset tells connected clients to discard local doc state and resync
// (the document was replaced by a non-CRDT writer, e.g. the MCP tools).
func (r *Realtime) PublishReset(fileID uuid.UUID) {
	r.publish(fileID, Frame{Type: frameReset})
}

func (r *Realtime) publish(fileID uuid.UUID, f Frame) {
	if r == nil {
		return
	}
	payload, err := json.Marshal(f)
	if err != nil {
		return
	}
	if r.redis != nil {
		if err := r.redis.Publish(context.Background(), docChannel(fileID), payload).Err(); err != nil {
			log.Printf("docs.Realtime: publish doc=%s: %v", fileID, err)
		}
		return
	}
	if r.hub != nil {
		r.hub.Broadcast(fileID, payload)
	}
}

// Run consumes doc:* channel messages and forwards them to the local Hub.
// Blocks until ctx is cancelled. The Redis payload is already the client
// frame, so dispatch is a parse-channel-and-broadcast.
func (r *Realtime) Run(ctx context.Context) error {
	if r == nil || r.redis == nil {
		return errors.New("docs.Realtime: nil redis client")
	}
	if r.hub == nil {
		return errors.New("docs.Realtime: nil hub")
	}
	pubsub := r.redis.PSubscribe(ctx, "doc:*")
	defer pubsub.Close()

	// Confirm the subscription is live before consuming — avoids racing the
	// first publish during startup and in tests.
	if _, err := pubsub.Receive(ctx); err != nil {
		return err
	}

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			fileID, err := uuid.Parse(strings.TrimPrefix(msg.Channel, "doc:"))
			if err != nil {
				continue
			}
			r.hub.Broadcast(fileID, []byte(msg.Payload))
		}
	}
}

// Client wraps a single doc WebSocket connection. The read pump accepts only
// awareness and pong frames; the write pump drains the send channel.
type Client struct {
	UserID uuid.UUID
	FileID uuid.UUID
	conn   *websocket.Conn
	send   chan []byte
}

// NewClient constructs a Client around a freshly-accepted WS connection.
// The 64-frame buffer absorbs bursts of keystroke-scale updates; overflow
// drops are recovered via HTTP gap replay.
func NewClient(userID, fileID uuid.UUID, conn *websocket.Conn) *Client {
	return &Client{
		UserID: userID,
		FileID: fileID,
		conn:   conn,
		send:   make(chan []byte, 64),
	}
}

// SendHello queues the initial frame carrying the document's current seq so
// the client can gap-replay over HTTP before trusting live frames.
func (c *Client) SendHello(seq int64) {
	c.sendFrame(Frame{Type: frameHello, Seq: seq})
}

// Serve runs the read and write pumps until the connection closes or ctx is
// cancelled. rt relays inbound awareness frames to the rest of the room
// (including other replicas).
func (c *Client) Serve(ctx context.Context, hub *Hub, rt *Realtime) {
	hub.Register(c)
	defer hub.Unregister(c)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer c.conn.Close(websocket.StatusNormalClosure, "closing")

	// Application-level ping every 25s (in addition to protocol pings) so
	// dead connections surface through proxies that hide protocol pings.
	// The write pump cancels the shared context on failure so the (otherwise
	// blocking) read pump tears down promptly instead of waiting for TCP —
	// doc rooms are long-lived, so a lingering half-dead socket matters.
	go c.pingLoop(ctx)
	go c.writeLoop(ctx, cancel)
	c.readLoop(ctx, rt)
}

func (c *Client) readLoop(ctx context.Context, rt *Realtime) {
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				closeStatus := websocket.CloseStatus(err)
				if closeStatus != websocket.StatusNormalClosure && closeStatus != websocket.StatusGoingAway {
					log.Printf("docs.Client read: %v", err)
				}
			}
			return
		}
		var f Frame
		if err := json.Unmarshal(data, &f); err != nil {
			c.sendFrame(Frame{Type: frameError, Error: "invalid json"})
			continue
		}
		switch f.Type {
		case framePong:
			// no-op — receipt is the signal of liveness
		case frameAwareness:
			if len(f.Data) == 0 || len(f.Data) > MaxAwarenessBytes {
				c.sendFrame(Frame{Type: frameError, Error: "invalid awareness frame"})
				continue
			}
			if rt != nil {
				rt.PublishAwareness(c.FileID, f.Data)
			}
		default:
			c.sendFrame(Frame{Type: frameError, Error: "unsupported frame type"})
		}
	}
}

func (c *Client) writeLoop(ctx context.Context, cancel context.CancelFunc) {
	for {
		select {
		case <-ctx.Done():
			return
		case payload, ok := <-c.send:
			if !ok {
				return
			}
			wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.conn.Write(wctx, websocket.MessageText, payload)
			wcancel()
			if err != nil {
				cancel() // unblock the read pump on a dead socket
				return
			}
		}
	}
}

func (c *Client) pingLoop(ctx context.Context) {
	t := time.NewTicker(25 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.sendFrame(Frame{Type: framePing})
		}
	}
}

func (c *Client) sendFrame(f Frame) {
	b, err := json.Marshal(f)
	if err != nil {
		return
	}
	select {
	case c.send <- b:
	default:
	}
}
