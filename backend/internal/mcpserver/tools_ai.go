package mcpserver

import (
	"context"
	"errors"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func registerInsightTools(srv *mcp.Server, d Deps) {
	registerGetTranscriptTool(srv, d)
	registerListAudioEventsTool(srv, d)
	registerListPeopleTool(srv, d)
	registerListObjectsTool(srv, d)
}

// loadActiveFile loads a non-trashed file scoped to its library, returning the
// canonical not-found error otherwise.
func (d Deps) loadActiveFile(libraryID, fileID any, dst *models.File) error {
	err := d.DB.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(dst).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("file not found in this library (or it is trashed)")
	}
	return err
}

// ─── get_transcript ──────────────────────────────────────────────────────────

type getTranscriptInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
	FileID    string `json:"fileId" jsonschema:"the audio/video file UUID"`
}

type getTranscriptOutput struct {
	Ready  bool    `json:"ready"`
	Status *string `json:"status,omitempty"`
	Model  *string `json:"model,omitempty"`
	Text   *string `json:"text,omitempty"`
	VTT    *string `json:"vtt,omitempty"`
}

func registerGetTranscriptTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_transcript",
		Description: "Get the speech transcript of an audio/video file (plain text + WebVTT with timestamps). Returns ready=false with the current status if transcription hasn't completed. Requires viewer access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getTranscriptInput) (*mcp.CallToolResult, getTranscriptOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, getTranscriptOutput{}, err
		}
		fileID, err := parseUUIDArg("fileId", in.FileID)
		if err != nil {
			return nil, getTranscriptOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, getTranscriptOutput{}, err
		}

		var f models.File
		if err := d.loadActiveFile(libraryID, fileID, &f); err != nil {
			return nil, getTranscriptOutput{}, err
		}
		if f.TranscribeStatus == nil || *f.TranscribeStatus != "ready" {
			return nil, getTranscriptOutput{Ready: false, Status: f.TranscribeStatus}, nil
		}
		return nil, getTranscriptOutput{
			Ready:  true,
			Status: f.TranscribeStatus,
			Model:  f.TranscriptModel,
			Text:   f.TranscriptText,
			VTT:    f.TranscriptVTT,
		}, nil
	})
}

// ─── list_audio_events ───────────────────────────────────────────────────────

type listAudioEventsInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
	FileID    string `json:"fileId" jsonschema:"the audio/video file UUID"`
}

type audioEvent struct {
	Label        string  `json:"label"`
	Score        float32 `json:"score"`
	StartSeconds float32 `json:"startSeconds"`
	EndSeconds   float32 `json:"endSeconds"`
}

type listAudioEventsOutput struct {
	Events []audioEvent `json:"events"`
}

func registerListAudioEventsTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_audio_events",
		Description: "List AI-detected sound events in an audio/video file (e.g. speech, music, applause, dog bark) with their timestamps and confidence scores, ordered by start time. Requires viewer access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listAudioEventsInput) (*mcp.CallToolResult, listAudioEventsOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listAudioEventsOutput{}, err
		}
		fileID, err := parseUUIDArg("fileId", in.FileID)
		if err != nil {
			return nil, listAudioEventsOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listAudioEventsOutput{}, err
		}
		var f models.File
		if err := d.loadActiveFile(libraryID, fileID, &f); err != nil {
			return nil, listAudioEventsOutput{}, err
		}

		var dets []models.AudioDetection
		d.DB.Where("library_id = ? AND file_id = ?", libraryID, fileID).
			Order("start_seconds ASC, score DESC").Find(&dets)
		out := listAudioEventsOutput{Events: make([]audioEvent, 0, len(dets))}
		for _, det := range dets {
			out.Events = append(out.Events, audioEvent{
				Label: det.Label, Score: det.Score,
				StartSeconds: det.StartSeconds, EndSeconds: det.EndSeconds,
			})
		}
		return nil, out, nil
	})
}

