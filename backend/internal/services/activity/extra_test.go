package activity

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// --- service.go accessors + EmitAsync + Tx + metadata-error paths ---

func TestService_AccessorsExposeDBAndHub(t *testing.T) {
	db := activityTestDB(t)
	hub := NewHub()
	s := NewService(db, hub, nil)
	if s.DB() != db {
		t.Error("DB() should return the wired db")
	}
	if s.Hub() != hub {
		t.Error("Hub() should return the wired hub")
	}
}

func TestEmit_UsesTxWhenProvided(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)
	owner := mustUser(t, db, "tx-owner")
	lib := mustLibrary(t, db, owner.ID, "TxLib")

	tx := db.Begin()
	row, err := s.Emit(context.Background(), EmitParams{
		LibraryID: lib.ID,
		Action:    ActionFileCreated,
		Tx:        tx,
	})
	if err != nil {
		t.Fatalf("Emit with tx: %v", err)
	}
	// Roll back the transaction; the row must vanish because it was written
	// through tx, not s.db.
	if err := tx.Rollback().Error; err != nil {
		t.Fatalf("rollback: %v", err)
	}
	var count int64
	db.Model(&models.LibraryActivity{}).Where("id = ?", row.ID).Count(&count)
	if count != 0 {
		t.Fatalf("row written via tx should be rolled back, found %d", count)
	}
}

func TestEmit_UnmarshalableMetadataErrors(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)
	owner := mustUser(t, db, "meta-owner")
	lib := mustLibrary(t, db, owner.ID, "MetaLib")

	// A channel can't be JSON-marshalled → Emit returns the marshal error.
	_, err := s.Emit(context.Background(), EmitParams{
		LibraryID: lib.ID,
		Action:    ActionFileCreated,
		Metadata:  make(chan int),
	})
	if err == nil {
		t.Fatal("expected marshal error for unmarshalable metadata")
	}
}

func TestEmit_NilMetadataDefaultsToEmptyObject(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)
	owner := mustUser(t, db, "nilmeta-owner")
	lib := mustLibrary(t, db, owner.ID, "NilMetaLib")

	row, err := s.Emit(context.Background(), EmitParams{
		LibraryID: lib.ID,
		Action:    ActionFileCreated,
		// Metadata left nil.
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	var got models.LibraryActivity
	if err := db.Where("id = ?", row.ID).First(&got).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if string(got.Metadata) != "{}" {
		t.Fatalf("nil metadata should persist as {}, got %q", string(got.Metadata))
	}
}

func TestEmitAsync_WritesRow(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)
	owner := mustUser(t, db, "async-owner")
	lib := mustLibrary(t, db, owner.ID, "AsyncLib")

	s.EmitAsync(EmitParams{
		LibraryID: lib.ID,
		Action:    ActionTagCreated,
		SubjectType: SubjectTag,
	})

	// Poll for the async insert.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		var count int64
		db.Model(&models.LibraryActivity{}).Where("library_id = ? AND action = ?", lib.ID, ActionTagCreated).Count(&count)
		if count == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("EmitAsync never persisted the row")
}

// TestEmitAsync_SwallowsValidationError exercises the error-logging branch
// of EmitAsync (missing Action). It must not panic and must write nothing.
func TestEmitAsync_SwallowsValidationError(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)
	owner := mustUser(t, db, "async-bad")
	lib := mustLibrary(t, db, owner.ID, "AsyncBad")

	s.EmitAsync(EmitParams{LibraryID: lib.ID}) // no Action → validation error
	time.Sleep(100 * time.Millisecond)
	var count int64
	db.Model(&models.LibraryActivity{}).Where("library_id = ?", lib.ID).Count(&count)
	if count != 0 {
		t.Fatalf("invalid EmitAsync should not write, found %d", count)
	}
}

// --- envelope.go decodeMetadata + ToResponse branches ---

