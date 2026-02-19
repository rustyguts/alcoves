# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

- Monorepo with:
  - `frontend/`: Vue 3 + Vite SPA, TypeScript, Tailwind v4, DaisyUI v5
  - `backend/`: Go 1.25, Echo v4, GORM, PostgreSQL
- Auth uses session cookies (same-origin in local dev)
- Uploads use tus resumable protocol (`/api/tus`)
- Background jobs use Asynq (Redis/Dragonfly)

## Key Paths

- `frontend/app/pages/` route pages
- `frontend/app/components/` UI components
- `frontend/app/composables/` composables (`useAuth`, `useUploadQueue`, etc.)
- `frontend/app/utils/` helpers (`api-fetch.ts`, mime helpers)
- `frontend/shared/types/api.ts` shared API types
- `frontend/test/` unit tests
- `frontend/test/e2e/` Playwright tests
- `backend/cmd/server/main.go` backend entrypoint
- `backend/internal/handlers/` HTTP handlers
- `backend/internal/services/` domain services
- `backend/internal/middleware/` auth/access middleware
- `backend/internal/models/models.go` GORM models
- `backend/migrations/` goose SQL migrations (embedded)

## Rules Files Status

- Checked for Cursor rules and Copilot instructions:
  - `.cursor/rules/` -> not present
  - `.cursorrules` -> not present
  - `.github/copilot-instructions.md` -> not present
- If any of these files are added later, treat them as highest-priority repo instructions.

## Build / Lint / Test Commands

## Frontend (`cd frontend`)

- Install deps: `bun install`
- Dev server: `bun run dev`
- Build: `bun run build`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format: `bun run fmt`
- Unit tests: `bun run test:unit`
- Unit tests with coverage: `bun run test:unit:coverage`
- E2E tests: `bun run test:e2e`

### Frontend single-test commands

- Single unit test file:
  - `bunx vitest run --config vitest.config.ts test/pages/admin.spec.ts`
- Single unit test by name:
  - `bunx vitest run --config vitest.config.ts -t "renders the admin heading"`
- Single Playwright file:
  - `bunx playwright test test/e2e/library-management.e2e.spec.ts`
- Single Playwright test by line:
  - `bunx playwright test test/e2e/library-management.e2e.spec.ts:245`

## Backend (`cd backend`)

- Build all packages: `go build ./...`
- Run tests: `go test ./...`
- Run vet: `go vet ./...`
- Run server (dev build tags): `go run -tags dev cmd/server/main.go`

### Backend single-test commands

- One package:
  - `go test -v ./internal/handlers/...`
- One test name pattern:
  - `go test -v -run TestNeedsAuth ./internal/middleware/...`
- One package + one test:
  - `go test -v ./internal/handlers/... -run TestTusCreateAndPatch`

## Repository-level useful commands

- Build production image from repo root:
  - `docker build -t alcoves:test .`
- Inspect image size:
  - `docker image inspect alcoves:test --format '{{.Size}}'`

## Database / Migrations

- Migrations live in `backend/migrations/` and are embedded in the Go binary.
- Startup runs migrations automatically (goose), so production image does not need loose migration files.
- For schema changes:
  1. Update model(s) in `backend/internal/models/models.go`
  2. Add a new goose SQL migration
  3. Keep `Up` and `Down` sections
  4. Commit model + migration together

## Frontend Style Guide

- Use `<script setup lang="ts">` for Vue SFCs.
- Prefer composables and typed refs/computed over ad hoc globals.
- Use path aliases:
  - `~/` for `frontend/app`
  - `~~/` for `frontend` root
- Use `import type` for type-only imports.
- Styling should use DaisyUI + Tailwind utility classes.
- Prefer DaisyUI semantic tokens (`primary`, `base-100`, `error`, etc.) over raw color scales.
- Keep components responsive (`sm:`, `md:`, `lg:`).
- Avoid custom CSS unless utilities/components cannot express the design.

### Vue/TS specifics

- Use typed `defineProps` / `defineEmits`.
- Prefer `interface` for object shapes; `type` for unions/helpers.
- Avoid `any`; if unknown, use `unknown` and narrow.
- Keep nullable state explicit (`T | null`).
- Use early returns and guard clauses for readability.

### Frontend error handling

- API calls should go through `apiFetch`.
- Surface user-facing failures with toasts.
- Use `try/catch` around mutations; keep messages concise and actionable.

## Backend Style Guide

- Keep import groups separated: stdlib, third-party, internal.
- Handlers follow pattern: constructor -> `RegisterRoutes` -> methods.
- Return HTTP errors with `echo.NewHTTPError(status, message)`.
- Use `fmt.Errorf("...: %w", err)` when propagating service/internal errors.
- Keep handler messages consistent, short, and sentence-case.
- Prefer explicit DTO structs for request/response payloads.

### Go naming conventions

- Constructors: `NewXxx...`
- Handler structs: `XxxHandler`
- Services usually hold dependencies as `...Svc` fields when needed.
- Keep receiver names short and consistent (`h`, `s`).

### Backend testing conventions

- Use standard `testing` package assertions (`if ... { t.Fatalf/t.Errorf }`).
- Favor table-driven tests for parser/validation logic.
- Run package-targeted tests first before full `go test ./...`.

## Agent Workflow Expectations

- Prefer minimal, focused diffs over broad rewrites.
- Do not revert unrelated user changes in a dirty worktree.
- Run targeted tests for touched areas; then run broader suites when reasonable.
- If behavior changes, update/add tests in the same change.
- Keep commit-ready code formatted and typechecked.

## Quick Pre-PR Checklist

- Frontend: `bun run typecheck` + relevant unit/e2e tests
- Backend: `go test ./...` (or at least affected packages)
- If Docker touched: `docker build -t alcoves:test .`
- Verify no accidental secrets or environment files are staged
