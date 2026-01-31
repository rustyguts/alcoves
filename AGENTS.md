# AGENTS.md - Alcoves Developer Guide

Alcoves is a Google Drive-like personal file storage and management application. Users can upload, organize, view, and manage their files through a web interface with features similar to Google Drive including:
- File upload and download
- Folder/library organization
- **Hierarchical folders** - Create, rename, move, and delete folders within libraries
- **Dual view modes** - Toggle between list view and folder view
- Multi-select with Ctrl+click and Shift+click
- Right-click context menus for file operations
- Trash/recycle bin with restore functionality
- Image viewing with navigation

## Build & Development Commands

```bash
# Run the application
export ALCOVES_DATABASE_URL="postgres://user:pass@localhost/dbname"  # or "sqlite:alcoves.db"
go run main.go

# Run all tests
go test ./...

# Run a single test
go test ./internal/auth/... -v -run TestPostRegister_Success

# Run tests for a specific package
go test ./internal/auth/... -v

# Generate templates (after editing .templ files)
go generate ./...
# Or: templ generate -path internal/components

# Build CSS (after editing styles)
tailwindcss -i static/css/input.css -o static/css/main.css

# UI/E2E Tests (Playwright)
cd e2e
npm install                          # Install test dependencies
npx playwright install              # Install browser binaries
npm test                            # Run all E2E tests (headless)
npm run test:headed                 # Run tests with visible browser
npm run test:debug                  # Run tests in debug mode
npx playwright test auth.spec.ts    # Run specific test file
npx playwright show-report          # View HTML test report
```

## Project Structure

Domain-driven organization:
```
internal/
├── auth/         # Auth, sessions, users, routes
├── files/        # File upload, retrieval, image processing, routes
├── folders/      # Folder CRUD, nested folder management
├── libraries/    # Library CRUD, routes
├── components/   # Templ templates (.templ files)
├── models/       # GORM models
├── db/           # DB initialization
├── testing/      # Test utilities
└── config/       # Configuration

e2e/              # End-to-end UI tests (Playwright)
├── tests/        # Test files (*.spec.ts)
├── fixtures.ts   # Test fixtures and page objects
└── package.json  # Node.js dependencies
```

Each domain package registers routes via `RegisterRoutes(e)` called from `main.go`.

## Code Style Guidelines

### Imports
Group imports in this order:
1. Standard library
2. Third-party packages
3. Internal project packages (github.com/rustyguts/alcoves/...)

```go
import (
    "bytes"
    "encoding/json"
    "net/http"

    "github.com/labstack/echo/v4"
    "github.com/starfederation/datastar-go/datastar"

    "github.com/rustyguts/alcoves/internal/auth"
    "github.com/rustyguts/alcoves/internal/components"
)
```

### Naming Conventions
- **Files**: `snake_case.go` (e.g., `handler.go`, `handler_test.go`)
- **Functions**: PascalCase for exported, camelCase for unexported
- **Models**: PascalCase (e.g., `User`, `Library`, `File`)
- **GORM fields**: PascalCase with json tags in snake_case
- **Constants**: PascalCase (e.g., `URLNamespace`)
- **Variables**: camelCase (e.g., `userID`, `libraryName`)

### Error Handling
Always check errors explicitly. Log with context, return HTTP errors to client:

```go
user, err := auth.FindUserByID(userID)
if err != nil {
    log.Println("Failed to find user", "error", err, "userID", userID)
    return c.String(http.StatusInternalServerError, "User not found")
}
```

Use `fmt.Errorf` with `%w` verb when wrapping errors:
```go
return fmt.Errorf("failed to create library: %w", err)
```

### Types & Models
Use GORM model embedding and appropriate tags:

```go
type User struct {
    gorm.Model
    Email    string    `gorm:"uniqueIndex;not null"`
    Password string    `gorm:"not null"`
    Theme    string    `gorm:"default:'dark'"`
    Sessions []Session `gorm:"foreignKey:UserID"`
}
```

### Handler Functions
Echo handlers follow this pattern:
```go
func HandlerName(c echo.Context) error {
    userID := auth.GetCurrentUserID(c)
    // ... logic ...
    return component.Render(c.Request().Context(), c.Response().Writer)
}
```

### Testing
Use `testutil.SetupTestDatabase(t)` and `testutil.SetupTestEcho()`:

```go
func TestSomething(t *testing.T) {
    testutil.SetupTestDatabase(t)
    e := testutil.SetupTestEcho()
    // ... test code ...
    assert.NoError(t, err)
    assert.Equal(t, http.StatusOK, rec.Code)
}
```

## Architecture Patterns

### Templates (Templ)
- Edit only `.templ` files, never `*_templ.go`
- Run `go generate ./...` after changes
- Use type-safe data structs defined in templates

### Datastar
- Use only Datastar for reactivity (no htmx/Alpine)
- Signals: `data-signals="{foo: ''}"` with JSON object syntax
- Binding: `data-bind:foo` (colon syntax)
- Events: `data-on:click="@post('/endpoint')"` (colon syntax)
- SSE handlers: Use `datastar.NewSSE()` and return `PatchElements`/`PatchSignals`
- **Dynamic classes**: Use `data-class` for reactive class binding (preferred over `templ.KV()`):
  ```html
  <button class="btn btn-ghost" data-class="{ 'bg-primary/20': $viewMode === 'list' }">
  ```
  This enables reactive class toggling based on signal values without page reloads.

### File Storage
- Uploads: `data/assets/` (UUID-based filenames)
- Cache: `data/cache/` (resized images)
- Soft deletion default (GORM `deleted_at`)

### Auth
- Session cookies with 24h expiry
- bcrypt cost 14 for passwords
- Personal library auto-created on registration

## Important Rules

1. **Never edit `*_templ.go` files** - always regenerate
2. **Use Datastar exclusively** - no other JS frameworks for UI
3. **Domain packages self-register** - add `routes.go` to each domain
4. **Test DB mirrors production** - see `internal/testing/db.go`
5. **Signal names match JSON tags** - use camelCase consistently
6. **libvips required** - system dependency for image processing
7. **TailwindCSS only** - No custom `<style>` tags or inline CSS in .templ files. Use Tailwind utility classes exclusively.

## Environment Variables

Required: `ALCOVES_DATABASE_URL` (PostgreSQL or SQLite)
- **PostgreSQL**: `postgres://user:password@localhost/dbname`
- **SQLite**: `sqlite:./path/to/database.db` or `sqlite::memory:`

Optional: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OTEL_SERVICE_NAME`
