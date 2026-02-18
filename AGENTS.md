# AGENTS.md

Instructions for coding agents working in this repository.

## Architecture

- **Frontend** (`frontend/`): Vue 3 + Vite SPA, DaisyUI v5 + Tailwind CSS v4, vue-router
- **Backend** (`backend/`): Go 1.25, Echo v4 framework, GORM ORM, PostgreSQL (pgvector)
- **Auth**: AES-GCM encrypted session cookies, optional Google OAuth
- **Jobs**: Asynq (Redis-backed via Dragonfly) for face detection and video proxy
- **Storage**: local filesystem driver (S3-compatible interface exists)
- **Package manager**: Bun (frontend only); Go modules (backend)

## Important Paths

```
frontend/
  app/components/       Vue components
  app/composables/      Composables (useAuth, useUploadQueue, etc.)
  app/pages/            Route pages
  app/utils/            Utilities (api-fetch.ts, mime-icons.ts)
  app/layouts/          Layout components
  app/router.ts         Route definitions
  shared/types/api.ts   Shared API type definitions
  test/                 Unit tests (mirrors app/ structure)
  test/e2e/             Playwright E2E tests

backend/
  cmd/server/main.go    Entrypoint
  internal/handlers/    HTTP handlers (Echo)
  internal/services/    Domain services (storage, imageproxy, facedetection, etc.)
  internal/models/      GORM models (all in models.go)
  internal/middleware/   Auth + library access middleware
  internal/config/      Env-based config
  internal/database/    DB connection + migration runner
  migrations/           Versioned SQL migrations
```

## Commands — Frontend (run from `frontend/`)

```sh
bun install                  # Install dependencies
bun run dev                  # Vite dev server (proxies /api to Go backend)
bun run build                # Production build
bun run typecheck            # vue-tsc --noEmit
bun run lint                 # OXlint
bun run fmt                  # OXfmt
bun run test:unit            # Vitest unit tests
bun run test:unit:coverage   # Unit tests with V8 coverage
bun run test:e2e             # Playwright E2E tests

# Run a single test file:
bunx vitest run --config vitest.config.ts test/components/AlcovesImage.spec.ts

# Run tests matching a name pattern:
bunx vitest run --config vitest.config.ts -t "builds a proxy url"
```

## Commands — Backend (run from `backend/`)

```sh
go build ./...                           # Compile all packages
go test ./...                            # Run all tests
go vet ./...                             # Static analysis

# Run tests for one package:
go test -v ./internal/handlers/...
go test -v ./internal/services/imageproxy/...

# Run a single test by name:
go test -v -run TestServe_WidthOnly ./internal/handlers/...

# Dev server (requires Air):
air                                      # Hot-reload via .air.toml
go run -tags dev cmd/server/main.go      # Manual start (dev mode)
```

## Database

### Schema migrations

