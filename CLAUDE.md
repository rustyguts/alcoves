# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

Alcoves is a self-hosted collaborative file library with a Nuxt 4 (Vue 3) frontend and a Go API backend.
It has:

- **Frontend** (`frontend/`): Nuxt 4 app with Nuxt UI v4 module (runs on its own Nitro server). SSR is scoped to `/s/**` (public moment share pages); all other routes are client-rendered via `routeRules` to avoid SSR-time backend coupling and a native-form-submit race during hydration.
- **Backend** (`backend/`): Go API server with Echo framework, GORM, and PostgreSQL
- Session auth with AES-GCM encrypted cookies
- Local or S3-backed file/avatar/cache storage
- Async job queue (Asynq + Dragonfly/Redis) for face/object detection and video transcoding

**Deploy topology**: Nuxt Nitro server on :3000 + Go API on :3001. Nuxt proxies `/api/**` and `/s/**` to Go in dev; in prod, put both behind the same reverse proxy. The Go binary no longer embeds the frontend.

## Core Commands

### Frontend (run from `frontend/` directory)

- `bun install` — installs with hoisted linker (see `bunfig.toml`; avoids a Nitro symlink-loop bug)
- `bun run dev` — Start Nuxt dev server on :3000, proxies `/api/**` + `/s/**` to Go backend
- `bun run build` — Build production server (writes `.output/`)
- `bun run preview` — Serve the built production server (`node .output/server/index.mjs`)
- `bun run typecheck` — `nuxt typecheck` (vue-tsc against generated types)
- `bun run lint` / `bun run lint:fix` — Run OXlint
- `bun run fmt` / `bun run fmt:check` — Format with OXfmt
- `bun run test:unit` — Vitest unit tests (runs in Nuxt test env via `@nuxt/test-utils`)
- `bun run test:unit:coverage` — Unit tests with coverage
- `bun run test:e2e` — Playwright end-to-end tests against `nuxt dev --port 4173`
- `bun run coverage:summary` — Display coverage summary

Run a single unit test file or pattern:
```bash
bun run test:unit test/composables/useApiFetch.spec.ts
bun run test:unit -- --reporter=verbose -t "pattern"
```

### Backend (run from `backend/` directory)

- `go run cmd/server/main.go` — Start Go API server
- `go test ./...` — Run all tests
- `go test ./internal/handlers/... -v` — Run handler tests verbosely
- `go test ./internal/handlers/... -run TestFunctionName` — Run a specific test
- `go build -o bin/alcoves cmd/server/main.go` — Build binary

### Docker (local development)

```bash
# Start infrastructure + backend + frontend
docker compose up

# Infrastructure only
docker compose up -d postgres dragonfly
```

Frontend container runs `Dockerfile.dev` (`bun run dev`) on :3000. Backend container runs Go with Air hot-reload on :3001. Postgres on :5432, Dragonfly (Redis) on :6389.

## Architecture Notes

### Backend (`backend/`)

