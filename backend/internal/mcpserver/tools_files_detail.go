package mcpserver

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/filehash"
)

type getFileInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID containing the file"`
	FileID    string `json:"fileId" jsonschema:"the file UUID"`
}

type tagRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type fileDetail struct {
	ID             string  `json:"id"`
	LibraryID      string  `json:"libraryId"`
	ParentFolderID *string `json:"parentFolderId"`
	Name           string  `json:"name"`
	MimeType       string  `json:"mimeType"`
	Size           int64   `json:"size"`
	Duration       *int    `json:"duration,omitempty"`
	Width          *int    `json:"width,omitempty"`
	Height         *int    `json:"height,omitempty"`
	Hash           *string `json:"hash,omitempty"`
	TrashedAt      *string `json:"trashedAt,omitempty"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`

	// Capture metadata (EXIF / ffprobe), surfaced for Timeline + Map context.
	CapturedAt  *string  `json:"capturedAt,omitempty"`
	GpsLat      *float64 `json:"gpsLat,omitempty"`
	GpsLon      *float64 `json:"gpsLon,omitempty"`
	CameraMake  *string  `json:"cameraMake,omitempty"`
	CameraModel *string  `json:"cameraModel,omitempty"`

	// Processing status of the async AI/media pipelines for this file. Useful
	// for an agent to know whether get_transcript / list_audio_events will have
	// data yet.
	ProxyStatus       *string `json:"proxyStatus,omitempty"`
	TranscribeStatus  *string `json:"transcribeStatus,omitempty"`
	TranscriptModel   *string `json:"transcriptModel,omitempty"`
	AudioDetectStatus *string `json:"audioDetectStatus,omitempty"`
	WaveformStatus    *string `json:"waveformStatus,omitempty"`

	// Dedup: other non-trashed source files in this library sharing the hash.
	HasDuplicates      bool     `json:"hasDuplicates"`
	DuplicateOfFileIDs []string `json:"duplicateOfFileIds"`

	Tags []tagRef `json:"tags"`
}

func registerFileDetailTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_file",
		Description: "Get full details for a single file: size, type, dimensions/duration, capture metadata (date, GPS, camera), AI-pipeline status (transcript, audio detection, proxy, waveform), tags, and duplicate matches.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getFileInput) (*mcp.CallToolResult, fileDetail, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, fileDetail{}, err
		}
		fileID, err := parseUUIDArg("fileId", in.FileID)
		if err != nil {
			return nil, fileDetail{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, fileDetail{}, err
		}

		var f models.File
		if err := d.DB.Where("id = ? AND library_id = ?", fileID, libraryID).First(&f).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fileDetail{}, errFileNotFound(fileID)
			}
			return nil, fileDetail{}, err
		}

		out := fileDetail{
			ID:                 f.ID.String(),
			LibraryID:          f.LibraryID.String(),
			ParentFolderID:     uuidStrPtr(f.ParentFolderID),
			Name:               f.Name,
			MimeType:           f.MimeType,
			Size:               f.Size,
			Duration:           f.Duration,
			Width:              f.Width,
			Height:             f.Height,
			Hash:               f.Hash,
			TrashedAt:          rfc3339Ptr(f.TrashedAt),
			CreatedAt:          rfc3339(f.CreatedAt),
			UpdatedAt:          rfc3339(f.UpdatedAt),
			CapturedAt:         rfc3339Ptr(f.CapturedAt),
			GpsLat:             f.GpsLat,
			GpsLon:             f.GpsLon,
			CameraMake:         f.CameraMake,
			CameraModel:        f.CameraModel,
			ProxyStatus:        f.ProxyStatus,
			TranscribeStatus:   f.TranscribeStatus,
			TranscriptModel:    f.TranscriptModel,
			AudioDetectStatus:  f.AudioDetectStatus,
			WaveformStatus:     f.WaveformStatus,
			DuplicateOfFileIDs: []string{},
			Tags:               []tagRef{},
		}

		// Duplicates (same per-library hash logic as the HTTP file detail).
		if f.Hash != nil && f.SourceFileID == nil {
			if dupes, derr := filehash.FindDuplicates(d.DB, f.LibraryID, f.ID, *f.Hash); derr == nil {
				for _, id := range dupes {
					out.DuplicateOfFileIDs = append(out.DuplicateOfFileIDs, id.String())
				}
			}
		}
		out.HasDuplicates = len(out.DuplicateOfFileIDs) > 0

		out.Tags = d.loadFileTagRefs(libraryID, fileID)
		return nil, out, nil
	})
}

// loadFileTagRefs returns a file's tags as lightweight refs, ordered by name.
// The explicit t.library_id scope is defense-in-depth: callers already confirm
// the file belongs to libraryID, so the join can never surface a foreign tag.
func (d Deps) loadFileTagRefs(libraryID, fileID uuid.UUID) []tagRef {
	type row struct {
		ID    string `gorm:"column:id"`
		Name  string `gorm:"column:name"`
		Color string `gorm:"column:color"`
	}
	var rows []row
	d.DB.Raw(`
		SELECT t.id, t.name, t.color
		FROM file_tags ft INNER JOIN tags t ON t.id = ft.tag_id
		WHERE ft.file_id = ? AND t.library_id = ?
		ORDER BY t.name
	`, fileID, libraryID).Scan(&rows)
	out := make([]tagRef, 0, len(rows))
	for _, r := range rows {
		out = append(out, tagRef{ID: r.ID, Name: r.Name, Color: r.Color})
	}
	return out
}
