package activity

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestBus_PublishWithoutClientErrors(t *testing.T) {
	b := NewBus(nil)
	if err := b.Publish(context.Background(), "x", []byte("y")); err == nil {
		t.Fatal("expected error on nil client")
	}
}

// TestBus_ForwardsLibraryRoomBroadcast verifies the bus relays envelopes
// from Redis to the hub's library room.
func TestBus_ForwardsLibraryRoomBroadcast(t *testing.T) {
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	bus := NewBus(rc)
	hub := NewHub()

	libID := uuid.New()
	subscriber := fakeClient(t)
	hub.Register(subscriber)
	hub.Join(subscriber, LibraryRoom(libID))
	defer hub.Unregister(subscriber)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runErr := make(chan error, 1)
	go func() { runErr <- bus.Run(ctx, hub) }()

	// Give the subscription a moment to be ready.
	time.Sleep(50 * time.Millisecond)

	env := envelope{
		Rooms: []string{LibraryRoom(libID)},
		Payload: ActivityResponse{
			ID: uuid.New().String(), Action: ActionFileCreated, LibraryID: libID.String(),
		},
	}
	data, _ := json.Marshal(env)
	if err := bus.Publish(ctx, libraryChannel(libID), data); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case msg := <-subscriber.send:
		var got ActivityResponse
		if err := json.Unmarshal(msg, &got); err != nil {
			t.Fatalf("unmarshal forwarded payload: %v", err)
		}
		if got.Action != ActionFileCreated {
			t.Errorf("forwarded action: %q", got.Action)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("subscriber received nothing")
	}
}

// TestBus_UserRoomFanOutExcludesActor verifies the fan-out logic.
func TestBus_UserRoomFanOutExcludesActor(t *testing.T) {
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	bus := NewBus(rc)
	hub := NewHub()

	libID := uuid.New()
	actor := fakeClient(t)
	other := fakeClient(t)
	hub.Register(actor)
	hub.Register(other)
	defer hub.Unregister(actor)
	defer hub.Unregister(other)

	// The actor's UserID + the other member.
	bus.SetMemberLookup(func(libraryID string) ([]string, error) {
		if libraryID != libID.String() {
			return nil, nil
		}
		return []string{actor.UserID.String(), other.UserID.String()}, nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go bus.Run(ctx, hub)
	time.Sleep(50 * time.Millisecond)

	env := envelope{
		Rooms: []string{LibraryRoom(libID)},
		Payload: ActivityResponse{
			ID:        uuid.New().String(),
			Action:    ActionFileCreated,
			LibraryID: libID.String(),
			Actor:     &ActorSummary{ID: actor.UserID.String(), DisplayName: "A"},
		},
	}
	data, _ := json.Marshal(env)
	if err := bus.Publish(ctx, libraryChannel(libID), data); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// `other` should have received it; `actor` should not (actor exclusion
	// only applies to user-room fan-out; library-room delivery still goes
	// to the actor, hence we look at the user: room rather than asserting
	// channel emptiness).
	select {
	case msg := <-other.send:
		var got ActivityResponse
		if err := json.Unmarshal(msg, &got); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if got.Action != ActionFileCreated {
			t.Errorf("got %q", got.Action)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("other user did not receive notification")
	}

	// Drain everything that arrived for the actor — we know they should
	// have received the library-room broadcast, but nothing on user: room.
	// Their user: room is empty (no Join), so no additional traffic.
	got := drain(actor)
	if got != 0 {
		t.Errorf("actor's user-room should have received 0 frames, got %d", got)
	}
}

// TestBus_SystemActionsSkipUserFanOut: even with members configured,
// system events must not reach user: rooms.
func TestBus_SystemActionsSkipUserFanOut(t *testing.T) {
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	bus := NewBus(rc)
	hub := NewHub()

	libID := uuid.New()
	subscriber := fakeClient(t)
	hub.Register(subscriber) // joins user: room automatically
	defer hub.Unregister(subscriber)
	bus.SetMemberLookup(func(string) ([]string, error) {
		return []string{subscriber.UserID.String()}, nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go bus.Run(ctx, hub)
	time.Sleep(50 * time.Millisecond)

	env := envelope{
		Rooms: []string{LibraryRoom(libID)},
		Payload: ActivityResponse{
			ID:        uuid.New().String(),
			Action:    ActionSystemWaveformReady,
			LibraryID: libID.String(),
		},
	}
	data, _ := json.Marshal(env)
	if err := bus.Publish(ctx, libraryChannel(libID), data); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// Wait a tick then assert subscriber's user-room buffer is empty
	// (library-room broadcast doesn't reach them because they didn't Join).
	time.Sleep(150 * time.Millisecond)
	if got := drain(subscriber); got != 0 {
		t.Errorf("system event should not fan out to user rooms; got %d frames", got)
	}
}

func drain(c *Client) int {
	count := 0
	for {
		select {
		case <-c.send:
			count++
		default:
			return count
		}
	}
}
