package activity

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// activityTestDB returns a *gorm.DB pointed at the shared test postgres,
// migrating only the tables this package needs.
func activityTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_activity")
	if err := db.AutoMigrate(
		&models.User{}, &models.Library{}, &models.LibraryMember{},
		&models.LibraryActivity{}, &models.UserNotificationDismissal{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users, libraries, library_members, library_activities, user_notification_dismissals RESTART IDENTITY CASCADE")
	return db
}

func mustUser(t *testing.T, db *gorm.DB, name string) models.User {
	t.Helper()
	u := models.User{Email: name + "@example.com", DisplayName: name, Role: "member"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func mustLibrary(t *testing.T, db *gorm.DB, ownerID uuid.UUID, name string) models.Library {
	t.Helper()
	lib := models.Library{Name: name, OwnerID: ownerID}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	return lib
}

func TestEmit_RequiresLibraryAndAction(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)

	if _, err := s.Emit(context.Background(), EmitParams{Action: "x"}); err == nil {
		t.Fatal("expected error for missing LibraryID")
	}
	if _, err := s.Emit(context.Background(), EmitParams{LibraryID: uuid.New()}); err == nil {
		t.Fatal("expected error for missing Action")
	}
}

func TestEmit_WritesRowAndMetadata(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)

	owner := mustUser(t, db, "alice")
	lib := mustLibrary(t, db, owner.ID, "L")

	uid := owner.ID
	row, err := s.Emit(context.Background(), EmitParams{
		LibraryID:   lib.ID,
		ActorID:     &uid,
		Action:      ActionFileCreated,
		SubjectType: SubjectFile,
		Metadata: map[string]any{
			"name": "hello.png",
			"size": 1234,
		},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if row.ID == uuid.Nil {
		t.Fatal("Emit should populate ID")
	}

	// Round-trip from DB.
	var got models.LibraryActivity
	if err := db.Where("id = ?", row.ID).First(&got).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if got.Action != ActionFileCreated {
		t.Errorf("action: want %q got %q", ActionFileCreated, got.Action)
	}
	if got.ActorID == nil || *got.ActorID != uid {
		t.Errorf("actor: want %v got %v", uid, got.ActorID)
	}
	var meta map[string]any
	if err := json.Unmarshal(got.Metadata, &meta); err != nil {
		t.Fatalf("unmarshal metadata: %v", err)
	}
	if meta["name"] != "hello.png" {
		t.Errorf("metadata.name: %v", meta["name"])
	}
}

func TestEmit_SystemActionHasNilActor(t *testing.T) {
	db := activityTestDB(t)
	s := NewService(db, nil, nil)
	owner := mustUser(t, db, "bob")
	lib := mustLibrary(t, db, owner.ID, "L")

	row, err := s.Emit(context.Background(), EmitParams{
		LibraryID:   lib.ID,
		Action:      ActionSystemWaveformReady,
		SubjectType: SubjectFile,
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if row.ActorID != nil {
		t.Errorf("system emit should have nil ActorID, got %v", row.ActorID)
	}
	if !IsSystemAction(row.Action) {
		t.Errorf("IsSystemAction(%q) should be true", row.Action)
	}
}

// TestEmit_PublishesToBus verifies an Emit propagates a JSON envelope onto
// the configured Redis Pub/Sub channel.
func TestEmit_PublishesToBus(t *testing.T) {
	db := activityTestDB(t)
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rc.Close()
	bus := NewBus(rc)
	s := NewService(db, nil, bus)

	owner := mustUser(t, db, "carol")
	lib := mustLibrary(t, db, owner.ID, "L")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ps := rc.Subscribe(ctx, libraryChannel(lib.ID))
	defer ps.Close()
	if _, err := ps.Receive(ctx); err != nil {
		t.Fatalf("subscribe handshake: %v", err)
	}

	uid := owner.ID
	go func() {
		// Give the subscriber a moment to register before emitting.
		time.Sleep(20 * time.Millisecond)
		_, _ = s.Emit(context.Background(), EmitParams{
			LibraryID: lib.ID, ActorID: &uid,
			Action: ActionFolderCreated, SubjectType: SubjectFolder,
			Metadata: map[string]any{"name": "new folder"},
		})
	}()

	msg := <-ps.Channel()
	if msg == nil {
		t.Fatal("no message")
	}
	var env envelope
	if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if env.Payload.Action != ActionFolderCreated {
		t.Errorf("envelope action: %q", env.Payload.Action)
	}
	if len(env.Rooms) == 0 || env.Rooms[0] != LibraryRoom(lib.ID) {
		t.Errorf("envelope rooms: %v", env.Rooms)
	}
	if env.Payload.LibraryName != "L" {
		t.Errorf("library name should be hydrated, got %q", env.Payload.LibraryName)
	}
}

func TestIsSystemAction(t *testing.T) {
	cases := map[string]bool{
		ActionSystemWaveformReady:   true,
		ActionSystemTranscribeReady: true,
		ActionFileCreated:           false,
		ActionMomentCreated:         false,
		"":                          false,
	}
	for action, want := range cases {
		if got := IsSystemAction(action); got != want {
			t.Errorf("IsSystemAction(%q) = %v, want %v", action, got, want)
		}
	}
}
