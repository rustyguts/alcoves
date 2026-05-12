package activity

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// ActivityResponse is the JSON shape returned by HTTP endpoints AND used
// as the broadcast payload over the WebSocket. Fields are camelCase to
// match the rest of the API.
type ActivityResponse struct {
	ID          string         `json:"id"`
	LibraryID   string         `json:"libraryId"`
	LibraryName string         `json:"libraryName,omitempty"`
	Actor       *ActorSummary  `json:"actor"`
	Action      string         `json:"action"`
	SubjectType string         `json:"subjectType"`
	SubjectID   *string        `json:"subjectId"`
	Metadata    map[string]any `json:"metadata"`
	CreatedAt   string         `json:"createdAt"`
	Dismissed   bool           `json:"dismissed"`
}

// ActorSummary is the user-summary embedded on each activity row.
type ActorSummary struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarUrl   *string `json:"avatarUrl"`
}

// ToResponse converts a model row + (optional) actor + library name into
// the JSON shape we return. Activity rows produced by Emit may not have
// the joins populated; the HTTP handler fills those in.
func ToResponse(row *models.LibraryActivity, actor *models.User, libraryName string, dismissed bool) ActivityResponse {
	resp := ActivityResponse{
		ID:          row.ID.String(),
		LibraryID:   row.LibraryID.String(),
		LibraryName: libraryName,
		Action:      row.Action,
		SubjectType: row.SubjectType,
		CreatedAt:   row.CreatedAt.Format("2006-01-02T15:04:05.999999999Z07:00"),
		Dismissed:   dismissed,
	}
	if row.SubjectID != nil {
		s := row.SubjectID.String()
		resp.SubjectID = &s
	}
	if actor != nil {
		resp.Actor = &ActorSummary{
			ID:          actor.ID.String(),
			DisplayName: actor.DisplayName,
			AvatarUrl:   actor.AvatarUrl,
		}
	}
	resp.Metadata = decodeMetadata(row.Metadata)
	return resp
}

// decodeMetadata never returns nil — keeps frontend type-narrowing simple.
func decodeMetadata(b []byte) map[string]any {
	if len(b) == 0 {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return map[string]any{}
	}
	if m == nil {
		return map[string]any{}
	}
	return m
}

// libraryChannel is the Redis Pub/Sub channel + the room name used for
// fan-out. Same name on both sides keeps debugging simple.
func libraryChannel(libraryID uuid.UUID) string {
	return fmt.Sprintf("activity:library:%s", libraryID.String())
}

// LibraryRoom is the WebSocket room name for a library.
func LibraryRoom(libraryID uuid.UUID) string {
	return fmt.Sprintf("library:%s", libraryID.String())
}

// UserRoom is the WebSocket room name for a single user (always auto-joined).
func UserRoom(userID uuid.UUID) string {
	return fmt.Sprintf("user:%s", userID.String())
}

// envelope is the JSON payload published on Redis Pub/Sub. The hub on
// each API process receives this and forwards `payload` to local clients
// in `rooms`.
type envelope struct {
	Rooms   []string         `json:"rooms"`
	Payload ActivityResponse `json:"payload"`
}

func (s *Service) buildEnvelope(row *models.LibraryActivity) ([]byte, error) {
	// Look up actor + library name so the websocket payload is
	// directly renderable without the client doing another fetch.
	var actor *models.User
	if row.ActorID != nil {
		var u models.User
		if err := s.db.Select("id, display_name, avatar_url").
			Where("id = ?", *row.ActorID).First(&u).Error; err == nil {
			actor = &u
		}
	}
	var libraryName string
	var lib models.Library
	if err := s.db.Select("id, name").Where("id = ?", row.LibraryID).First(&lib).Error; err == nil {
		libraryName = lib.Name
	}
	payload := ToResponse(row, actor, libraryName, false)
	env := envelope{
		Rooms:   []string{LibraryRoom(row.LibraryID)},
		Payload: payload,
	}
	return json.Marshal(env)
}
