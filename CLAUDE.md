# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alcoves is a Go-based web application for managing and viewing media files (images). It uses:
- **Echo** web framework for HTTP routing
- **GORM** for database ORM (PostgreSQL in production, SQLite in tests)
- **Templ** for type-safe HTML templating (UI structure only)
- **Datastar** for hypermedia-driven reactivity and data fetching (SSE-based)
- **libvips** (via govips) for high-performance image processing and on-demand resizing
- **DaisyUI v5** + **TailwindCSS** for styling

## Build and Development Commands

### Running the Application
```bash
# Set required environment variable
export ALCOVES_DATABASE_URL="postgres://user:pass@localhost/dbname"
# or for SQLite
export ALCOVES_DATABASE_URL="sqlite:alcoves.db"

# Build and run
go run main.go
```

The server starts on port 8080. Access at http://localhost:8080

### Testing
```bash
# Run all tests
go test ./...

# Run tests for a specific package
go test ./internal/auth/...

# Run a specific test
go test ./internal/auth/... -v -run TestPostRegister_Success

# Run tests with coverage
go test ./... -cover
```

### Code Generation

The project uses code generation for templates and CSS:

```bash
# Generate templ templates (required after modifying .templ files)
go generate ./...
# Or directly:
templ generate -path internal/components

# Generate Tailwind CSS (required after modifying styles)
tailwindcss -i static/css/input.css -o static/css/main.css
```

**Important**: After modifying any `.templ` file, you must run `go generate ./...` or `templ generate` to regenerate the corresponding `_templ.go` files. Never manually edit `_templ.go` files.

## Architecture

### Directory Structure

```
internal/
├── auth/           # Authentication, sessions, users, password hashing, and auth routes
├── components/     # Templ templates (.templ files and generated _templ.go)
├── config/         # Configuration and environment setup
├── db/             # Database initialization and migrations
├── files/          # File handlers (upload, retrieval, image processing) and page views
├── libraries/      # Library retrieval/on-demand creation (GetUserLibrary) and routes
├── models/         # GORM database models and domain logic
└── testing/        # Test utilities and mock database setup
```

### Key Models

The database schema centers around these core models:

- **User**: Email/password authentication, theme preference
- **Session**: Cookie-based session management (24-hour expiry with auto-refresh)
- **Library**: File collections with ownership. Each user has a personal library (`is_personal=true`) created automatically on registration. Users can also create/join shared libraries.
- **File**: Uploaded media files with metadata (dimensions, hash, EXIF timestamps, etc.)

Relationships:
- User → Sessions (1:many)
- User → Files (1:many) 
- User → Libraries (1:many via ownership)
- Library → Files (1:many)

### Database Migrations

GORM AutoMigrate runs on startup in `internal/db/db.go`. The migration order is critical:
1. User
2. Library
3. File
4. Session

When adding models, update both `internal/db/db.go` and `internal/testing/db.go`.

### File Storage and Image Processing

Files are stored in `./data/assets/` with UUID-based filenames. The `/files` package handles:

1. **Upload**: Files are hashed (SHA-256), EXIF data extracted, and metadata stored in DB
2. **On-demand resizing**: Images are resized via libvips when requested with `?width=X` parameter
3. **Caching**: Resized images cached in `./data/cache/` with deterministic UUIDs based on original ID + query params
4. **Soft deletion**: Files are soft-deleted (GORM `deleted_at`), viewable in trash for 30 days

### Authentication Flow

1. User registers via `/register` → `auth.PostRegister`
   - Password hashed with bcrypt (cost 14)
   - Personal library created automatically via `models.CreatePersonalLibrary`
   - Session created and cookie set

2. Session middleware (`auth.SessionAuthMiddleware`) validates session cookie on protected routes
   - Sessions auto-refresh when <2 hours until expiry
   - User ID stored in Echo context as `c.Get("user")`

3. Logout invalidates session in DB and clears cookie

### Template System (Templ)

Templ provides type-safe Go templates compiled to Go code. Key patterns:

- **Source files**: `*.templ` (human-written)
- **Generated files**: `*_templ.go` (never edit directly)
- **Data structs**: Defined in `.templ` files (e.g., `MediaViewData`, `LayoutData`)
- **Component calls**: `@ComponentName(data)` syntax
- **Helper functions**: Can be defined alongside templates for URL building, etc.

Example component usage in handlers:
```go
data := components.MediaViewData{
    Title: "Media",
    Theme: user.Theme,
    Asset: file,
}
component := components.Media(data)
return component.Render(c.Request().Context(), c.Response().Writer)
```

### Frontend Architecture

The frontend follows a strict separation of concerns:

- **Templ** is used **only** for building HTML structure (layout, components, static markup). Do not add inline `<script>` blocks for UI interactions that Datastar can handle.
- **Datastar** is the **only** library used for reactivity and data fetching. Do not use htmx, Alpine.js, or other JS frameworks. All dynamic behavior (show/hide, form submission, data fetching, DOM updates) must use Datastar data attributes.

