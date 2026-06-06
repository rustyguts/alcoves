package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// tagColorPalette mirrors handlers.TagColorPalette / shared/tag-colors.ts so
// auto-assigned tag colors match the web app.
var tagColorPalette = []string{
	"#E11D48", "#F97316", "#F59E0B", "#EAB308",
	"#84CC16", "#22C55E", "#14B8A6", "#06B6D4",
	"#3B82F6", "#6366F1", "#8B5CF6", "#D946EF",
}

func registerTagTools(srv *mcp.Server, d Deps) {
	registerListTagsTool(srv, d)
	registerCreateTagTool(srv, d)
	registerSetFileTagsTool(srv, d)
}

// ─── list_tags ───────────────────────────────────────────────────────────────

type listTagsInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
}

type listTagsOutput struct {
	Tags []tagRef `json:"tags"`
}

func registerListTagsTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_tags",
		Description: "List all tags defined in a library (id, name, color). Use these tag IDs with set_file_tags. Requires viewer access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listTagsInput) (*mcp.CallToolResult, listTagsOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listTagsOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listTagsOutput{}, err
		}

		var tags []models.Tag
		d.DB.Where("library_id = ?", libraryID).Order("name").Find(&tags)
		out := listTagsOutput{Tags: make([]tagRef, 0, len(tags))}
		for i := range tags {
			out.Tags = append(out.Tags, tagRef{ID: tags[i].ID.String(), Name: tags[i].Name, Color: tags[i].Color})
		}
		return nil, out, nil
	})
}

// ─── create_tag ──────────────────────────────────────────────────────────────

type createTagInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
	Name      string `json:"name" jsonschema:"tag name (required, unique within the library)"`
	Color     string `json:"color,omitempty" jsonschema:"optional hex color like #3B82F6; auto-assigned from the palette if omitted"`
}

func registerCreateTagTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_tag",
		Description: "Create a tag in a library. A palette color is auto-assigned when color is omitted. Tag names are unique per library. Requires admin access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createTagInput) (*mcp.CallToolResult, tagRef, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, tagRef{}, err
		}
		name := strings.TrimSpace(in.Name)
		if name == "" {
			return nil, tagRef{}, fmt.Errorf("name is required")
		}
		id, _, err := d.requireLibraryAdmin(ctx, libraryID)
		if err != nil {
			return nil, tagRef{}, err
		}

		color := strings.TrimSpace(in.Color)
		if color == "" {
			color = d.nextAvailableTagColor(libraryID)
		}

		tag := models.Tag{LibraryID: libraryID, Name: name, Color: color}
		if err := d.DB.Create(&tag).Error; err != nil {
			return nil, tagRef{}, fmt.Errorf("tag name already in use")
		}

		aid := id.UserID()
		d.emitActivity(activity.EmitParams{
			LibraryID:   libraryID,
			ActorID:     &aid,
			Action:      activity.ActionTagCreated,
			SubjectType: activity.SubjectTag,
			SubjectID:   &tag.ID,
			Metadata:    map[string]any{"name": tag.Name, "color": tag.Color},
		})

		return nil, tagRef{ID: tag.ID.String(), Name: tag.Name, Color: tag.Color}, nil
	})
}

// nextAvailableTagColor mirrors handlers.nextAvailableColor: the first palette
// color not already used in the library, falling back to the first entry.
func (d Deps) nextAvailableTagColor(libraryID uuid.UUID) string {
	var used []string
	d.DB.Model(&models.Tag{}).Where("library_id = ?", libraryID).Pluck("color", &used)
	usedSet := map[string]bool{}
	for _, c := range used {
		usedSet[strings.ToUpper(c)] = true
	}
	for _, color := range tagColorPalette {
		if !usedSet[strings.ToUpper(color)] {
			return color
		}
	}
	return tagColorPalette[0]
}

// ─── set_file_tags ───────────────────────────────────────────────────────────

type setFileTagsInput struct {
	LibraryID string   `json:"libraryId" jsonschema:"the library UUID"`
	FileID    string   `json:"fileId" jsonschema:"the file UUID to tag"`
	TagIDs    []string `json:"tagIds" jsonschema:"the complete set of tag UUIDs the file should have (replaces all existing tags; pass an empty array to clear)"`
}

type setFileTagsOutput struct {
	Tags []tagRef `json:"tags"`
}

func registerSetFileTagsTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "set_file_tags",
		Description: "Replace the complete set of tags on a file with the given tag IDs (create tags first with create_tag). Pass an empty tagIds array to remove all tags. Requires admin access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in setFileTagsInput) (*mcp.CallToolResult, setFileTagsOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, setFileTagsOutput{}, err
		}
		fileID, err := parseUUIDArg("fileId", in.FileID)
		if err != nil {
			return nil, setFileTagsOutput{}, err
		}
		if _, _, err := d.requireLibraryAdmin(ctx, libraryID); err != nil {
			return nil, setFileTagsOutput{}, err
		}

		// File must belong to this library.
		exists, err := d.fileExists(libraryID, fileID)
		if err != nil {
			return nil, setFileTagsOutput{}, err
		}
		if !exists {
			return nil, setFileTagsOutput{}, errFileNotFound(fileID)
		}

		// Parse + validate every tag belongs to this library (prevents attaching
		// another library's tag — stricter than the legacy HTTP handler).
		tagIDs := make([]uuid.UUID, 0, len(in.TagIDs))
		for _, t := range in.TagIDs {
			tid, err := parseUUIDArg("tagIds", t)
			if err != nil {
				return nil, setFileTagsOutput{}, err
			}
			tagIDs = append(tagIDs, tid)
		}
		if len(tagIDs) > 0 {
			var count int64
			if err := d.DB.Model(&models.Tag{}).Where("id IN ? AND library_id = ?", tagIDs, libraryID).Count(&count).Error; err != nil {
				return nil, setFileTagsOutput{}, fmt.Errorf("failed to validate tags")
			}
			if int(count) != len(tagIDs) {
				return nil, setFileTagsOutput{}, fmt.Errorf("one or more tags do not belong to this library")
			}
		}

		// Replace atomically.
		if err := d.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("file_id = ?", fileID).Delete(&models.FileTag{}).Error; err != nil {
				return err
			}
			for _, tid := range tagIDs {
				if err := tx.Create(&models.FileTag{FileID: fileID, TagID: tid}).Error; err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, setFileTagsOutput{}, errFileNotFound(fileID)
			}
			return nil, setFileTagsOutput{}, fmt.Errorf("failed to set tags")
		}

		return nil, setFileTagsOutput{Tags: d.loadFileTagRefs(libraryID, fileID)}, nil
	})
}
