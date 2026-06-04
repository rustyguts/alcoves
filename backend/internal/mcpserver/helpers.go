package mcpserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"strings"
)

// deref returns the string value of a *string, or "" for nil.
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// validateHostPath ensures p is an absolute, cleaned filesystem path. Local
// path I/O runs with the MCP process's privileges; an allowlist
// (ALCOVES_MCP_ALLOWED_PATHS) is deferred to future work.
func validateHostPath(p string) (string, error) {
	if strings.TrimSpace(p) == "" {
		return "", fmt.Errorf("path is required")
	}
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("path must be absolute: %q", p)
	}
	return filepath.Clean(p), nil
}

// detectMimeType resolves a MIME type from an explicit override or the filename
// extension, defaulting to application/octet-stream.
func detectMimeType(override, filename string) string {
	if override != "" {
		return override
	}
	if ext := filepath.Ext(filename); ext != "" {
		if t := mime.TypeByExtension(ext); t != "" {
			return t
		}
	}
	return "application/octet-stream"
}

// tusUploadMetadata builds the base64 Upload-Metadata header value the tus
// endpoint expects (key + space + base64(value), comma-separated).
func tusUploadMetadata(libraryID, filename, mimeType, folderID string) string {
	pairs := []string{
		"libraryId " + base64.StdEncoding.EncodeToString([]byte(libraryID)),
		"filename " + base64.StdEncoding.EncodeToString([]byte(filename)),
		"mimeType " + base64.StdEncoding.EncodeToString([]byte(mimeType)),
	}
	if folderID != "" {
		pairs = append(pairs, "folderId "+base64.StdEncoding.EncodeToString([]byte(folderID)))
	}
	return strings.Join(pairs, ",")
}

// copyCtx is a cancelable io.Copy: it aborts promptly if ctx is canceled,
// rather than blocking on a multi-GB transfer.
func copyCtx(ctx context.Context, dst io.Writer, src io.Reader) (int64, error) {
	return io.Copy(dst, &ctxReader{ctx: ctx, r: src})
}

type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (cr *ctxReader) Read(p []byte) (int, error) {
	if err := cr.ctx.Err(); err != nil {
		return 0, err
	}
	return cr.r.Read(p)
}
