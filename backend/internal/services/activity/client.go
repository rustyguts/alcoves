package activity

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/services/access"
)

// Client wraps a single WebSocket connection. Its read pump processes
// subscribe/unsubscribe commands; the write pump drains the send channel.
type Client struct {
	UserID uuid.UUID
	conn   *websocket.Conn
	send   chan []byte
}

// NewClient constructs a Client around a freshly-accepted WS connection.
// Buffer size of 32 strikes a balance between memory and tolerance for
// burst broadcasts; full buffers cause message drops.
func NewClient(userID uuid.UUID, conn *websocket.Conn) *Client {
	return &Client{
		UserID: userID,
		conn:   conn,
		send:   make(chan []byte, 32),
	}
}

// inMessage is the JSON shape clients send.
type inMessage struct {
	Type string `json:"type"`
	Room string `json:"room"`
}

// outMessage is the JSON shape the server sends for control messages.
// Activity payloads are broadcast as-is by the Hub (already JSON).
type outMessage struct {
	Type  string `json:"type"`
	Room  string `json:"room,omitempty"`
	Error string `json:"error,omitempty"`
}

// Serve runs the read and write pumps until the connection closes or ctx
// is cancelled. accessSvc is consulted on every "subscribe" to validate
// library access.
func (c *Client) Serve(ctx context.Context, hub *Hub, accessSvc *access.Service) {
	hub.Register(c)
	defer hub.Unregister(c)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer c.conn.Close(websocket.StatusNormalClosure, "closing")

	// Application-level ping every 25s (in addition to the protocol-level
	// pings coder/websocket sends automatically). Helps surface dead
	// connections through proxies that hide protocol pings.
	go c.pingLoop(ctx)
	go c.writeLoop(ctx)
	c.readLoop(ctx, hub, accessSvc)
}

func (c *Client) readLoop(ctx context.Context, hub *Hub, accessSvc *access.Service) {
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				closeStatus := websocket.CloseStatus(err)
				if closeStatus != websocket.StatusNormalClosure && closeStatus != websocket.StatusGoingAway {
					log.Printf("activity.Client read: %v", err)
				}
			}
			return
		}
		var m inMessage
		if err := json.Unmarshal(data, &m); err != nil {
			c.sendControl(outMessage{Type: "error", Error: "invalid json"})
			continue
		}
		switch m.Type {
		case "subscribe":
			c.handleSubscribe(ctx, hub, accessSvc, m.Room)
		case "unsubscribe":
			hub.Leave(c, m.Room)
			c.sendControl(outMessage{Type: "unsubscribed", Room: m.Room})
		case "pong":
			// no-op — receipt is the signal of liveness
		default:
			c.sendControl(outMessage{Type: "error", Error: "unknown type"})
		}
	}
}

func (c *Client) handleSubscribe(ctx context.Context, hub *Hub, accessSvc *access.Service, room string) {
	if !strings.HasPrefix(room, "library:") {
		// Disallow joining arbitrary rooms. user: rooms are auto-joined;
		// nothing else is valid.
		c.sendControl(outMessage{Type: "error", Room: room, Error: "unsupported room"})
		return
	}
	idStr := strings.TrimPrefix(room, "library:")
	libID, err := uuid.Parse(idStr)
	if err != nil {
		c.sendControl(outMessage{Type: "error", Room: room, Error: "invalid library id"})
		return
	}
	if accessSvc != nil {
		acc, err := accessSvc.GetLibraryAccess(c.UserID, libID)
		if err != nil || acc == nil {
			c.sendControl(outMessage{Type: "error", Room: room, Error: "access denied"})
			return
		}
	}
	hub.Join(c, room)
	c.sendControl(outMessage{Type: "subscribed", Room: room})
}

func (c *Client) writeLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case payload, ok := <-c.send:
			if !ok {
				return
			}
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.conn.Write(wctx, websocket.MessageText, payload)
			cancel()
			if err != nil {
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
			c.sendControl(outMessage{Type: "ping"})
		}
	}
}

func (c *Client) sendControl(m outMessage) {
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	select {
	case c.send <- b:
	default:
	}
}
