package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/docs"
	"github.com/alcoves/alcoves-backend/internal/services/files"
)

// Live-document tools — the Notion-MCP-shaped surface: markdown in, markdown
// out. A document IS a text/markdown file in a library, so the file tools
// (list_files, search, trash_file, …) all apply to documents too; these three
// add content-level create/read/update.
//
// The server holds Yjs CRDT state it cannot merge into, so update_document has
// replace semantics: it atomically drops the CRDT sidecar and materializes the
// new markdown — the next open re-seeds from the blob, and connected editors
// are told to resync (their unposted keystrokes are superseded, like replacing
// a file's content in Notion while someone is typing).

type createDocumentInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID to create the document in"`
	Name      string `json:"name" jsonschema:"document name; '.md' is appended when missing"`
	Content   string `json:"content,omitempty" jsonschema:"initial markdown content (optional; empty creates a blank document)"`
	FolderID  string `json:"folderId,omitempty" jsonschema:"optional folder UUID; omit to create at the library root"`
}

type documentOutput struct {
	FileID    string `json:"fileId"`
	LibraryID string `json:"libraryId"`
	Name      string `json:"name"`
	Markdown  string `json:"markdown,omitempty"`
	Size      int64  `json:"size"`
	// Live is true when the document has realtime CRDT state (someone opened
	// it in the collaborative editor). Markdown then reflects the last
	// materialization, at most ~a minute behind live typing.
	Live      bool   `json:"live"`
	UpdatedAt string `json:"updatedAt"`
}

type readDocumentInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
	FileID    string `json:"fileId" jsonschema:"the markdown file UUID (see list_files or search)"`
}

type updateDocumentInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
	FileID    string `json:"fileId" jsonschema:"the markdown file UUID"`
	Content   string `json:"content" jsonschema:"the full new markdown content (replaces the document)"`
}

