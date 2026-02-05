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
- Video playback and proxy creation
- File tagging at a library level
- Sorting files by tags
- Search within library for files
- Facial recognition for images (entirely optional, runs locally)
- Add and remove people to librarys. Manage their access

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
- Use only Datastar for reactivity
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

## Datastar Quick Reference

Alcoves uses [Datastar](https://data-star.dev/) as its sole frontend framework for reactivity and backend communication.

### Core Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-signals` | Initialize reactive signals | `<div data-signals="{count: 0}">` |
| `data-bind` | Two-way binding to inputs | `<input data-bind:searchQuery />` |
| `data-text` | Display signal value as text | `<span data-text="$searchQuery"></span>` |
| `data-show` | Toggle visibility | `<div data-show="$isLoading"></div>` |
| `data-class` | Toggle CSS classes | `<button data-class:active="$isActive">` |
| `data-attr` | Set any attribute | `<button data-attr:disabled="$isDisabled">` |
| `data-on` | Event handlers | `<button data-on:click="$count++">` |
| `data-computed` | Derived signals | `<div data-computed:fullName="$firstName + ' ' + $lastName">` |

### Backend Actions

Use `@action()` syntax to trigger backend requests:

```html
<button data-on:click="@get('/api/data')">Load</button>
<button data-on:click="@post('/api/save')">Save</button>
<button data-on:click="@put('/api/update')">Update</button>
<button data-on:click="@delete('/api/item')">Delete</button>
<button data-on:click="@patch('/api/modify')">Patch</button>
```

### Signals in Go

**Define signals in templates:**
```html
<div data-signals="{searchQuery: '', isLoading: false, results: []}">
```

**Read signals in handlers:**
```go
import "github.com/starfederation/datastar-go/datastar"

type SearchSignals struct {
    SearchQuery string   `json:"searchQuery"`
    IsLoading   bool     `json:"isLoading"`
    Results     []string `json:"results"`
}

func SearchHandler(c echo.Context) error {
    var signals SearchSignals
    if err := datastar.ReadSignals(c.Request(), &signals); err != nil {
        return c.String(http.StatusBadRequest, "Invalid request")
    }
    // Use signals.SearchQuery, signals.IsLoading, etc.
}
```

### Server-Sent Events (SSE)

**Send updates to frontend:**
```go
sse := datastar.NewSSE(c.Response().Writer, c.Request())

// Update DOM elements
sse.PatchElements("<div id='results'>New content</div>")

// Update signals
sse.PatchSignals([]byte(`{isLoading: false, results: ['a', 'b']}`))

// Execute JavaScript
sse.ExecuteScript("alert('Done!')")
```

**Multiple events in one response:**
```go
sse := datastar.NewSSE(c.Response().Writer, c.Request())
sse.PatchSignals([]byte(`{isLoading: true}`))
sse.PatchElements(updatedSidebar)
sse.PatchSignals([]byte(`{isLoading: false}`))
```

### Common Patterns

**Loading indicator:**
```html
<button data-on:click="@get('/api/data')" data-indicator:isFetching>
  Load Data
</button>
<div data-show="$isFetching">Loading...</div>
```

**Conditional classes:**
```html
<button data-class="{ 'btn-primary': $isActive, 'btn-ghost': !$isActive }">
  Toggle
</button>
```

**Form with validation:**
```html
<form data-signals="{email: '', error: ''}">
  <input data-bind:email data-on:input="$error = ''" />
  <div data-text="$error" data-show="$error"></div>
  <button data-on:click="@post('/api/submit')">Submit</button>
</form>
```

**Modal open/close:**
```html
<div data-signals="{showModal: false}">
  <button data-on:click="$showModal = true">Open</button>
  <div data-show="$showModal" style="display: none">
    <div class="modal" data-on:click="$showModal = false">
      <div class="modal-box">Content here</div>
    </div>
  </div>
</div>
```

### Key Rules

1. **Signal naming**: Use camelCase, match Go JSON tags exactly
2. **Expressions**: Use `$` prefix for signals (e.g., `$foo`)
3. **Local signals**: Prefix with `_` to prevent sending to backend (e.g., `_localVar`)
4. **All signals sent**: By default, all signals are included in every backend request
5. **Nested signals**: Use dot notation: `data-signals:user.name="John"`
6. **Casing**: Hyphenated attribute names convert to camelCase (`data-bind:foo-bar` → `$fooBar`)
7. **Class/Attr casing**: Convert to kebab-case (`data-class:font-bold` → class `font-bold`)

### Expressions

Datastar expressions support JavaScript operators:
```html
<!-- Ternary -->
<div data-text="$isAdmin ? 'Admin' : 'User'">

<!-- Logical OR/AND -->
<button data-show="$isLoggedIn || $isGuest">
<button data-on:click="$isReady && @post('/go')">

<!-- Multiple statements (use semicolons) -->
<button data-on:click="$count++; @post('/save')">
```

### SDK Reference (Go)

```go
import "github.com/starfederation/datastar-go/datastar"

// Create SSE generator
sse := datastar.NewSSE(writer, request)

// Patch elements (morphs DOM by ID)
sse.PatchElements(htmlString, datastar.WithSelectorID("target-id"))
sse.PatchElements(htmlString, datastar.WithModeAppend())  // Append instead of morph

// Patch signals (merges with frontend signals)
sse.PatchSignals([]byte(`{key: 'value'}`))

// Execute JavaScript
sse.ExecuteScript("console.log('Hello')")

// Read signals from request
var signals MySignalsStruct
err := datastar.ReadSignals(request, &signals)
```

### Useful Resources

- [Datastar Docs](https://data-star.dev/docs) - Full documentation
- [Datastar Reference](https://data-star.dev/reference) - Complete attribute/action reference
- [Examples](https://data-star.dev/examples) - Sample implementations
- [VSCode Extension](https://marketplace.visualstudio.com/items?itemName=starfederation.datastar-vscode) - Autocompletion
