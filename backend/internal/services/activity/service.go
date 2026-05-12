package activity

import (
	"context"
	"encoding/json"
	"errors"
	"log"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// EmitParams is the input to Service.Emit. Metadata is marshalled to JSONB;
// it can be any json-marshallable value (typically a map[string]any or a
// typed struct). LibraryID and Action are required; everything else is
// optional. If Tx is non-nil it's used as the DB; otherwise s.db.
type EmitParams struct {
	LibraryID   uuid.UUID
	ActorID     *uuid.UUID // nil → system event
	Action      string
	SubjectType string
	SubjectID   *uuid.UUID
	Metadata    any
	Tx          *gorm.DB
}

// Service writes activity rows and (in Phase B) broadcasts them.
type Service struct {
	db  *gorm.DB
	hub *Hub // may be nil (worker mode or Phase A); Emit handles that
	bus *Bus // may be nil (Phase A; or if Redis unavailable)
}

// NewService constructs the activity service. hub may be nil for worker
// processes that don't accept WS connections; bus may be nil for Phase A
// or for tests that don't need cross-process fan-out.
func NewService(db *gorm.DB, hub *Hub, bus *Bus) *Service {
	return &Service{db: db, hub: hub, bus: bus}
}

// DB returns the underlying *gorm.DB (used by the HTTP handler for queries).
func (s *Service) DB() *gorm.DB { return s.db }

// Hub returns the local hub (may be nil). Used by the WS handler.
func (s *Service) Hub() *Hub { return s.hub }

// Emit writes an activity row and (if Phase B is active) publishes it on
// the bus for fan-out to connected WS clients. Errors are logged and
// returned; callers should generally ignore non-critical errors so a
// failed notification doesn't break the underlying user action.
func (s *Service) Emit(ctx context.Context, p EmitParams) (*models.LibraryActivity, error) {
	if p.LibraryID == uuid.Nil {
		return nil, errors.New("activity.Emit: LibraryID is required")
	}
	if p.Action == "" {
		return nil, errors.New("activity.Emit: Action is required")
	}

	metaBytes := []byte("{}")
	if p.Metadata != nil {
		b, err := json.Marshal(p.Metadata)
		if err != nil {
			return nil, err
		}
		metaBytes = b
	}

	row := &models.LibraryActivity{
		LibraryID:   p.LibraryID,
		ActorID:     p.ActorID,
		Action:      p.Action,
		SubjectType: p.SubjectType,
		SubjectID:   p.SubjectID,
		Metadata:    metaBytes,
	}

	db := s.db
	if p.Tx != nil {
		db = p.Tx
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, err
	}

	// Best-effort broadcast. Bus is nil in Phase A and in tests that don't
	// need realtime; in Phase B the bus publishes to Redis Pub/Sub.
	if s.bus != nil {
		envelope, err := s.buildEnvelope(row)
		if err == nil {
			if perr := s.bus.Publish(ctx, libraryChannel(p.LibraryID), envelope); perr != nil {
				log.Printf("activity: bus publish failed: %v", perr)
			}
		}
	}

	return row, nil
}

// EmitAsync runs Emit in a goroutine with a detached context and swallows
// errors after logging. Use this from request handlers when you want
// notifications to never block or fail the underlying user action.
func (s *Service) EmitAsync(p EmitParams) {
	// Detached context — the caller's request context may be cancelled
	// before the insert completes; we don't want that.
	go func() {
		if _, err := s.Emit(context.Background(), p); err != nil {
			log.Printf("activity: EmitAsync failed (action=%s lib=%s): %v",
				p.Action, p.LibraryID, err)
		}
	}()
}