func TestDecodeMetadata_EdgeCases(t *testing.T) {
	if got := decodeMetadata(nil); len(got) != 0 {
		t.Errorf("nil bytes should yield empty map, got %v", got)
	}
	if got := decodeMetadata([]byte("")); len(got) != 0 {
		t.Errorf("empty bytes should yield empty map, got %v", got)
	}
	if got := decodeMetadata([]byte("not json")); len(got) != 0 {
		t.Errorf("bad json should yield empty map, got %v", got)
	}
	// JSON null unmarshals into a nil map → coerced to empty.
	if got := decodeMetadata([]byte("null")); got == nil || len(got) != 0 {
		t.Errorf("json null should yield non-nil empty map, got %v", got)
	}
	got := decodeMetadata([]byte(`{"a":1}`))
	if got["a"] != float64(1) {
		t.Errorf("valid json should decode, got %v", got)
	}
}

func TestToResponse_PopulatesActorAndSubject(t *testing.T) {
	subID := uuid.New()
	actorID := uuid.New()
	avatar := "http://x/y.png"
	now := time.Now()
	row := &models.LibraryActivity{
		ID:          uuid.New(),
		LibraryID:   uuid.New(),
		Action:      ActionFileCreated,
		SubjectType: SubjectFile,
		SubjectID:   &subID,
		Metadata:    []byte(`{"k":"v"}`),
		CreatedAt:   now,
	}
	actor := &models.User{ID: actorID, DisplayName: "Actor", AvatarUrl: &avatar}
	resp := ToResponse(row, actor, "MyLib", true)

	if resp.SubjectID == nil || *resp.SubjectID != subID.String() {
		t.Errorf("subjectID not populated: %v", resp.SubjectID)
	}
	if resp.Actor == nil || resp.Actor.ID != actorID.String() {
		t.Errorf("actor not populated: %+v", resp.Actor)
	}
	if resp.Actor.AvatarUrl == nil || *resp.Actor.AvatarUrl != avatar {
		t.Errorf("avatar not populated: %v", resp.Actor.AvatarUrl)
	}
	if resp.LibraryName != "MyLib" || !resp.Dismissed {
		t.Errorf("library name/dismissed: %q %v", resp.LibraryName, resp.Dismissed)
	}
	if resp.Metadata["k"] != "v" {
		t.Errorf("metadata: %v", resp.Metadata)
	}
}

func TestToResponse_NilActorAndSubject(t *testing.T) {
	row := &models.LibraryActivity{
		ID:        uuid.New(),
		LibraryID: uuid.New(),
		Action:    ActionSystemWaveformReady,
		CreatedAt: time.Now(),
	}
	resp := ToResponse(row, nil, "", false)
	if resp.Actor != nil {
		t.Errorf("nil actor expected, got %+v", resp.Actor)
	}
	if resp.SubjectID != nil {
		t.Errorf("nil subjectID expected, got %v", resp.SubjectID)
	}
	if len(resp.Metadata) != 0 {
		t.Errorf("empty metadata expected, got %v", resp.Metadata)
	}
}

// --- hub.go uncovered helpers + joinLocked re-join branch ---

func TestHub_RoomsOfAndUserIDsInLibraryRoom(t *testing.T) {
	h := NewHub()
	libID := uuid.New()
	c := fakeClient(t)
	h.Register(c)
	h.Join(c, LibraryRoom(libID))
	defer h.Unregister(c)

	rooms := h.RoomsOf(c)
	if len(rooms) != 2 {
		t.Fatalf("expected 2 rooms (user + library), got %v", rooms)
	}
	foundUser, foundLib := false, false
	for _, r := range rooms {
		if r == UserRoom(c.UserID) {
			foundUser = true
		}
		if r == LibraryRoom(libID) {
			foundLib = true
		}
	}
	if !foundUser || !foundLib {
		t.Fatalf("RoomsOf missing expected rooms: %v", rooms)
	}

	ids := h.userIDsInLibraryRoom(libID)
	if len(ids) != 1 || ids[0] != c.UserID {
		t.Fatalf("userIDsInLibraryRoom: %v", ids)
	}
}

// TestHub_JoinLockedHandlesUnknownClient covers the joinLocked branch where
// the client isn't yet in h.clients (Join called before Register).
func TestHub_JoinLockedHandlesUnknownClient(t *testing.T) {
	h := NewHub()
	c := fakeClient(t)
	room := LibraryRoom(uuid.New())
	// Join without Register first — joinLocked must create the clients entry.
	h.Join(c, room)
	if h.RoomCount(room) != 1 {
		t.Fatalf("join should add client to room, got %d", h.RoomCount(room))
	}
	if got := h.RoomsOf(c); len(got) != 1 || got[0] != room {
		t.Fatalf("RoomsOf after bare Join: %v", got)
	}
}