// ─── list_people ─────────────────────────────────────────────────────────────

type listPeopleInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
}

type personEntry struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	FaceCount int     `json:"faceCount"`
}

type listPeopleOutput struct {
	People []personEntry `json:"people"`
}

func registerListPeopleTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_people",
		Description: "List the people (face-recognition clusters) in a library, with their names (if set) and number of detected faces, most-faces-first among named people. Requires viewer access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listPeopleInput) (*mcp.CallToolResult, listPeopleOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listPeopleOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listPeopleOutput{}, err
		}

		var people []models.Person
		d.DB.Where("library_id = ? AND face_count > 0", libraryID).
			Order("COALESCE(name, '') ASC, face_count DESC").Find(&people)
		out := listPeopleOutput{People: make([]personEntry, 0, len(people))}
		for i := range people {
			out.People = append(out.People, personEntry{
				ID: people[i].ID.String(), Name: people[i].Name, FaceCount: people[i].FaceCount,
			})
		}
		return nil, out, nil
	})
}

// ─── list_objects ────────────────────────────────────────────────────────────

type listObjectsInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
	FileID    string `json:"fileId,omitempty" jsonschema:"optional file UUID; when set, returns the individual object detections for that file instead of the library label summary"`
}

type objectLabel struct {
	Label     string `json:"label"`
	FileCount int    `json:"fileCount"`
}

type objectDetection struct {
	Label      string `json:"label"`
	Confidence int    `json:"confidence"`
	BoxX       int    `json:"boxX"`
	BoxY       int    `json:"boxY"`
	BoxWidth   int    `json:"boxWidth"`
	BoxHeight  int    `json:"boxHeight"`
}

type listObjectsOutput struct {
	// Library-level summary (when fileId is omitted).
	Labels []objectLabel `json:"labels,omitempty"`
	// Per-file detections (when fileId is set).
	Detections []objectDetection `json:"detections,omitempty"`
}

func registerListObjectsTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_objects",
		Description: "List AI-detected objects. With only libraryId, returns the library's distinct object labels and how many files contain each (e.g. dog→12). With a fileId, returns the individual detections in that file (label, confidence, bounding box). Requires viewer access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listObjectsInput) (*mcp.CallToolResult, listObjectsOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listObjectsOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listObjectsOutput{}, err
		}

		if in.FileID != "" {
			fileID, err := parseUUIDArg("fileId", in.FileID)
			if err != nil {
				return nil, listObjectsOutput{}, err
			}
			exists, err := d.fileExists(libraryID, fileID)
			if err != nil {
				return nil, listObjectsOutput{}, err
			}
			if !exists {
				return nil, listObjectsOutput{}, errFileNotFound(fileID)
			}
			var dets []models.ObjectDetection
			d.DB.Where("library_id = ? AND file_id = ?", libraryID, fileID).
				Order("confidence DESC").Find(&dets)
			out := listObjectsOutput{Detections: make([]objectDetection, 0, len(dets))}
			for _, det := range dets {
				out.Detections = append(out.Detections, objectDetection{
					Label: det.Label, Confidence: det.Confidence,
					BoxX: det.BoxX, BoxY: det.BoxY, BoxWidth: det.BoxWidth, BoxHeight: det.BoxHeight,
				})
			}
			return nil, out, nil
		}

		type row struct {
			Label     string `gorm:"column:label"`
			FileCount int    `gorm:"column:file_count"`
		}
		var rows []row
		d.DB.Raw(`
			SELECT label, COUNT(DISTINCT file_id) as file_count
			FROM object_detections
			WHERE library_id = ?
			GROUP BY label
			ORDER BY file_count DESC, label ASC
		`, libraryID).Scan(&rows)
		out := listObjectsOutput{Labels: make([]objectLabel, 0, len(rows))}
		for _, r := range rows {
			out.Labels = append(out.Labels, objectLabel{Label: r.Label, FileCount: r.FileCount})
		}
		return nil, out, nil
	})
}