func registerDocumentTools(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name: "create_document",
		Description: "Create a markdown document in a library, optionally inside a folder and with " +
			"initial content. Documents open in Alcoves' live collaborative editor. Requires admin " +
			"access to the library.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createDocumentInput) (*mcp.CallToolResult, documentOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, documentOutput{}, err
		}
		name := strings.TrimSpace(in.Name)
		if name == "" {
			return nil, documentOutput{}, fmt.Errorf("name is required")
		}
		if !strings.HasSuffix(strings.ToLower(name), ".md") && !strings.HasSuffix(strings.ToLower(name), ".markdown") {
			name += ".md"
		}
		if len(in.Content) > docs.MaxTextBytes {
			return nil, documentOutput{}, fmt.Errorf("content exceeds the %d byte document limit", docs.MaxTextBytes)
		}
		id, _, err := d.requireLibraryAdmin(ctx, libraryID)
		if err != nil {
			return nil, documentOutput{}, err
		}

		var folderID *uuid.UUID
		if in.FolderID != "" && in.FolderID != "null" {
			parsed, err := parseUUIDArg("folderId", in.FolderID)
			if err != nil {
				return nil, documentOutput{}, err
			}
			var count int64
			if err := d.DB.Model(&models.Folder{}).
				Where("id = ? AND library_id = ? AND trashed_at IS NULL", parsed, libraryID).
				Count(&count).Error; err != nil {
				return nil, documentOutput{}, fmt.Errorf("failed to look up folder")
			}
			if count == 0 {
				return nil, documentOutput{}, fmt.Errorf("folder %s not found in this library", parsed)
			}
			folderID = &parsed
		}

		// The shared ingest pipeline (blob, file row, activity, dedup) — the
		// same path as uploads and the web app's "New Document".
		result, err := d.Files.IngestStream(ctx, files.IngestParams{
			LibraryID: libraryID,
			OwnerID:   id.UserID(),
			FolderID:  folderID,
			Name:      name,
			MimeType:  "text/markdown",
		}, strings.NewReader(in.Content))
		if err != nil {
			return nil, documentOutput{}, fmt.Errorf("failed to create document")
		}

		return nil, documentOutput{
			FileID:    result.File.ID.String(),
			LibraryID: libraryID.String(),
			Name:      result.File.Name,
			Markdown:  in.Content,
			Size:      result.File.Size,
			Live:      false,
			UpdatedAt: rfc3339(result.File.UpdatedAt),
		}, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "read_document",
		Description: "Read a markdown document's content. For documents being edited live, the " +
			"content reflects the last materialization (at most ~a minute behind active typing).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in readDocumentInput) (*mcp.CallToolResult, documentOutput, error) {
		libraryID, fileID, file, err := d.resolveDocument(ctx, in.LibraryID, in.FileID, false)
		if err != nil {
			return nil, documentOutput{}, err
		}
		text, err := d.Storage.ReadFileBuffer(libraryID.String(), fileID.String())
		if err != nil {
			text = nil // a fresh empty document has no blob yet
		}
		var live int64
		if err := d.DB.Model(&models.Document{}).Where("file_id = ?", fileID).Count(&live).Error; err != nil {
			return nil, documentOutput{}, fmt.Errorf("failed to load document state")
		}
		return nil, documentOutput{
			FileID:    fileID.String(),
			LibraryID: libraryID.String(),
			Name:      file.Name,
			Markdown:  string(text),
			Size:      file.Size,
			Live:      live > 0,
			UpdatedAt: rfc3339(file.UpdatedAt),
		}, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "update_document",
		Description: "Replace a markdown document's content wholesale. Anyone editing the document " +
			"live is resynced to the new content (their in-flight keystrokes are superseded). " +
			"Requires admin access to the library.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in updateDocumentInput) (*mcp.CallToolResult, documentOutput, error) {
		libraryID, fileID, file, err := d.resolveDocument(ctx, in.LibraryID, in.FileID, true)
		if err != nil {
			return nil, documentOutput{}, err
		}
		if d.Docs == nil {
			return nil, documentOutput{}, fmt.Errorf("document editing is not available on this server")
		}
		if err := d.Docs.ReplaceContent(ctx, libraryID, fileID, in.Content); err != nil {
			switch err {
			case docs.ErrTooLarge:
				return nil, documentOutput{}, fmt.Errorf("content exceeds the %d byte document limit", docs.MaxTextBytes)
			case docs.ErrTrashed:
				return nil, documentOutput{}, fmt.Errorf("document is in the trash — restore it first")
			default:
				return nil, documentOutput{}, fmt.Errorf("failed to update document")
			}
		}
		return nil, documentOutput{
			FileID:    fileID.String(),
			LibraryID: libraryID.String(),
			Name:      file.Name,
			Markdown:  in.Content,
			Size:      int64(len(in.Content)),
			Live:      false,
			UpdatedAt: rfc3339(file.UpdatedAt),
		}, nil
	})
}

// resolveDocument parses ids, enforces access (viewer for reads, admin for
// writes), and confirms the file is a markdown document in the library.
func (d Deps) resolveDocument(ctx context.Context, rawLibraryID, rawFileID string, write bool) (uuid.UUID, uuid.UUID, *models.File, error) {
	libraryID, err := parseUUIDArg("libraryId", rawLibraryID)
	if err != nil {
		return uuid.Nil, uuid.Nil, nil, err
	}
	fileID, err := parseUUIDArg("fileId", rawFileID)
	if err != nil {
		return uuid.Nil, uuid.Nil, nil, err
	}
	if write {
		_, _, err = d.requireLibraryAdmin(ctx, libraryID)
	} else {
		_, _, err = d.requireLibraryAccess(ctx, libraryID)
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, nil, err
	}

	var file models.File
	if err := d.DB.Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
		return uuid.Nil, uuid.Nil, nil, fmt.Errorf("file %s not found in this library", fileID)
	}
	if file.MimeType != "text/markdown" {
		lower := strings.ToLower(file.Name)
		if !strings.HasSuffix(lower, ".md") && !strings.HasSuffix(lower, ".markdown") {
			return uuid.Nil, uuid.Nil, nil, fmt.Errorf("file %s is not a markdown document", fileID)
		}
	}
	return libraryID, fileID, &file, nil
}
