package mcpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/signing"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/version"
)

// Deps are the services the tool set needs. Files must be ingest-configured
// (NewServiceWithIngest) for the local-path upload branch to work.
type Deps struct {
	DB      *gorm.DB
	Access  *access.Service
	Files   *files.Service
	Storage *storage.Service
	Signer  *signing.Signer
	BaseURL string

	// SignedTTL bounds the lifetime of minted signed upload/download URLs.
	// Zero uses defaultSignedTTL.
	SignedTTL time.Duration

	// DefaultIdentity is used when the request context carries no identity —
	// i.e. the single-user stdio transport. Leave nil for the multi-user HTTP
	// transport, where identity is resolved per request from the bearer token.
	DefaultIdentity Identity
}

const defaultSignedTTL = time.Hour

func (d Deps) signedTTL() time.Duration {
	if d.SignedTTL > 0 {
		return d.SignedTTL
	}
	return defaultSignedTTL
}

// NewServer builds the Alcoves MCP server with the initial tool set registered.
// The same *mcp.Server is served over stdio (cmd/mcp) or mounted on the Echo
// app via the streamable HTTP handler (cmd/server).
func NewServer(d Deps) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "alcoves",
		Title:   "Alcoves",
		Version: version.App(),
	}, nil)

	registerLibraryTools(srv, d)
	registerFileTools(srv, d)
	registerUploadTool(srv, d)
	registerDownloadTool(srv, d)

	return srv
}

// identity returns the acting user for a call: the context identity if present
// (HTTP), otherwise the configured default (stdio). It returns an error (which
// the SDK surfaces to the model as an IsError tool result) when neither exists.
func (d Deps) identity(ctx context.Context) (Identity, error) {
	if id, ok := IdentityFrom(ctx); ok {
		return id, nil
	}
	if d.DefaultIdentity != nil {
		return d.DefaultIdentity, nil
	}
	return nil, fmt.Errorf("unauthenticated: no identity for this request")
}

// requireLibraryAccess resolves the caller and confirms it can access the
// library. Returns an error result for an unknown library or no access.
func (d Deps) requireLibraryAccess(ctx context.Context, libraryID uuid.UUID) (Identity, *access.LibraryAccess, error) {
	id, err := d.identity(ctx)
	if err != nil {
		return nil, nil, err
	}
	acc, err := d.Access.GetLibraryAccess(id.UserID(), libraryID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to check library access")
	}
	if acc == nil {
		return nil, nil, fmt.Errorf("library %s not found or access denied", libraryID)
	}
	return id, acc, nil
}
