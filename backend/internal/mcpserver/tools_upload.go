package mcpserver

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/signing"
)

type uploadFileInput struct {
	LibraryID string `json:"libraryId" jsonschema:"destination library UUID"`
	Filename  string `json:"filename" jsonschema:"name to store the file as"`
	Path      string `json:"path,omitempty" jsonschema:"absolute path on the server host to read and upload directly (local/stdio). Omit to receive a signed upload URL for an out-of-band curl upload."`
	FolderID  string `json:"folderId,omitempty" jsonschema:"optional destination folder UUID"`
	MimeType  string `json:"mimeType,omitempty" jsonschema:"MIME type; defaults to detection from the filename"`
	Size      int64  `json:"size,omitempty" jsonschema:"file size in bytes; used to bound the signed upload URL"`
}

// resumableUpload is the advanced, resumable tus alternative returned alongside
// the simple signed PUT URL for very large or flaky uploads.
type resumableUpload struct {
	TusUploadURL   string `json:"tusUploadUrl"`
	UploadMetadata string `json:"uploadMetadata"`
	AuthScheme     string `json:"authScheme"`
	Note           string `json:"note"`
}

type uploadFileOutput struct {
	Mode string `json:"mode"` // "completed" (local path streamed in) or "url" (signed PUT URL)

	// mode == "completed"
	FileID         string `json:"fileId,omitempty"`
	Name           string `json:"name,omitempty"`
	Size           int64  `json:"size,omitempty"`
	Hash           string `json:"hash,omitempty"`
	DuplicateCount int    `json:"duplicateCount,omitempty"`

	// mode == "url"
	UploadURL   string           `json:"uploadUrl,omitempty"`
	CurlCommand string           `json:"curlCommand,omitempty"`
	ExpiresAt   string           `json:"expiresAt,omitempty"`
	Resumable   *resumableUpload `json:"resumable,omitempty"`
}

func registerUploadTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "upload_file",
		Description: "Upload a file into a library. With `path` (local/stdio) the server streams the file in directly and returns the created file. Without `path`, returns a signed PUT URL plus a ready-to-run curl command (and a resumable tus fallback) for an out-of-band upload.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in uploadFileInput) (*mcp.CallToolResult, uploadFileOutput, error) {
		libraryID, err := uuid.Parse(in.LibraryID)
		if err != nil {
			return nil, uploadFileOutput{}, fmt.Errorf("invalid libraryId: %q", in.LibraryID)
		}
		if in.Filename == "" {
			return nil, uploadFileOutput{}, fmt.Errorf("filename is required")
		}

		id, acc, err := d.requireLibraryAccess(ctx, libraryID)
		if err != nil {
			return nil, uploadFileOutput{}, err
		}
		if !acc.IsAdmin {
			return nil, uploadFileOutput{}, fmt.Errorf("admin access required to upload to this library")
		}

		var folderID *uuid.UUID
		if in.FolderID != "" {
			fid, err := uuid.Parse(in.FolderID)
			if err != nil {
				return nil, uploadFileOutput{}, fmt.Errorf("invalid folderId: %q", in.FolderID)
			}
			var count int64
			d.DB.Model(&models.Folder{}).Where("id = ? AND library_id = ?", fid, libraryID).Count(&count)
			if count == 0 {
				return nil, uploadFileOutput{}, fmt.Errorf("folder %s not found in library", fid)
			}
			folderID = &fid
		}

		mimeType := detectMimeType(in.MimeType, in.Filename)

		// Local-path branch: the co-located process streams the file straight
		// into storage via the shared ingest pipeline (constant memory).
		if in.Path != "" {
			path, err := validateHostPath(in.Path)
			if err != nil {
				return nil, uploadFileOutput{}, err
			}
			f, err := os.Open(path)
			if err != nil {
				return nil, uploadFileOutput{}, fmt.Errorf("cannot open %q: %w", path, err)
			}
			defer f.Close()

			res, err := d.Files.IngestStream(ctx, files.IngestParams{
				LibraryID: libraryID,
				OwnerID:   id.UserID(),
				FolderID:  folderID,
				Name:      in.Filename,
				MimeType:  mimeType,
			}, f)
			if err != nil {
				return nil, uploadFileOutput{}, fmt.Errorf("upload failed: %w", err)
			}
			out := uploadFileOutput{
				Mode:           "completed",
				FileID:         res.File.ID.String(),
				Name:           res.File.Name,
				Size:           res.File.Size,
				DuplicateCount: res.DuplicateCount,
			}
			if res.File.Hash != nil {
				out.Hash = *res.File.Hash
			}
			return nil, out, nil
		}

		// Remote branch: hand back a signed PUT URL + curl command, with a tus
		// ticket as the resumable fallback.
		expires := time.Now().Add(d.signedTTL())
		token := d.Signer.SignUpload(signing.UploadClaims{
			LibraryID: libraryID,
			OwnerID:   id.UserID(),
			FolderID:  folderID,
			Name:      in.Filename,
			MimeType:  mimeType,
			MaxSize:   in.Size,
		}, expires)

		uploadURL := fmt.Sprintf("%s/api/files/upload-signed?token=%s", d.BaseURL, token)
		out := uploadFileOutput{
			Mode:        "url",
			UploadURL:   uploadURL,
			CurlCommand: fmt.Sprintf("curl -T '<local-file>' '%s'", uploadURL),
			ExpiresAt:   expires.UTC().Format(time.RFC3339),
			Resumable: &resumableUpload{
				TusUploadURL:   fmt.Sprintf("%s/api/tus", d.BaseURL),
				UploadMetadata: tusUploadMetadata(in.LibraryID, in.Filename, mimeType, in.FolderID),
				AuthScheme:     "Bearer <personal-access-token>",
				Note:           "Resumable alternative: drive a tus 1.0.0 upload against tusUploadUrl using the listed Upload-Metadata and a Bearer PAT. Use this for very large or unreliable uploads.",
			},
		}
		return nil, out, nil
	})
}
