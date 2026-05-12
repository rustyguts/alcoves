package activity

import (
	"log"
	"sync"

	"github.com/google/uuid"
)

// Hub manages in-process WebSocket subscribers. Clients live in named rooms
// (`user:<uuid>` for the global bell, `library:<uuid>` for the per-library
// Feed page). Broadcasts are non-blocking: if a client's send buffer is
// full, the message is dropped and the client is expected to refetch via
// HTTP on reconnect.
type Hub struct {
	mu      sync.RWMutex
	rooms   map[string]map[*Client]struct{}
	clients map[*Client]map[string]struct{}
}

func NewHub() *Hub {
	return &Hub{
		rooms:   map[string]map[*Client]struct{}{},
		clients: map[*Client]map[string]struct{}{},
	}
}

// Register adds a fresh client. The client is automatically joined to its
// `user:<userID>` room.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c]; !ok {
		h.clients[c] = map[string]struct{}{}
	}
	h.joinLocked(c, UserRoom(c.UserID))
}

// Unregister removes a client from every room it was in.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	rooms, ok := h.clients[c]
	if !ok {
		return
	}
	for room := range rooms {
		if set, ok := h.rooms[room]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.rooms, room)
			}
		}
	}
	delete(h.clients, c)
}

// Join adds a client to a room. Caller must have verified access.
func (h *Hub) Join(c *Client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.joinLocked(c, room)
}

func (h *Hub) joinLocked(c *Client, room string) {
	if _, ok := h.rooms[room]; !ok {
		h.rooms[room] = map[*Client]struct{}{}
	}
	h.rooms[room][c] = struct{}{}
	if _, ok := h.clients[c]; !ok {
		h.clients[c] = map[string]struct{}{}
	}
	h.clients[c][room] = struct{}{}
}

// Leave removes a client from a single room.
func (h *Hub) Leave(c *Client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.rooms[room]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.rooms, room)
		}
	}
	if rooms, ok := h.clients[c]; ok {
		delete(rooms, room)
	}
}

// Broadcast pushes a JSON payload to every client in the room.
// Non-blocking: full send buffers cause drops, logged at debug level.
func (h *Hub) Broadcast(room string, payload []byte) {
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.rooms[room]))
	for c := range h.rooms[room] {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- payload:
		default:
			log.Printf("activity.Hub: dropped message for slow client user=%s", c.UserID)
		}
	}
}

// RoomCount is for tests / observability.
func (h *Hub) RoomCount(room string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[room])
}

// ClientCount returns the number of unique connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// RoomsOf returns the set of rooms a client is in (used by tests).
func (h *Hub) RoomsOf(c *Client) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]string, 0, len(h.clients[c]))
	for r := range h.clients[c] {
		out = append(out, r)
	}
	return out
}

// userIDsInLibraryRoom is a helper for tests asserting fan-out.
func (h *Hub) userIDsInLibraryRoom(libraryID uuid.UUID) []uuid.UUID {
	h.mu.RLock()
	defer h.mu.RUnlock()
	room := h.rooms[LibraryRoom(libraryID)]
	out := make([]uuid.UUID, 0, len(room))
	for c := range room {
		out = append(out, c.UserID)
	}
	return out
}
