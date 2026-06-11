package mcpserver

import (
	"context"
	"fmt"
	"time"

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
		Description: "List the libraries the authenticated user can access, each with the user's role (owner, admin, or viewer). Start here to discover library IDs for the other tools.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ listLibrariesInput) (*mcp.CallToolResult, listLibrariesOutput, error) {
		id, err := d.identity(ctx)
		if err != nil {
			return nil, listLibrariesOutput{}, err
		}
		userID := id.UserID()

		libs, err := d.Access.ListAccessibleLibraries(userID)
		if err != nil {
			return nil, listLibrariesOutput{}, fmt.Errorf("failed to list libraries")
		}
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

	registerGetLibraryTool(srv, d)
	registerListMembersTool(srv, d)
}

// ─── get_library ─────────────────────────────────────────────────────────────

type getLibraryInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
}

type libraryDetail struct {
	ID                     string  `json:"id"`
	Name                   string  `json:"name"`
	Emoji                  *string `json:"emoji"`
	IsDefault              bool    `json:"isDefault"`
	Role                   string  `json:"role"`
	IsOwner                bool    `json:"isOwner"`
	IsAdmin                bool    `json:"isAdmin"`
	OwnerID                string  `json:"ownerId"`
	FaceRecognitionEnabled bool    `json:"faceRecognitionEnabled"`
	ObjectDetectionEnabled bool    `json:"objectDetectionEnabled"`
	SharingEnabled         bool    `json:"sharingEnabled"`
	CreatedAt              string  `json:"createdAt"`
	UpdatedAt              string  `json:"updatedAt"`
}

func registerGetLibraryTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_library",
		Description: "Get a single library's details: name, emoji, owner, your role, and which AI features (face recognition, object detection, public sharing) are enabled.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getLibraryInput) (*mcp.CallToolResult, libraryDetail, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, libraryDetail{}, err
		}
		_, acc, err := d.requireLibraryAccess(ctx, libraryID)
		if err != nil {
			return nil, libraryDetail{}, err
		}

		var lib models.Library
		if err := d.DB.Where("id = ?", libraryID).First(&lib).Error; err != nil {
			return nil, libraryDetail{}, err
		}
		role := string(acc.Role)
		if role == "" {
			role = "viewer"
		}
		return nil, libraryDetail{
			ID:                     lib.ID.String(),
			Name:                   lib.Name,
			Emoji:                  lib.Emoji,
			IsDefault:              lib.IsDefault,
			Role:                   role,
			IsOwner:                acc.IsOwner,
			IsAdmin:                acc.IsAdmin,
			OwnerID:                lib.OwnerID.String(),
			FaceRecognitionEnabled: lib.FaceRecognitionEnabled,
			ObjectDetectionEnabled: lib.ObjectDetectionEnabled,
			SharingEnabled:         lib.SharingEnabled,
			CreatedAt:              rfc3339(lib.CreatedAt),
			UpdatedAt:              rfc3339(lib.UpdatedAt),
		}, nil
	})
}

// ─── list_members ────────────────────────────────────────────────────────────

type listMembersInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
}

type memberEntry struct {
	UserID      string `json:"userId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	IsOwner     bool   `json:"isOwner"`
	JoinedAt    string `json:"joinedAt"`
}

type listMembersOutput struct {
	Members []memberEntry `json:"members"`
}

func registerListMembersTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_members",
		Description: "List the members of a library and their roles (owner first, then admins and viewers). Requires viewer access or above.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listMembersInput) (*mcp.CallToolResult, listMembersOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listMembersOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listMembersOutput{}, err
		}

		out := listMembersOutput{Members: []memberEntry{}}

		// Owner first.
		var lib models.Library
		if err := d.DB.Select("owner_id").Where("id = ?", libraryID).First(&lib).Error; err != nil {
			return nil, listMembersOutput{}, err
		}
		var owner models.User
		if err := d.DB.Select("id, email, display_name, created_at").Where("id = ?", lib.OwnerID).First(&owner).Error; err == nil {
			out.Members = append(out.Members, memberEntry{
				UserID:      owner.ID.String(),
				Email:       owner.Email,
				DisplayName: owner.DisplayName,
				Role:        "owner",
				IsOwner:     true,
				JoinedAt:    rfc3339(owner.CreatedAt),
			})
		}

		// Then collaborators, oldest first (matches the web member list order).
		type row struct {
			UserID      string    `gorm:"column:user_id"`
			Role        string    `gorm:"column:role"`
			CreatedAt   time.Time `gorm:"column:created_at"`
			Email       string    `gorm:"column:email"`
			DisplayName string    `gorm:"column:display_name"`
		}
		var rows []row
		d.DB.Raw(`
			SELECT lm.user_id, lm.role, lm.created_at, u.email, u.display_name
			FROM library_members lm
			INNER JOIN users u ON u.id = lm.user_id
			WHERE lm.library_id = ?
			ORDER BY lm.created_at
		`, libraryID).Scan(&rows)
		for _, r := range rows {
			out.Members = append(out.Members, memberEntry{
				UserID:      r.UserID,
				Email:       r.Email,
				DisplayName: r.DisplayName,
				Role:        r.Role,
				IsOwner:     false,
				JoinedAt:    rfc3339(r.CreatedAt),
			})
		}
		return nil, out, nil
	})
}
