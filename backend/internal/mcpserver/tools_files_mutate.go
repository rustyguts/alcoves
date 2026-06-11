package mcpserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

func registerFileMutationTools(srv *mcp.Server, d Deps) {
	registerUpdateFileTool(srv, d)
	registerTrashFileTool(srv, d)
	registerRestoreFileTool(srv, d)
}

// ─── update_file (rename and/or move) ────────────────────────────────────────

type updateFileInput struct {
	LibraryID string  `json:"libraryId" jsonschema:"the library UUID containing the file"`
	FileID    string  `json:"fileId" jsonschema:"the file UUID to update"`
	Name      *string `json:"name,omitempty" jsonschema:"new file name (omit to leave unchanged)"`
	// ParentFolderID is a pointer so the three cases are distinguishable: absent
	// = leave the folder unchanged; "" or "null" = move to the library root;
	// a UUID = move into that folder.
	ParentFolderID *string `json:"parentFolderId,omitempty" jsonschema:"destination folder UUID, or \"\"/\"null\" to move to the library root; omit to leave the folder unchanged"`
}

type updateFileOutput struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	ParentFolderID *string `json:"parentFolderId"`
	UpdatedAt      string  `json:"updatedAt"`
}

func registerUpdateFileTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "update_file",
		Description: "Rename a file and/or move it to another folder (or to the library root). Provide name to rename, parentFolderId to move. Requires admin access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in updateFileInput) (*mcp.CallToolResult, updateFileOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, updateFileOutput{}, err
		}
		fileID, err := parseUUIDArg("fileId", in.FileID)
		if err != nil {
			return nil, updateFileOutput{}, err
		}
		if _, _, err := d.requireLibraryAdmin(ctx, libraryID); err != nil {
			return nil, updateFileOutput{}, err
		}

		updates := map[string]any{}
		if in.Name != nil {
			name := strings.TrimSpace(*in.Name)
			if name == "" {
				return nil, updateFileOutput{}, fmt.Errorf("name cannot be empty")
			}
			updates["name"] = name
		}
		if in.ParentFolderID != nil {
			val := strings.TrimSpace(*in.ParentFolderID)
			if val == "" || val == "null" {
				updates["parent_folder_id"] = nil
			} else {
				parsed, err := parseUUIDArg("parentFolderId", val)
				if err != nil {
					return nil, updateFileOutput{}, err
				}
				var count int64
				if err := d.DB.Model(&models.Folder{}).
					Where("id = ? AND library_id = ? AND trashed_at IS NULL", parsed, libraryID).
					Count(&count).Error; err != nil {
					return nil, updateFileOutput{}, fmt.Errorf("failed to look up destination folder")
				}
				if count == 0 {
					return nil, updateFileOutput{}, fmt.Errorf("destination folder %s not found in this library", parsed)
				}
				updates["parent_folder_id"] = parsed
			}
		}
		if len(updates) == 0 {
			return nil, updateFileOutput{}, fmt.Errorf("nothing to update: provide name and/or parentFolderId")
		}
		updates["updated_at"] = time.Now()

		res := d.DB.Model(&models.File{}).
			Where("id = ? AND library_id = ?", fileID, libraryID).
			Updates(updates)
		if res.Error != nil {
			return nil, updateFileOutput{}, fmt.Errorf("failed to update file")
		}
		if res.RowsAffected == 0 {
			return nil, updateFileOutput{}, errFileNotFound(fileID)
		}

		var f models.File
		if err := d.DB.Select("id, name, parent_folder_id, updated_at").
			Where("id = ? AND library_id = ?", fileID, libraryID).First(&f).Error; err != nil {
			return nil, updateFileOutput{}, err
		}
		return nil, updateFileOutput{
			ID:             f.ID.String(),
			Name:           f.Name,
			ParentFolderID: uuidStrPtr(f.ParentFolderID),
			UpdatedAt:      rfc3339(f.UpdatedAt),
		}, nil
	})
}

// ─── trash_file (soft delete) ────────────────────────────────────────────────

type trashFileInput struct {
	LibraryID string   `json:"libraryId" jsonschema:"the library UUID"`
	FileIDs   []string `json:"fileIds" jsonschema:"one or more file UUIDs to move to the trash (soft-delete; reversible with restore_file)"`
}

type trashFileOutput struct {
	Trashed int64 `json:"trashed"`
}

func registerTrashFileTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "trash_file",
		Description: "Move one or more files to the trash (a reversible soft-delete; use restore_file to undo, or the web app to permanently purge). Requires admin access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in trashFileInput) (*mcp.CallToolResult, trashFileOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, trashFileOutput{}, err
		}
		ids, err := parseUUIDList("fileIds", in.FileIDs)
		if err != nil {
			return nil, trashFileOutput{}, err
		}
		id, _, err := d.requireLibraryAdmin(ctx, libraryID)
		if err != nil {
			return nil, trashFileOutput{}, err
		}

		now := time.Now()
		res := d.DB.Model(&models.File{}).
			Where("id IN ? AND library_id = ? AND trashed_at IS NULL", ids, libraryID).
			Updates(map[string]any{"trashed_at": now, "updated_at": now})
		if res.Error != nil {
			return nil, trashFileOutput{}, fmt.Errorf("failed to trash files")
		}

		if res.RowsAffected > 0 {
			aid := id.UserID()
			d.emitActivity(activity.EmitParams{
				LibraryID:   libraryID,
				ActorID:     &aid,
				Action:      activity.ActionFileDeleted,
				SubjectType: activity.SubjectFile,
				Metadata:    map[string]any{"count": res.RowsAffected},
			})
		}
		return nil, trashFileOutput{Trashed: res.RowsAffected}, nil
	})
}

// ─── restore_file ────────────────────────────────────────────────────────────

type restoreFileInput struct {
	LibraryID string   `json:"libraryId" jsonschema:"the library UUID"`
	FileIDs   []string `json:"fileIds" jsonschema:"one or more trashed file UUIDs to restore (restored to the library root)"`
}

type restoreFileOutput struct {
	Restored int64 `json:"restored"`
}

func registerRestoreFileTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "restore_file",
		Description: "Restore one or more trashed files. Like the web app, restored files return to the library root. Requires admin access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in restoreFileInput) (*mcp.CallToolResult, restoreFileOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, restoreFileOutput{}, err
		}
		ids, err := parseUUIDList("fileIds", in.FileIDs)
		if err != nil {
			return nil, restoreFileOutput{}, err
		}
		if _, _, err := d.requireLibraryAdmin(ctx, libraryID); err != nil {
			return nil, restoreFileOutput{}, err
		}

		res := d.DB.Model(&models.File{}).
			Where("id IN ? AND library_id = ? AND trashed_at IS NOT NULL", ids, libraryID).
			Updates(map[string]any{
				"trashed_at":       nil,
				"parent_folder_id": nil,
				"updated_at":       time.Now(),
			})
		if res.Error != nil {
			return nil, restoreFileOutput{}, fmt.Errorf("failed to restore files")
		}
		return nil, restoreFileOutput{Restored: res.RowsAffected}, nil
	})
}

// parseUUIDList validates a non-empty list of UUID strings.
func parseUUIDList(field string, vals []string) ([]uuid.UUID, error) {
	if len(vals) == 0 {
		return nil, fmt.Errorf("%s is required (at least one UUID)", field)
	}
	out := make([]uuid.UUID, 0, len(vals))
	for _, v := range vals {
		id, err := parseUUIDArg(field, v)
		if err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}
