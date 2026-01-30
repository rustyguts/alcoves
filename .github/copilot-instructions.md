# Copilot Instructions for Alcoves

## Project Overview
- **Alcoves** is a Go web app for managing/viewing media files (images).
- Uses Echo (web), GORM (DB), Templ (HTML), Datastar (SSE/reactivity), libvips (image processing), DaisyUI+TailwindCSS (styling).

## Key Architecture & Patterns
- **Domain-driven structure**: Each domain (auth, files, libraries) has its own package, handlers, routes, and models.
- **Templates**: `.templ` files (source) generate `*_templ.go` (never edit generated files). Regenerate with `go generate ./...` after changes.
- **Frontend**: Only Templ for HTML, only Datastar for reactivity (no htmx/Alpine/other JS frameworks).
- **Datastar**: Use `data-signals-*`, `data-bind-*`, and Go SDK helpers for all dynamic UI. SSE handlers must use `datastar.NewSSE` and return fragments/signals.
- **File storage**: Uploaded files in `data/assets/`, resized/cached in `data/cache/`. Soft deletion (trash) is default.
- **Auth**: Session cookies, bcrypt password hashing, personal library auto-created on registration.
- **Route registration**: Each package registers its own routes via `RegisterRoutes(e)` in `main.go`.

## Developer Workflows
- **Run app**: Set `ALCOVES_DATABASE_URL`, then `go run main.go` (default port 8080).
- **Test**: `go test ./...` (uses SQLite in-memory DB for tests).
- **Generate templates**: `go generate ./...` or `templ generate -path internal/components` after editing `.templ` files.
- **Build CSS**: `tailwindcss -i static/css/input.css -o static/css/main.css` after editing styles.

## Conventions & Gotchas
- Never edit `*_templ.go` files directly.
- All dynamic UI must use Datastar (no htmx/Alpine).
- Model `File` maps to `/assets/*` routes for legacy reasons.
- Test DB setup must mirror production migrations (see `internal/testing/db.go`).
- User-related logic is in `auth`, not a separate `user` package.
- Signal names in Datastar must match Go struct JSON tags (camelCase).
- No global routers package—add `routes.go` to each domain package.
- libvips must be installed on the system for image processing.

## Key Files & Directories
- `internal/auth/` – Auth/session logic, user ops, routes
- `internal/files/` – File upload, retrieval, image processing, views
- `internal/libraries/` – Library CRUD, routes
- `internal/components/` – Templ templates
- `internal/models/` – GORM models
- `internal/db/` – DB init/migrations
- `internal/testing/` – Test DB/utilities
- `static/` – CSS, JS, fonts
- `data/assets/`, `data/cache/` – File storage

See `CLAUDE.md` for full details and rationale behind patterns.