package activity

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"

	"github.com/redis/go-redis/v9"
)

// memberLookup is a pluggable callback so the Bus doesn't take a *gorm.DB
// dependency. The activity Service wires it during startup; tests inject
// a stub.
type memberLookup func(libraryID string) ([]string, error)

// Bus is the cross-process event bus backed by Redis Pub/Sub. Workers and
// API replicas publish; every API replica subscribes via PSUBSCRIBE and
// forwards messages to its local Hub.
//
// Redis Pub/Sub is at-most-once. The DB row is the source of truth — WS
// clients refetch via HTTP on reconnect to recover any dropped events.
type Bus struct {
	client  *redis.Client
	members memberLookup
}

// NewBus constructs a Bus around a Redis client. Pass nil to disable
// realtime delivery entirely (Phase A behavior; or for tests).
func NewBus(client *redis.Client) *Bus {
	return &Bus{client: client}
}

// SetMemberLookup installs the membership lookup used during user-room
// fan-out. The lookup runs on every event received from Redis, so the
// callback should be cached (the activity service wraps it in a
// short-TTL cache).
func (b *Bus) SetMemberLookup(fn memberLookup) {
	b.members = fn
}

// Publish sends an envelope to all subscribers of the given channel.
func (b *Bus) Publish(ctx context.Context, channel string, payload []byte) error {
	if b == nil || b.client == nil {
		return errors.New("activity.Bus: nil client")
	}
	return b.client.Publish(ctx, channel, payload).Err()
}

// Run consumes activity:* channel messages and dispatches envelopes to
// the given Hub. Blocks until ctx is cancelled.
func (b *Bus) Run(ctx context.Context, hub *Hub) error {
	if b == nil || b.client == nil {
		return errors.New("activity.Bus: nil client")
	}
	if hub == nil {
		return errors.New("activity.Bus: nil hub")
	}
	pubsub := b.client.PSubscribe(ctx, "activity:*")
	defer pubsub.Close()

	// Confirm subscription is live before returning — avoids racing
	// against the first publish in tests and during startup.
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
			b.dispatch(hub, msg.Payload)
		}
	}
}

func (b *Bus) dispatch(hub *Hub, payload string) {
	var env envelope
	if err := json.Unmarshal([]byte(payload), &env); err != nil {
		log.Printf("activity.Bus: bad envelope: %v", err)
		return
	}
	out, err := json.Marshal(env.Payload)
	if err != nil {
		log.Printf("activity.Bus: re-marshal payload: %v", err)
		return
	}
	for _, room := range env.Rooms {
		hub.Broadcast(room, out)
		if strings.HasPrefix(room, "library:") {
			b.fanOutToUsers(hub, env.Payload, out)
		}
	}
}

// fanOutToUsers pushes the payload into each member's user: room, subject
// to the global-bell rules (no actor self-notify, no system actions).
func (b *Bus) fanOutToUsers(hub *Hub, p ActivityResponse, payload []byte) {
	if IsSystemAction(p.Action) {
		return
	}
	if b.members == nil {
		return
	}
	userIDs, err := b.members(p.LibraryID)
	if err != nil {
		log.Printf("activity.Bus: member lookup failed: %v", err)
		return
	}
	actor := ""
	if p.Actor != nil {
		actor = p.Actor.ID
	}
	for _, uid := range userIDs {
		if uid == actor {
			continue
		}
		hub.Broadcast("user:"+uid, payload)
	}
}
