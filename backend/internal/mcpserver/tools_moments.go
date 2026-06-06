package mcpserver

import (
	"context"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/models"
)

type listMomentsInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
	FileID    string `json:"fileId" jsonschema:"the video file UUID whose moments to list"`
}

type momentEntry struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	StartSeconds float64  `json:"startSeconds"`
	EndSeconds   float64  `json:"endSeconds"`
	ExportStatus *string  `json:"exportStatus,omitempty"`
	CreatedAt    string   `json:"createdAt"`
	Tags         []tagRef `json:"tags"`
}

type listMomentsOutput struct {
	Moments []momentEntry `json:"moments"`
}

func registerMomentTools(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_moments",
		Description: "List the moments (named time ranges / clips) defined on a video file, ordered by start time, each with its tags and export status. Requires viewer access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listMomentsInput) (*mcp.CallToolResult, listMomentsOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listMomentsOutput{}, err
		}
		fileID, err := parseUUIDArg("fileId", in.FileID)
		if err != nil {
			return nil, listMomentsOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listMomentsOutput{}, err
		}
		// Confirm the file belongs to this library (consistent with the other
		// file-scoped tools). The moments query is library-pinned regardless.
		exists, err := d.fileExists(libraryID, fileID)
		if err != nil {
			return nil, listMomentsOutput{}, err
		}
		if !exists {
			return nil, listMomentsOutput{}, errFileNotFound(fileID)
		}

		var moments []models.Moment
		d.DB.Where("library_id = ? AND file_id = ? AND trashed_at IS NULL", libraryID, fileID).
			Order("start_seconds ASC, created_at ASC").Find(&moments)

		ids := make([]uuid.UUID, 0, len(moments))
		for i := range moments {
			ids = append(ids, moments[i].ID)
		}
		tagsByMoment := d.loadMomentTagRefs(libraryID, ids)

		out := listMomentsOutput{Moments: make([]momentEntry, 0, len(moments))}
		for i := range moments {
			m := &moments[i]
			tags := tagsByMoment[m.ID]
			if tags == nil {
				tags = []tagRef{}
			}
			out.Moments = append(out.Moments, momentEntry{
				ID:           m.ID.String(),
				Name:         m.Name,
				Description:  m.Description,
				StartSeconds: m.StartSeconds,
				EndSeconds:   m.EndSeconds,
				ExportStatus: m.ExportStatus,
				CreatedAt:    rfc3339(m.CreatedAt),
				Tags:         tags,
			})
		}
		return nil, out, nil
	})
}

// loadMomentTagRefs returns momentID → []tagRef for the given moments. The
// explicit t.library_id scope is defense-in-depth (callers already confirmed
// the moments belong to libraryID).
func (d Deps) loadMomentTagRefs(libraryID uuid.UUID, momentIDs []uuid.UUID) map[uuid.UUID][]tagRef {
	out := map[uuid.UUID][]tagRef{}
	if len(momentIDs) == 0 {
		return out
	}
	type row struct {
		MomentID uuid.UUID `gorm:"column:moment_id"`
		ID       string    `gorm:"column:id"`
		Name     string    `gorm:"column:name"`
		Color    string    `gorm:"column:color"`
	}
	var rows []row
	d.DB.Raw(`
		SELECT mt.moment_id, t.id, t.name, t.color
		FROM moment_tags mt INNER JOIN tags t ON t.id = mt.tag_id
		WHERE mt.moment_id IN ? AND t.library_id = ?
		ORDER BY t.name
	`, momentIDs, libraryID).Scan(&rows)
	for _, r := range rows {
		out[r.MomentID] = append(out[r.MomentID], tagRef{ID: r.ID, Name: r.Name, Color: r.Color})
	}
	return out
}
