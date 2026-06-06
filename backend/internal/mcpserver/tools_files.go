package mcpserver

import (
	"context"
	"strconv"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/services/files"
)

type listFilesInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID to list"`
	FolderID  string `json:"folderId,omitempty" jsonschema:"optional parent folder UUID; omit for the library root"`
	Trashed   bool   `json:"trashed,omitempty" jsonschema:"list trashed entries instead of active ones"`
	Cursor    string `json:"cursor,omitempty" jsonschema:"opaque pagination cursor returned by a previous call"`
	Limit     int    `json:"limit,omitempty" jsonschema:"page size, 1-200 (default 50)"`
}

// fileEntry flattens the file|folder union the listing service returns into a
// single shape with a kind discriminator — easier for a model to consume.
type fileEntry struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"` // "file" or "folder"
	Name           string `json:"name"`
	ParentFolderID string `json:"parentFolderId,omitempty"`
	MimeType       string `json:"mimeType,omitempty"`
	Size           int64  `json:"size,omitempty"`
	TrashedAt      string `json:"trashedAt,omitempty"`
	CreatedAt      string `json:"createdAt,omitempty"`
}

type listFilesOutput struct {
	Entries    []fileEntry `json:"entries"`
	NextCursor string      `json:"nextCursor,omitempty"`
	TotalCount int         `json:"totalCount"`
}

func registerFileTools(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_files",
		Description: "List files and folders in a library (optionally within a folder), with cursor pagination.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listFilesInput) (*mcp.CallToolResult, listFilesOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listFilesOutput{}, err
		}
		// Viewer access is enough to list.
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listFilesOutput{}, err
		}

		limit := ""
		if in.Limit > 0 {
			limit = strconv.Itoa(in.Limit)
		}
		page, err := d.Files.ListLibraryFiles(in.LibraryID, files.ListParams{
			Trashed: in.Trashed,
			Limit:   limit,
			Folder:  in.FolderID,
			Cursor:  in.Cursor,
		})
		if err != nil {
			return nil, listFilesOutput{}, err
		}

		out := listFilesOutput{
			Entries:    make([]fileEntry, 0, len(page.Entries)),
			TotalCount: page.TotalCount,
		}
		if page.NextCursor != nil {
			out.NextCursor = *page.NextCursor
		}
		for _, e := range page.Entries {
			switch v := e.(type) {
			case files.FileResponse:
				out.Entries = append(out.Entries, fileEntry{
					ID: v.ID, Kind: "file", Name: v.Name,
					ParentFolderID: deref(v.ParentFolderID),
					MimeType:       v.MimeType, Size: v.Size,
					TrashedAt: deref(v.TrashedAt), CreatedAt: v.CreatedAt,
				})
			case files.FolderResponse:
				out.Entries = append(out.Entries, fileEntry{
					ID: v.ID, Kind: "folder", Name: v.Name,
					ParentFolderID: deref(v.ParentFolderID),
					TrashedAt:      deref(v.TrashedAt), CreatedAt: v.CreatedAt,
				})
			}
		}
		return nil, out, nil
	})
}
