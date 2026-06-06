package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

type downloadFileInput struct {
	LibraryID string `json:"libraryId" jsonschema:"library UUID containing the file"`
	FileID    string `json:"fileId" jsonschema:"file UUID to download"`
	DestPath  string `json:"destPath,omitempty" jsonschema:"absolute path on the server host to write the file to (local/stdio). Omit to receive a signed download URL for an out-of-band curl download."`
	Overwrite bool   `json:"overwrite,omitempty" jsonschema:"overwrite destPath if it already exists"`
}

type downloadFileOutput struct {
	Mode string `json:"mode"` // "saved" (written to destPath) or "url" (signed GET URL)

	// mode == "saved"
	Path string `json:"path,omitempty"`
	Size int64  `json:"size,omitempty"`

	// mode == "url"
	URL         string `json:"url,omitempty"`
	CurlCommand string `json:"curlCommand,omitempty"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
}

func registerDownloadTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "download_file",
		Description: "Download a file from a library. With `destPath` (local/stdio) the server writes the file to that host path. Without `destPath`, returns a signed, range-resumable download URL plus a ready-to-run curl command.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in downloadFileInput) (*mcp.CallToolResult, downloadFileOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, downloadFileOutput{}, err
		}
		fileID, err := parseUUIDArg("fileId", in.FileID)
		if err != nil {
			return nil, downloadFileOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, downloadFileOutput{}, err
		}

		var file models.File
		if err := d.DB.Select("id, name, mime_type, size").
			Where("id = ? AND library_id = ?", fileID, libraryID).First(&file).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, downloadFileOutput{}, fmt.Errorf("file %s not found in library", fileID)
			}
			return nil, downloadFileOutput{}, fmt.Errorf("failed to load file")
		}

		// Local-path branch: stream storage → host disk (constant memory).
		if in.DestPath != "" {
			dest, err := validateHostPath(in.DestPath)
			if err != nil {
				return nil, downloadFileOutput{}, err
			}
			if !in.Overwrite {
				if _, statErr := os.Stat(dest); statErr == nil {
					return nil, downloadFileOutput{}, fmt.Errorf("destPath already exists: %s (set overwrite to replace)", dest)
				}
			}
			reader, err := d.Storage.OpenFileReadStream(libraryID.String(), fileID.String(), nil)
			if err != nil {
				return nil, downloadFileOutput{}, fmt.Errorf("file not found on storage")
			}
			defer reader.Close()

			out, err := os.Create(dest)
			if err != nil {
				return nil, downloadFileOutput{}, fmt.Errorf("cannot create %q: %w", dest, err)
			}
			written, copyErr := copyCtx(ctx, out, reader)
			closeErr := out.Close()
			if copyErr != nil {
				_ = os.Remove(dest)
				return nil, downloadFileOutput{}, fmt.Errorf("download failed: %w", copyErr)
			}
			if closeErr != nil {
				return nil, downloadFileOutput{}, fmt.Errorf("download failed: %w", closeErr)
			}
			return nil, downloadFileOutput{Mode: "saved", Path: dest, Size: written}, nil
		}

		// Remote branch: mint a signed, range-resumable GET URL + curl command.
		expires := time.Now().Add(d.signedTTL())
		token := d.Signer.SignDownload(libraryID, fileID, expires)
		url := fmt.Sprintf("%s/api/files/signed?token=%s", d.BaseURL, token)
		return nil, downloadFileOutput{
			Mode:        "url",
			URL:         url,
			CurlCommand: fmt.Sprintf("curl -C - -o %s '%s'", shellSingleQuote(file.Name), url),
			ExpiresAt:   expires.UTC().Format(time.RFC3339),
		}, nil
	})
}