- Entry point: `backend/cmd/server/main.go`
- `backend/internal/` contains all application code
- `backend/internal/handlers/` — HTTP request handlers (one file per resource)
- `backend/internal/middleware/` — Auth + library-access-control middleware
- `backend/internal/models/` — GORM entity definitions
- `backend/internal/services/` — Business logic: auth, storage, facedetection, objectdetection, imageproxy, videoproxy, momentexport
- Database migrations use [Goose](https://github.com/pressly/goose) format, located in `migrations/`
- Async processing uses [Asynq](https://github.com/hibiken/asynq) backed by Dragonfly (Redis-compatible); workers run when `ALCOVES_MODE=all` or `ALCOVES_MODE=worker`
- Image processing: `govips` (libvips wrapper); object/face detection: ONNX Runtime via `onnxruntime_go`
- The Go binary is pure API; it no longer embeds or serves the frontend

Route groups registered in `main.go`:
```
/api/auth            → Auth (login, register, OAuth, session)
/api/libraries       → Library CRUD
/api/libraries/:id/* → Files, folders, tags, members, invites, people, moments
/api/invites         → Invite acceptance
/api/search          → Global search
/api/admin           → Admin + job queue dashboard
/api/tus             → TUS resumable uploads
/api/files           → File proxy (image transform, video)
/api/share/:token/*  → Public moment share metadata + video + thumbnail (no auth)
/api/_auth/session   → Session validation (used by frontend auth guard)
/api/health          → Health check
```

### Frontend (`frontend/`)

- Nuxt 4 with `srcDir: 'app'` (default). Config in `nuxt.config.ts`
- `app/pages/` — file-based routes. Dynamic segments use `[id]`, `[token]`, etc.
  - `app/pages/libraries/[id]/` — nested layout via `definePageMeta({ layout: 'library' })`
  - `app/pages/libraries/[id]/index.vue` — library browser; aliased to `/libraries/:id/trash`
  - `app/pages/libraries/[id]/edit/[fileId].vue` — video editor
  - `app/pages/libraries/[id]/people/index.vue` + `people/[personId].vue` — face/person UI
  - `app/pages/s/[token].vue` — public moment share landing page (SSR; public; no auth)
- `app/layouts/dashboard.vue` — Primary authenticated shell (uses `<slot/>`)
- `app/layouts/library.vue` — Nested layout wrapping library pages (header + tabs + `<slot/>`)
- `app/middleware/auth.global.ts` — Nuxt route middleware; replaces old vue-router guard
- `app/composables/` — auto-imported by Nuxt; shared composition hooks (`useAuth`, `useApiFetch`, `useLibraryExplorer`, `useUploadQueue`, etc.)
- `app/utils/api-fetch.ts` — Isomorphic fetch wrapper. On SSR, prepends `runtimeConfig.apiUrl` and forwards the request's `Cookie` header via `useRequestHeaders(['cookie'])`. On client uses a relative URL proxied by Nitro.
- `app/composables/useApiFetch.ts` — Wraps `useAsyncData` so SSR payloads hydrate on the client
- `shared/types/api.ts` — API response type definitions (imported as `~~/shared/types/api`)
- Nitro dev proxy: `/api/**` → `$ALCOVES_API_URL` (default `http://localhost:3001`); same for `/s/**`
- `bunfig.toml` sets `linker = "hoisted"` to avoid an ELOOP bug where bun's default symlink layout breaks Nitro's dependency trace step

### Testing Conventions

**Frontend unit tests** (Vitest + `@nuxt/test-utils`, `environment: "nuxt"`):
- `vitest.config.ts` uses `defineVitestConfig` from `@nuxt/test-utils/config`
- `test/setup.ts` installs Nuxt UI component stubs (unprefixed names like `Modal`, not `UModal`)
- Mock `useToast` via `vi.mock("@nuxt/ui/composables/useToast")`
- `#imports` mocks DO work inside the Nuxt test env
- Some pre-migration tests still stub `vue-router`; those patterns continue to work because Nuxt's `useRouter` resolves to vue-router under the hood

**Frontend E2E tests** (Playwright, files in `test/e2e/`):
- All API calls are mocked via `page.route()` — no real backend needed
- Playwright starts `nuxt dev --port 4173` automatically (see `playwright.config.ts`)

**Backend tests** (standard `testing` package):
- Test files live alongside the packages they test (`*_test.go`)
- Use `-run TestName` to target a single test function

## Environment

Backend env vars (Go):

- `ALCOVES_MODE` — `all` (default), `api`, or `worker`
- `ALCOVES_DATABASE_URL` — PostgreSQL connection string
- `ALCOVES_SESSION_SECRET` — AES-GCM key (minimum 32 bytes)
- `ALCOVES_STORAGE_DRIVER` — `local` (default) or `s3`
- `ALCOVES_STORAGE_PATH` / `ALCOVES_AVATAR_STORAGE_PATH` / `ALCOVES_CACHE_STORAGE_PATH`
- `ALCOVES_QUEUE_HOST` / `ALCOVES_QUEUE_PORT` — Dragonfly/Redis connection
- `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` / `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET`
- `ALCOVES_BASE_URL` — Public-facing URL (used for OAuth redirects + share links)
- S3 vars: `ALCOVES_S3_BUCKET`, `ALCOVES_S3_REGION`, `ALCOVES_S3_ENDPOINT`, etc.

Frontend env vars (Nuxt):

- `ALCOVES_API_URL` — Go backend URL for Nitro dev proxy / SSR backend calls (default: `http://localhost:3001`). Exposed as `runtimeConfig.apiUrl`.
- `NITRO_HOST` / `NITRO_PORT` — override server bind address (default `:3000`)

See `.env.example` for full list and defaults.

## Lights Off Software Factory

When the user says "turn off the lights", follow the full workflow defined in [turn-off-the-lights.md](turn-off-the-lights.md).

## Engineering Guardrails

- Do not switch package manager (Bun) or lint/format stack (OXlint/OXfmt)
- Prefer adding/adjusting tests when behavior changes
- Run targeted tests first, then broader suites when needed
- Avoid destructive git commands and do not revert unrelated local changes
- When adding DOM/`window`/`localStorage` access to a new component or composable, guard with `import.meta.client` or wrap in `onMounted` — pages are SSR'd by default