Migrations use [goose](https://github.com/pressly/goose) with versioned SQL files in
`backend/migrations/`. They are embedded into the binary via `//go:embed` and applied
automatically on every startup (both development and production). Running twice is a no-op —
goose tracks applied versions in the `goose_db_version` table.

- Source of truth for schema: SQL migration files in `backend/migrations/`
- GORM models in `backend/internal/models/models.go` must match the schema
- Test DB: `postgres://postgres:postgres@localhost:5455/alcoves_test`
- Tests use GORM AutoMigrate (not goose) for speed and simplicity
- Tests skip gracefully via `t.Skipf` when the DB is unavailable
- pgvector extension and `embedding vector(512)` column are created in the initial migration

### Creating a new migration

When changing the database schema (adding/removing/altering columns, tables, or indexes):

1. Update the GORM model in `backend/internal/models/models.go`
2. Create a new migration file (from `backend/`):
   ```sh
   # Install goose CLI once:
   go install github.com/pressly/goose/v3/cmd/goose@latest

   # Create the migration file:
   goose -dir migrations -s create describe_the_change sql
   ```
   This creates `backend/migrations/00002_describe_the_change.sql` (sequential numbering).
3. Write the Up and Down SQL in the generated file:
   ```sql
   -- +goose Up
   ALTER TABLE files ADD COLUMN thumbnail_path TEXT;

   -- +goose Down
   ALTER TABLE files DROP COLUMN thumbnail_path;
   ```
4. Restart the server — goose applies the pending migration automatically
5. Commit both the model change and the migration file together

### Migration conventions

- Use `IF NOT EXISTS` / `IF EXISTS` guards for idempotent DDL where practical
- Use `-- +goose NO TRANSACTION` only when required (e.g., `CREATE INDEX CONCURRENTLY`)
- Always write a `-- +goose Down` section for reversibility
- Sequential numbering (`-s` flag) — do not use timestamps
- One logical change per migration file
- Keep migrations small and focused

## Environment

See `.env.example`. Key variables:
- `ALCOVES_DATABASE_URL` — PostgreSQL connection string
- `ALCOVES_SESSION_SECRET` — min 32 chars, AES-GCM key
- `ALCOVES_STORAGE_PATH` — local file storage root
- `ALCOVES_QUEUE_HOST` / `ALCOVES_QUEUE_PORT` — Redis/Dragonfly for Asynq
- `ALCOVES_ENV` — `development` (default) or `production`

## Working Rules

- Prefer small, focused diffs over broad refactors.
- Preserve existing behavior unless the task explicitly changes it.
- Do not remove or rewrite unrelated changes in a dirty tree.
- Never use destructive git commands unless explicitly requested.
- When changing behavior, add or update relevant tests.
- Run targeted tests first, then broader suites. Report any skipped tests.

## Frontend Code Style

**UI framework**: DaisyUI v5 on Tailwind CSS v4. When building or modifying frontend components,
fetch https://daisyui.com/llms.txt for the full component class reference. Key rules:
- Style elements using daisyUI component classes (`btn`, `modal`, `card`, `input`, etc.) and
  Tailwind utility classes. No custom CSS unless absolutely necessary.
- Use daisyUI semantic colors (`primary`, `base-100`, `error`, etc.) instead of Tailwind color
  names (`red-500`) so colors adapt to the active theme automatically.
- Layouts should be responsive using Tailwind responsive prefixes (`sm:`, `lg:`, etc.).
- No `<style scoped>` blocks — all styling is utility-class-based.

**Formatting** (enforced by OXfmt): 2-space indent, double quotes, semicolons, trailing commas,
100-char print width. No ESLint/Prettier — use `bun run fmt` and `bun run lint` (OXlint).

**Components**: Always `<script setup lang="ts">`. No Options API. No `<style scoped>` — use
Tailwind/DaisyUI utility classes exclusively. Props via `defineProps<{}>()` or named `interface
Props` with `withDefaults`. Emits via typed `defineEmits<{}>()`.

**Imports**: Type imports use `import type`. `.vue` files rely on auto-imports for Vue APIs
(`ref`, `computed`, `watch`, etc.). `.ts` files import Vue APIs explicitly. Use path aliases
(`~/` for `app/`, `~~/` for project root). No barrel files — import specific file paths.

**TypeScript**: `interface` for object shapes, `type` for unions and aliases. No `I` prefix.
`catch (error: unknown)` with `instanceof` narrowing, or bare `catch {}` when the error is
irrelevant. Nullable state: `Ref<T | null>`.

**Composables**: Named export `export function useXxx(...)`. Module-level `ref()` for singleton
shared state (auth, toasts, upload queue). Return plain objects of refs and functions. Surface
errors via toast notifications.

**Tests**: Vitest with `jsdom`. Tests mirror `app/` structure under `test/`. Use `vi.hoisted()` +
`vi.mock()` for mock state. Mount components via `@vue/test-utils` `mount()`. Composable tests
call the function directly and assert with `vi.waitFor()`. Use `describe`/`it` blocks (globals
enabled). Reset in `beforeEach`.

## Backend Code Style

**Imports**: Three groups separated by blank lines — (1) stdlib, (2) third-party, (3) internal.
Alphabetically sorted within each group. Aliases only when needed (e.g., `authservice`).

**Naming**: Handler structs have `Handler` suffix (`FileHandler`). Constructors: `NewXxxHandler`.
Route registration: `RegisterRoutes(g *echo.Group)`. Request/response DTOs: unexported
(`registerRequest`, `userResponse`). Interfaces: no `I` prefix (`Driver`, `Processor`). JSON
tags: `camelCase`. GORM column tags: `snake_case`. Service dependencies abbreviated: `storageSvc`,
`faceSvc`. Echo context always `c`, receiver always `h`.

**Error handling**: Handlers return `echo.NewHTTPError(status, "Message")`. Messages are
sentence-case, no trailing period (`"File not found"`, `"Failed to hash password"`). Service
internals use `fmt.Errorf("...: %w", err)` for wrapping. Non-fatal background errors use
`log.Printf`. Deliberate ignores use blank identifier.

**Handler pattern**: Every handler follows: struct with unexported deps → `NewXxx` constructor →
`RegisterRoutes` → handler methods returning `error`. GORM queries inline on `h.db`. Responses
via `c.JSON(status, data)`. Multiple related handlers may share a file.

**Models**: All in `models.go`. Explicit `TableName()` and `BeforeCreate` hook on every model.
Optional fields use pointer types (`*string`, `*time.Time`). Relationships use `json:"-"`.

**Tests**: Same package (white-box). DB tests use `t.Helper()` setup helpers, `t.Skipf` when DB
is unavailable, `t.TempDir()` for storage. Assertions use plain `if` + `t.Errorf`/`t.Fatalf`
(no testify). Format: `"Expected X, got Y"`. Table-driven tests use `tt` as the loop variable.
Mock types are minimal, defined in test files, implementing production interfaces.
