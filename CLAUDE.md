# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alcoves is a media server application built with Go and Echo framework, designed for asset management and image processing. It provides user authentication, file upload/storage, and on-demand image resizing with caching.

## Key Architecture Components

### Backend (Go)
- **Echo Framework**: Main web framework with middleware for sessions, logging, and recovery
- **GORM**: ORM for PostgreSQL database operations with auto-migration
- **libvips**: High-performance image processing library for thumbnails and transformations
- **Feature-based structure**: Organized into `/internal/features/` with separate modules for `auth`, `assets`, and `root`

### Frontend (Web)
- **Server-side templates**: HTML templates in `/web/layouts/` and `/web/partials/`
- **Tailwind CSS + DaisyUI**: Styling with build process managed via Bun
- **HTMX**: For dynamic frontend interactions (referenced in static files)

### Database Models
- **Users**: Authentication with bcrypt password hashing
- **Assets**: File metadata with EXIF parsing, SHA256 hashing, and deterministic UUID generation

### Asset Processing Pipeline
- Original files stored in `data/assets/` with UUID-based naming
- Cached proxies in `data/cache/` with deterministic UUIDs based on URL parameters
- On-demand image resizing with JPEG optimization and auto-rotation
- EXIF timestamp extraction with timezone handling for proper `c_time` values

## Development Commands

### Build and Run
```bash
# Development with hot reload (via Air)
air

# Manual build
go build -o ./tmp/main ./cmd/server

# Build CSS assets
cd web && bun run build
```

### Testing
```bash
# Run all tests
go test ./...

# Run specific test
go test ./internal/features/root
```

### Docker Development
```bash
# Start development environment
docker-compose up

# Development container includes Air, Bun, and libvips dependencies
```

## Environment Variables

- `ALCOVES_DATABASE_URL`: PostgreSQL connection string (required)

## Configuration

- Session secret key is hardcoded as "secret-key-change-in-production" in main.go
- Server runs on port 8080
- Asset directories are auto-created via `config.EnsureDirectories()`

## Template System

Templates use a nested structure with base layouts and specific page templates. The system loads template sets for different pages (home, login, register) with optional partials.