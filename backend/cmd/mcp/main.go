// Command alcoves-mcp runs the Alcoves Model Context Protocol server over the
// stdio transport, for local MCP clients (e.g. Claude Desktop). It authenticates
// as the user identified by the ALCOVES_MCP_TOKEN personal access token.
//
// A `create-token` subcommand mints a PAT for the MVP (until a token-management
// UI exists):
//
//	ALCOVES_DATABASE_URL=... ALCOVES_SESSION_SECRET=... \
//	  alcoves-mcp create-token --email you@example.com --name laptop
//
// IMPORTANT: on the stdio transport, stdout carries the JSON-RPC protocol
// stream. All diagnostics MUST go to stderr — main() sets that up first.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/database"
	"github.com/alcoves/alcoves-backend/internal/mcpserver"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	activityservice "github.com/alcoves/alcoves-backend/internal/services/activity"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/signing"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func main() {
	// Reserve stdout for the JSON-RPC stream; everything else goes to stderr.
	log.SetOutput(os.Stderr)

	if len(os.Args) > 1 && os.Args[1] == "create-token" {
		if err := runCreateToken(os.Args[2:]); err != nil {
			log.Fatalf("create-token: %v", err)
		}
		return
	}

	if err := runStdioServer(); err != nil {
		log.Fatalf("alcoves-mcp: %v", err)
	}
}

func runStdioServer() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.MCPToken == "" {
		return fmt.Errorf("ALCOVES_MCP_TOKEN is required to run the stdio MCP server")
	}

	deps, cleanup, err := buildDeps(cfg)
	if err != nil {
		return err
	}
	defer cleanup()

	user, err := deps.authSvc.ValidateMCPToken(context.Background(), cfg.MCPToken)
	if err != nil {
		return fmt.Errorf("validating ALCOVES_MCP_TOKEN: %w", err)
	}
	if user == nil {
		return fmt.Errorf("ALCOVES_MCP_TOKEN is invalid or expired")
	}

	srv := mcpserver.NewServer(mcpserver.Deps{
		DB:      deps.db,
		Access:  deps.accessSvc,
		Files:   deps.ingestSvc,
		Storage: deps.storageSvc,
		Signer:  deps.signer,
		// DB-only activity service (no realtime hub/bus on the stdio process):
		// write tools still record library-feed rows, matching the web app.
		// SyncActivity: this process can exit right after a tool call, so write
		// the row synchronously rather than risk losing it to a detached emit.
		Activity:        activityservice.NewService(deps.db, nil, nil),
		SyncActivity:    true,
		BaseURL:         cfg.BaseURL,
		DefaultIdentity: mcpserver.NewStaticIdentity(user),
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	log.Printf("alcoves MCP server (stdio) ready as %s", user.Email)
	return srv.Run(ctx, &mcp.StdioTransport{})
}

func runCreateToken(args []string) error {
	fs := flag.NewFlagSet("create-token", flag.ExitOnError)
	email := fs.String("email", "", "email of the user to mint a token for")
	name := fs.String("name", "mcp", "a human-readable label for the token")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *email == "" {
		return fmt.Errorf("--email is required")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	deps, cleanup, err := buildDeps(cfg)
	if err != nil {
		return err
	}
	defer cleanup()

	var user models.User
	if err := deps.db.Where("email = ?", *email).First(&user).Error; err != nil {
		return fmt.Errorf("user %q not found: %w", *email, err)
	}

	plaintext, _, err := deps.authSvc.CreatePersonalAccessToken(user.ID, *name, nil)
	if err != nil {
		return err
	}
	// The token is printed to stdout (this subcommand is not the stdio server).
	// Store it now — it cannot be retrieved again.
	fmt.Println(plaintext)
	return nil
}

type appDeps struct {
	db         *gorm.DB
	authSvc    *authservice.Service
	accessSvc  *access.Service
	storageSvc *storage.Service
	ingestSvc  *files.Service
	signer     *signing.Signer
}

// buildDeps connects the DB, applies migrations, and constructs the minimal
// service set the MCP tools need. The ingest service is wired with storage only
// (no async detection/proxy enqueues from the stdio process); remote uploads via
// the HTTP transport get the full pipeline.
func buildDeps(cfg *config.Config) (*appDeps, func(), error) {
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("connect database: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, nil, err
	}
	if err := database.RunMigrations(sqlDB); err != nil {
		return nil, nil, fmt.Errorf("run migrations: %w", err)
	}

	authSvc, err := authservice.NewService(db, cfg.SessionSecret)
	if err != nil {
		return nil, nil, err
	}
	accessSvc := access.NewService(db)

	storageDriver := storage.NewLocalDriver(cfg.StoragePath, cfg.AvatarStoragePath, cfg.CacheStoragePath)
	storageSvc := storage.NewService(storageDriver)
	if err := storageSvc.EnsureReady(); err != nil {
		return nil, nil, fmt.Errorf("init storage: %w", err)
	}

	ingestSvc := files.NewServiceWithIngest(db, files.IngestDeps{Storage: storageSvc})
	signer := signing.New(cfg.MCPSigningSecret)

	cleanup := func() {
		if s, e := db.DB(); e == nil {
			_ = s.Close()
		}
	}
	return &appDeps{db, authSvc, accessSvc, storageSvc, ingestSvc, signer}, cleanup, nil
}
