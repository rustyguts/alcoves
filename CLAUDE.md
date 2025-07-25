# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alcoves is a Go-based media server application for managing and serving image/asset files. It features user authentication, asset management with upload/download capabilities, and a web interface built with Templ components and TailwindCSS.

## Common Development Commands

### Starting the Development Server
```bash
# Using Air for hot reloading (recommended for development)
air

# Or build and run manually
go build -buildvcs=false -o ./tmp/main ./cmd/server
./tmp/main
```

### Building Frontend Assets
```bash
# Install dependencies and build CSS
bun install
bun run build

# Or manually
bunx @tailwindcss/cli -i static/input.css -o static/main.css
```

### Code Generation
```bash
# Generate Templ templates (required after modifying .templ files)
templ generate

# Or use the go generate directive
go generate ./cmd/server/main.go
```

### Running Tests
```bash
# Run all tests
go test ./...

# Run tests with verbose output
go test -v ./...

# Run specific package tests
go test ./internal/auth
```

### Database Operations
```bash
# Database migrations are handled automatically on startup
# Set ALCOVES_DATABASE_URL environment variable to your PostgreSQL connection string
export ALCOVES_DATABASE_URL="postgres://user:password@localhost/dbname?sslmode=disable"
```

## Architecture Overview

### Core Structure
- **cmd/server/main.go**: Application entry point, sets up Echo server, middleware, and routes
- **internal/**: Core application logic organized by domain
- **static/**: Static web assets (CSS, JS, images)
- **data/**: Runtime data storage (images, cache)

### Key Components

#### Database Layer (`internal/db/`)
- Uses GORM with PostgreSQL driver
- Auto-migration on startup for User, Asset, and Session models
- Connection singleton pattern with global `Connection` variable

#### Authentication (`internal/auth/`)
- Session-based authentication with middleware
- User registration/login handlers
- Session management with configurable expiration

#### Asset Management (`internal/assets/`)
- File upload/download with VIPS image processing
- Asset storage in configurable data directory
- Support for multiple image formats with metadata extraction

#### Web Components (`internal/components/`)
- Templ-based HTML components
- Layout, login, media gallery, and modal templates
- Auto-generated `*_templ.go` files (don't edit these directly)

#### Routing (`internal/routers/`)
- Modular route organization: root, auth, assets
- Protected routes use `auth.SessionAuthMiddleware()`

### Environment Configuration
Set these environment variables:
- `ALCOVES_DATABASE_URL`: PostgreSQL connection string (required)
- `GOOGLE_OAUTH_CLIENT_ID`: For Google OAuth (optional)
- `GOOGLE_OAUTH_CLIENT_SECRET`: For Google OAuth (optional)
- `OTEL_*`: OpenTelemetry configuration (optional)

### File Organization
- Templates: `internal/components/*.templ` -> auto-generates `*_templ.go`
- Handlers: `internal/{domain}/handler.go`
- Models: `internal/models/{entity}.go`
- Tests: `*_test.go` files alongside source

### Docker Development
```bash
# Development with hot reload
docker compose up --build

# Production build
docker build --target dist -t alcoves .
```

### Important Notes
- Templ templates must be regenerated after modifications: `templ generate`
- CSS changes require rebuilding with `bun run build`
- Database URL environment variable is required for startup
- Image processing uses libvips - ensure it's installed in development environment
- Air configuration in `.air.toml` excludes `*_templ.go` files from watching