### Datastar Integration

Alcoves uses [Datastar](https://data-star.dev/) as its hypermedia framework for reactive UI updates via Server-Sent Events (SSE).

**CDN**: Loaded in `root.templ` via:
```html
<script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/[email protected]/bundles/datastar.js"></script>
```

**Go SDK**: `github.com/starfederation/datastar/sdk/go` (package name `datastar`)

**Key Patterns**:

1. **Signals**: Declare reactive state with `data-signals-*` attributes on a parent element:
   ```html
   <div data-signals-showForm="false" data-signals-inputValue="">
   ```

2. **Two-way binding**: Bind inputs with `data-bind-*`:
   ```html
   <input data-bind-inputValue />
   ```

3. **Visibility**: Toggle elements with `data-show`:
   ```html
   <div data-show="$showForm">...</div>
   ```

4. **Actions**: Trigger backend SSE requests with `data-on-click` using the Go SDK helpers:
   ```go
   // In .templ files, use the Go SDK helper functions:
   data-on-click={ datastar.PostSSE("/endpoint") }
   data-on-click={ datastar.DeleteSSE("/items/%s", item.PublicID) }
   ```

5. **Backend SSE responses**: Handlers use the Datastar Go SDK to send SSE events:
   ```go
   sse := datastar.NewSSE(c.Response().Writer, c.Request())

   // Send updated HTML fragment (morphs element by ID)
   sse.MergeFragmentTempl(component, datastar.WithSelectorID("target-id"))

   // Update client signals
   sse.MarshalAndMergeSignals(map[string]any{"signal": "value"})
   ```

6. **Reading signals**: Datastar sends all signals as JSON in the request body. Read them with:
   ```go
   var signals struct {
       FieldName string `json:"fieldName"`
   }
   datastar.ReadSignals(c.Request(), &signals)
   ```
   **Important**: Call `ReadSignals` *before* creating the SSE generator with `NewSSE`.

7. **Fragment pattern**: Mutating handlers (POST/PUT/DELETE) should return the updated HTML fragment via `MergeFragmentTempl` so the UI updates in-place without a full page reload. Each fragment must have a stable `id` attribute that the server targets with `WithSelectorID`.

### Router Organization

Each domain package registers its own routes via `RegisterRoutes(e)` called from `main.go`:

- `auth.RegisterRoutes()`: Login, register, logout, theme updates
- `files.RegisterRoutes()`: File operations (`/assets/*`) AND page views (`/`, `/media/:id`, `/trash`, `/health`)
- `libraries.RegisterRoutes()`: Library CRUD via Datastar SSE (`/libraries/*`)

Note: The `files` package handles both API routes (`/assets/*`) and page rendering routes. The `/assets/*` URL path is preserved for backward compatibility even though the internal package is named `files`.

## Environment Variables

Required:
- `ALCOVES_DATABASE_URL`: Database connection string (PostgreSQL or SQLite)

Optional:
- `GOOGLE_OAUTH_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_OAUTH_CLIENT_SECRET`: Google OAuth client secret
- `OTEL_SERVICE_NAME`: OpenTelemetry service name (default: "alcoves")
- `ENVIRONMENT`: Environment name (default: "development")

## Common Gotchas

1. **libvips dependency**: The `govips` package requires libvips C library. Build failures with "Package 'vips' not found" indicate missing system dependency (not a Go issue).

2. **Generated files**: Never manually edit `*_templ.go` files. Always modify `.templ` source and regenerate.

3. **Test database**: Tests use in-memory SQLite. The test setup in `internal/testing/db.go` must mirror production migrations.

4. **Session cookies**: Domain is set to `c.Request().Host`. In tests, cookies may not persist across requests without proper setup.

5. **Model naming**: The model is `File` but URLs use `/assets/*` for historical reasons. Don't confuse the two.

6. **Personal libraries**: Every user gets a personal library (`IsPersonal=true`) created automatically on registration. Don't create duplicates.

7. **Route registration**: Each package registers its own routes. Don't create a separate `routers` package - add `routes.go` to the domain package instead.

8. **User operations**: User-related functions (`FindUserByEmail`, `FindUserByID`, `UpdateUserTheme`) are in the `auth` package, not a separate `user` package.

9. **Datastar signal naming**: Signal names in `data-signals-*`, `data-bind-*` attributes and Go struct JSON tags must match exactly (camelCase). Signals prefixed with `_` are not sent to the server.

10. **Datastar SSE handlers**: Must use `datastar.NewSSE(c.Response().Writer, c.Request())` rather than returning Echo JSON/HTML responses. The Content-Type is set automatically to `text/event-stream`.

11. **No htmx**: htmx has been replaced by Datastar. Do not add htmx attributes or load the htmx script. Use Datastar for all reactive behavior.
