package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

type createFolderInput struct {
	LibraryID      string `json:"libraryId" jsonschema:"the library UUID to create the folder in"`
	Name           string `json:"name" jsonschema:"folder name (required, non-empty)"`
	ParentFolderID string `json:"parentFolderId,omitempty" jsonschema:"optional parent folder UUID; omit to create at the library root"`
}

type createFolderOutput struct {
	ID             string  `json:"id"`
	LibraryID      string  `json:"libraryId"`
	ParentFolderID *string `json:"parentFolderId"`
	Name           string  `json:"name"`
	CreatedAt      string  `json:"createdAt"`
}

func registerFolderTools(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_folder",
		Description: "Create a folder in a library, optionally nested under a parent folder. Requires admin access to the library.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createFolderInput) (*mcp.CallToolResult, createFolderOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, createFolderOutput{}, err
		}
		name := strings.TrimSpace(in.Name)
		if name == "" {
			return nil, createFolderOutput{}, fmt.Errorf("name is required")
		}
		id, _, err := d.requireLibraryAdmin(ctx, libraryID)
		if err != nil {
			return nil, createFolderOutput{}, err
		}

		var parentFolderID *uuid.UUID
		if in.ParentFolderID != "" && in.ParentFolderID != "null" {
			parsed, err := parseUUIDArg("parentFolderId", in.ParentFolderID)
			if err != nil {
				return nil, createFolderOutput{}, err
			}
			var count int64
			if err := d.DB.Model(&models.Folder{}).
				Where("id = ? AND library_id = ? AND trashed_at IS NULL", parsed, libraryID).
				Count(&count).Error; err != nil {
				return nil, createFolderOutput{}, fmt.Errorf("failed to look up parent folder")
			}
			if count == 0 {
				return nil, createFolderOutput{}, fmt.Errorf("parent folder %s not found in this library", parsed)
			}
			parentFolderID = &parsed
		}

		userID := id.UserID()
		folder := models.Folder{
			LibraryID:      libraryID,
			ParentFolderID: parentFolderID,
			OwnerID:        &userID,
			Name:           name,
		}
		if err := d.DB.Create(&folder).Error; err != nil {
			return nil, createFolderOutput{}, fmt.Errorf("failed to create folder")
		}

		aid := userID
		d.emitActivity(activity.EmitParams{
			LibraryID:   libraryID,
			ActorID:     &aid,
			Action:      activity.ActionFolderCreated,
			SubjectType: activity.SubjectFolder,
			SubjectID:   &folder.ID,
			Metadata: map[string]any{
				"name":           folder.Name,
				"parentFolderId": parentFolderID,
			},
		})

		return nil, createFolderOutput{
			ID:             folder.ID.String(),
			LibraryID:      folder.LibraryID.String(),
			ParentFolderID: uuidStrPtr(folder.ParentFolderID),
			Name:           folder.Name,
			CreatedAt:      rfc3339(folder.CreatedAt),
		}, nil
	})
}
