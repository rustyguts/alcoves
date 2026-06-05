package mcpserver

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
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

		libs, _ := d.Access.ListAccessibleLibraries(userID)
		out := listLibrariesOutput{Libraries: make([]librarySummary, 0, len(libs))}
		for i := range libs {
			lib := libs[i].Library
			role := string(libs[i].Access.Role)
			if role == "" {
				role = "viewer"
			}
			out.Libraries = append(out.Libraries, librarySummary{
				ID: lib.ID.String(), Name: lib.Name, Role: role, Emoji: deref(lib.Emoji),
			})
		}
		return nil, out, nil
	})
}