// TestHub_UnregisterUnknownClientNoop covers the early-return when
// Unregister is called for a client that was never registered.
func TestHub_UnregisterUnknownClientNoop(t *testing.T) {
	h := NewHub()
	c := fakeClient(t)
	// Should be a silent no-op (no panic).
	h.Unregister(c)
	if h.ClientCount() != 0 {
		t.Fatalf("client count should stay 0, got %d", h.ClientCount())
	}
}

// --- bus.go: Run nil-arg guards + dispatch bad-payload branch ---

func TestBus_RunGuards(t *testing.T) {
	// nil client.
	if err := NewBus(nil).Run(context.Background(), NewHub()); err == nil {
		t.Error("Run with nil client should error")
	}
	// nil hub.
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	if err := NewBus(rc).Run(context.Background(), nil); err == nil {
		t.Error("Run with nil hub should error")
	}
}

func TestBus_RunReturnsOnContextCancel(t *testing.T) {
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	bus := NewBus(rc)
	hub := NewHub()

	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() { errc <- bus.Run(ctx, hub) }()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case err := <-errc:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context.Canceled, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
}

// TestBus_DispatchIgnoresBadEnvelope drives a malformed payload through the
// running bus; dispatch logs and returns without broadcasting.
func TestBus_DispatchIgnoresBadEnvelope(t *testing.T) {
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	bus := NewBus(rc)
	hub := NewHub()

	libID := uuid.New()
	sub := fakeClient(t)
	hub.Register(sub)
	hub.Join(sub, LibraryRoom(libID))
	defer hub.Unregister(sub)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go bus.Run(ctx, hub)
	time.Sleep(50 * time.Millisecond)

	// Publish garbage on a channel the bus PSUBSCRIBEs to.
	if err := rc.Publish(ctx, libraryChannel(libID), []byte("{not valid")).Err(); err != nil {
		t.Fatalf("publish: %v", err)
	}
	// Then a valid envelope; only the valid one should be delivered.
	env := envelope{
		Rooms:   []string{LibraryRoom(libID)},
		Payload: ActivityResponse{ID: uuid.NewString(), Action: ActionFileCreated, LibraryID: libID.String()},
	}
	data, _ := json.Marshal(env)
	if err := rc.Publish(ctx, libraryChannel(libID), data).Err(); err != nil {
		t.Fatalf("publish valid: %v", err)
	}

	select {
	case msg := <-sub.send:
		var got ActivityResponse
		if err := json.Unmarshal(msg, &got); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if got.Action != ActionFileCreated {
			t.Fatalf("unexpected forwarded action %q", got.Action)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("valid envelope not delivered after a bad one")
	}
}

// TestBus_FanOutMemberLookupError covers fanOutToUsers when the member
// lookup returns an error (logged, no panic, no delivery).
func TestBus_FanOutMemberLookupError(t *testing.T) {
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	bus := NewBus(rc)
	hub := NewHub()

	libID := uuid.New()
	sub := fakeClient(t)
	hub.Register(sub)
	defer hub.Unregister(sub)
	bus.SetMemberLookup(func(string) ([]string, error) {
		return nil, errors.New("boom")
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go bus.Run(ctx, hub)
	time.Sleep(50 * time.Millisecond)

	env := envelope{
		Rooms:   []string{LibraryRoom(libID)},
		Payload: ActivityResponse{ID: uuid.NewString(), Action: ActionFileCreated, LibraryID: libID.String()},
	}
	data, _ := json.Marshal(env)
	if err := rc.Publish(ctx, libraryChannel(libID), data).Err(); err != nil {
		t.Fatalf("publish: %v", err)
	}
	// Member lookup errored, so the user room gets nothing.
	time.Sleep(150 * time.Millisecond)
	if n := drain(sub); n != 0 {
		t.Fatalf("member-lookup error should yield no user fan-out, got %d", n)
	}
}
