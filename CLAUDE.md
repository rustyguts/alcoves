# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Summary

Alcoves is a self-hosted collaborative file library with a Vue 3 + Vite frontend and a Go backend.
It has:

- **Frontend** (`frontend/`): Vue 3 + Vite SPA with Nuxt UI v4 (standalone mode)
- **Backend** (`backend/`): Go API server with Echo framework, GORM, and PostgreSQL
- Session auth with AES-GCM encrypted cookies
- Local or S3-backed file/avatar/cache storage

## Core Commands

### Frontend (use Bun in `frontend/` directory)

- `bun install`
- `bun run dev` - Start Vite dev server (proxies `/api/*` to Go backend)
- `bun run build` - Build production SPA
- `bun run preview` - Preview production build
- `bun run typecheck` - TypeScript type checking
- `bun run lint` - Run OXlint
- `bun run lint:fix` - Fix linting issues
- `bun run fmt` - Format code with OXfmt
- `bun run fmt:check` - Check formatting
- `bun run test` - Run all tests
- `bun run test:unit` - Run unit tests
- `bun run test:unit:coverage` - Run unit tests with coverage
- `bun run test:e2e` - Run end-to-end tests
- `bun run coverage:summary` - Display coverage summary

### Backend (use Go in `backend/` directory)

- `go run cmd/api/main.go` - Start Go API server
- `go test ./...` - Run tests
- `go build -o bin/alcoves cmd/api/main.go` - Build binary

## Architecture Notes

### Frontend (`frontend/`)

- **Not using Nuxt SSR** - Pure Vue 3 + Vite SPA
- Uses Nuxt UI v4 in standalone mode via `@nuxt/ui/vite` plugin
- `app/pages/` defines routes (vue-router)
- `app/router/auth-guard.ts` enforces auth redirects
- `app/layouts/dashboard.vue` is the primary authenticated shell
- `app/composables/` contains shared composables
- `app/utils/api-fetch.ts` - Custom fetch wrapper for API calls
- `shared/` contains shared types and constants
- Vite dev server proxies `/api/*` to Go backend (default: `http://localhost:3001`)

### Backend (`backend/`)

- Go API server using Echo framework
- GORM for database ORM with PostgreSQL
- Session management with AES-GCM encrypted cookies
- `backend/internal/` contains application code
- `backend/cmd/api/main.go` is the entry point
- Frontend SPA is embedded into Go binary via `//go:embed`

## Environment

Frontend env vars (Vite):

- `ALCOVES_API_URL` - Go backend URL for proxy (default: `http://localhost:3001`)
- `VITE_GOOGLE_AUTH_ENABLED` - Enable Google auth button

Backend env vars (Go):

- `ALCOVES_DATABASE_URL` - PostgreSQL connection string
- `ALCOVES_SESSION_SECRET` - AES-GCM key for session encryption
- `ALCOVES_STORAGE_DRIVER` (`local` or `s3`)
- `ALCOVES_STORAGE_PATH`
- `ALCOVES_AVATAR_STORAGE_PATH`
- `ALCOVES_CACHE_STORAGE_PATH`
- S3 configuration (if using S3 storage driver)

See `.env.example` for full details and defaults.

## Engineering Guardrails

- Frontend: Keep changes consistent with Vue 3 + Vite patterns
- Backend: Follow Go best practices and Echo framework conventions
- Do not switch package manager (Bun for frontend) or lint/format stack (OXlint/OXfmt)
- Prefer adding/adjusting tests when behavior changes
- Run targeted tests first, then broader suites when needed
- Avoid destructive git commands and do not revert unrelated local changes
