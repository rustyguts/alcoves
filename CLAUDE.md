# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alcoves is a media server application built with Go and HTML templates. It allows users to upload, store, and manage media assets (images) with user authentication and session management.

## Development Commands

### Go Development
- `go run ./cmd/server` - Run the development server
- `go test ./...` - Run all tests
- `go mod download` - Download dependencies
- `go build -o main ./cmd/server` - Build production binary

### Frontend Development
- `cd web && bun install` - Install frontend dependencies
- `cd web && bun run build` - Build CSS with TailwindCSS
- `bunx @tailwindcss/cli -i ./css/input.css -o ./public/static/main.css` - Build CSS manually

### Docker Development
- `docker-compose up` - Start development environment with PostgreSQL
- `docker build --target development .` - Build development image
- `docker build --target dist .` - Build production image

### Database
The application uses GORM with PostgreSQL (production) or SQLite (development). Database is automatically migrated on startup.

## Architecture

### Core Structure
- `cmd/server/main.go` - Application entry point with Echo server setup
- `internal/` - Core application logic organized by domain
- `web/` - Frontend templates, CSS, and static assets
- `data/assets/` - Uploaded media files storage

### Key Components

**Models** (`internal/models/`)
- `User` - User accounts with email/password authentication
- `Asset` - Media files with metadata (dimensions, file info, user association)
- `Session` - User session management

**Handlers** (`internal/*/handler.go`)
- `auth` - User registration, login, logout, session middleware
- `assets` - Media upload, retrieval, and management
- `root` - Homepage and main navigation

**Database** (`internal/db/`)
- Uses GORM ORM with automatic migrations
- Supports PostgreSQL (production) and SQLite (development)
- Configuration via `ALCOVES_DATABASE_URL` environment variable

**Configuration** (`internal/config/`)
- Environment-based configuration system
- Database URL, server settings, file paths

### Frontend Architecture
- Server-side rendered HTML templates using Go's html/template
- TailwindCSS with DaisyUI for styling
- HTMX for dynamic interactions
- Template structure: `layouts/base.html` + page-specific templates + partials

### Media Processing
- Uses libvips (via govips) for image processing and optimization
- Automatic thumbnail generation and format conversion
- Metadata extraction (dimensions, file size, type)
- UUID-based public IDs for assets

## Testing

Run tests with `go test ./...`. Tests use mocks for database and Echo context.

## Deployment

The application can be deployed using:
1. Docker with the provided Dockerfile (multi-stage build)
2. Binary compilation with `go build`
3. Docker Compose for development with PostgreSQL

Static files are served from `web/public/` and uploaded assets from `data/assets/`.