package activity

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// fakeClient is a stand-in for client.go's *Client that doesn't open a
// real websocket. Only the hub needs UserID + send channel.
func fakeClient(t *testing.T) *Client {
	t.Helper()
	return &Client{
		UserID: uuid.New(),
		send:   make(chan []byte, 4),
	}
}

func TestHub_AutoJoinsUserRoomOnRegister(t *testing.T) {
	h := NewHub()
	c := fakeClient(t)
	h.Register(c)
	defer h.Unregister(c)

	want := UserRoom(c.UserID)
	if h.RoomCount(want) != 1 {
		t.Errorf("user room should have 1 client, got %d", h.RoomCount(want))
	}
	if h.ClientCount() != 1 {
		t.Errorf("hub should have 1 client, got %d", h.ClientCount())
	}
}

func TestHub_JoinLeaveRooms(t *testing.T) {
	h := NewHub()
	c := fakeClient(t)
	h.Register(c)
	libID := uuid.New()
	room := LibraryRoom(libID)

	h.Join(c, room)
	if h.RoomCount(room) != 1 {
		t.Errorf("library room should have 1 after join")
	}
	h.Leave(c, room)
	if h.RoomCount(room) != 0 {
		t.Errorf("library room should be empty after leave, got %d", h.RoomCount(room))
	}
	// The user room must still have this client.
	if h.RoomCount(UserRoom(c.UserID)) != 1 {
		t.Errorf("user room should be unaffected by leaving library room")
	}
}

func TestHub_UnregisterRemovesFromAllRooms(t *testing.T) {
	h := NewHub()
	c := fakeClient(t)
	h.Register(c)
	libID := uuid.New()
	h.Join(c, LibraryRoom(libID))

	h.Unregister(c)

	if h.ClientCount() != 0 {
		t.Errorf("client should be removed")
	}
	if h.RoomCount(UserRoom(c.UserID)) != 0 {
		t.Errorf("user room should be empty")
	}
	if h.RoomCount(LibraryRoom(libID)) != 0 {
		t.Errorf("library room should be empty")
	}
}

func TestHub_BroadcastDeliversToAllClientsInRoom(t *testing.T) {
	h := NewHub()
	libID := uuid.New()
	room := LibraryRoom(libID)
	clients := []*Client{fakeClient(t), fakeClient(t), fakeClient(t)}
	for _, c := range clients {
		h.Register(c)
		h.Join(c, room)
	}
	defer func() {
		for _, c := range clients {
			h.Unregister(c)
		}
	}()

	payload := []byte(`{"ok":true}`)
	h.Broadcast(room, payload)

	var wg sync.WaitGroup
	wg.Add(len(clients))
	results := make([]bool, len(clients))
	for i, c := range clients {
		go func(i int, c *Client) {
			defer wg.Done()
			select {
			case msg := <-c.send:
				results[i] = string(msg) == `{"ok":true}`
			case <-time.After(200 * time.Millisecond):
				results[i] = false
			}
		}(i, c)
	}
	wg.Wait()
	for i, ok := range results {
		if !ok {
			t.Errorf("client %d did not receive expected payload", i)
		}
	}
}

func TestHub_BroadcastDropsOnFullBuffer(t *testing.T) {
	h := NewHub()
	c := &Client{
		UserID: uuid.New(),
		send:   make(chan []byte, 1), // tiny buffer to trigger drop
	}
	h.Register(c)
	libID := uuid.New()
	h.Join(c, LibraryRoom(libID))
	defer h.Unregister(c)

	h.Broadcast(LibraryRoom(libID), []byte("first"))
	// Buffer is full now — second send must NOT block.
	done := make(chan struct{})
	go func() {
		h.Broadcast(LibraryRoom(libID), []byte("second"))
		close(done)
	}()
	select {
	case <-done:
		// good — broadcast didn't block
	case <-time.After(500 * time.Millisecond):
		t.Fatal("broadcast blocked on full client buffer")
	}
	// The client only got the first frame.
	got := <-c.send
	if string(got) != "first" {
		t.Errorf("expected first frame, got %q", string(got))
	}
}
