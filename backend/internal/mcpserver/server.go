package mcpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/docs"
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

	// Docs powers the live-document tools (update_document's CRDT-safe
	// replacement). Optional: nil disables update_document with a clear error
	// while create/read (blob-level) keep working.
	Docs *docs.Service

	// Activity emits library activity / notifications for the write tools
	// (folder + tag creation, file trashing). Optional: a nil service makes
	// those emits no-ops — matching the HTTP handlers' nil-guard behavior in
	// worker-only mode and on a stdio process with no realtime bus. The write
	// itself always succeeds; only the activity row is skipped.
	Activity *activity.Service

	// SyncActivity makes emitActivity write the activity row synchronously
	// instead of via a detached goroutine. Set it for the short-lived stdio
	// transport, where the process can exit (and close the DB pool) immediately
	// after a tool returns — a fire-and-forget EmitAsync could otherwise lose
	// the row. The long-lived HTTP transport leaves this false (async, like the
	// web handlers).
	SyncActivity bool

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

// NewServer builds the Alcoves MCP server with the full v1 tool set registered.
// The same *mcp.Server is served over stdio (cmd/mcp) or mounted on the Echo
// app via the streamable HTTP handler (cmd/server). Every tool enforces the
// same role-based access control as the web app, per acting identity.
func NewServer(d Deps) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "alcoves",
		Title:   "Alcoves",
		Version: version.App(),
	}, nil)

	// Libraries, members, search.
	registerLibraryTools(srv, d) // list_libraries, get_library, list_members
	registerSearchTool(srv, d)   // search

	// Files & folders.
	registerFileTools(srv, d)         // list_files
	registerFileDetailTool(srv, d)    // get_file
	registerTimelineTools(srv, d)     // get_timeline, list_map_points
	registerUploadTool(srv, d)        // upload_file
	registerDownloadTool(srv, d)      // download_file
	registerFolderTools(srv, d)       // create_folder
	registerFileMutationTools(srv, d) // update_file, trash_file, restore_file

	// Tags.
	registerTagTools(srv, d) // list_tags, create_tag, set_file_tags

	// AI insights (read-only).
	registerInsightTools(srv, d) // get_transcript, list_audio_events, list_people, list_objects

	// Moments.
	registerMomentTools(srv, d) // list_moments

	// Live documents (markdown in/out, Notion-MCP-shaped).
	registerDocumentTools(srv, d) // create_document, read_document, update_document

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
// library (viewer or above). Returns an error result for an unknown library or
// no access — deliberately the same message either way so a tool caller cannot
// probe library existence it has no rights to.
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

// requireLibraryAdmin is requireLibraryAccess plus an admin/owner gate. Use it
// for every write tool — it mirrors LibraryAccessMiddleware's write rule
// (admin+ on /api/libraries/:id/*).
func (d Deps) requireLibraryAdmin(ctx context.Context, libraryID uuid.UUID) (Identity, *access.LibraryAccess, error) {
	id, acc, err := d.requireLibraryAccess(ctx, libraryID)
	if err != nil {
		return nil, nil, err
	}
	if !acc.IsAdmin {
		return nil, nil, fmt.Errorf("admin access required for this action on library %s", libraryID)
	}
	return id, acc, nil
}

// emitActivity records a library activity event when the service is configured.
// A nil service is a no-op (mirrors handlers.emitActivity). With SyncActivity it
// writes synchronously (stdio); otherwise it fans out via a detached goroutine
// (HTTP, like the web handlers). Emission is best-effort either way — a failed
// activity write never fails the already-committed user action.
func (d Deps) emitActivity(p activity.EmitParams) {
	if d.Activity == nil {
		return
	}
	if d.SyncActivity {
		_, _ = d.Activity.Emit(context.Background(), p)
		return
	}
	d.Activity.EmitAsync(p)
}
