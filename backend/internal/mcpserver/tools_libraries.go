package mcpserver

import (
	"context"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/models"
)

type listLibrariesInput struct{}

type librarySummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	Emoji string `json:"emoji,omitempty"`
}

type listLibrariesOutput struct {
	Libraries []librarySummary `json:"libraries"`
}

func registerLibraryTools(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_libraries",
		Description: "List the libraries the authenticated user can access, each with the user's role (owner, admin, or viewer).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ listLibrariesInput) (*mcp.CallToolResult, listLibrariesOutput, error) {
		id, err := d.identity(ctx)
		if err != nil {
			return nil, listLibrariesOutput{}, err
		}
		userID := id.UserID()

		// Owned libraries (owner role) UNION libraries the user is a member of.
		var owned []models.Library
		d.DB.Where("owner_id = ?", userID).Order("created_at").Find(&owned)

		var members []models.LibraryMember
		d.DB.Where("user_id = ?", userID).Find(&members)
		roles := make(map[uuid.UUID]string, len(members))
		memberIDs := make([]uuid.UUID, 0, len(members))
		for _, m := range members {
			roles[m.LibraryID] = m.Role
			memberIDs = append(memberIDs, m.LibraryID)
		}
		var memberLibs []models.Library
		if len(memberIDs) > 0 {
			d.DB.Where("id IN ?", memberIDs).Order("created_at").Find(&memberLibs)
		}

		out := listLibrariesOutput{Libraries: make([]librarySummary, 0, len(owned)+len(memberLibs))}
		for i := range owned {
			out.Libraries = append(out.Libraries, librarySummary{
				ID: owned[i].ID.String(), Name: owned[i].Name, Role: "owner", Emoji: deref(owned[i].Emoji),
			})
		}
		for i := range memberLibs {
			role := roles[memberLibs[i].ID]
			if role == "" {
				role = "viewer"
			}
			out.Libraries = append(out.Libraries, librarySummary{
				ID: memberLibs[i].ID.String(), Name: memberLibs[i].Name, Role: role, Emoji: deref(memberLibs[i].Emoji),
			})
		}
		return nil, out, nil
	})
}
