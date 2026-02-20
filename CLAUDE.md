# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

Alcoves is a self-hosted collaborative file library with a Vue 3 + Vite frontend and a Go backend.
It has:

- **Frontend** (`frontend/`): Vue 3 + Vite SPA with Nuxt UI v4 (standalone mode)
- **Backend** (`backend/`): Go API server with Echo framework, GORM, and PostgreSQL
- Session auth with AES-GCM encrypted cookies
- Local or S3-backed file/avatar/cache storage
- Async job queue (Asynq + Dragonfly/Redis) for face/object detection and video transcoding

## Core Commands

### Frontend (run from `frontend/` directory)

- `bun install`
- `bun run dev` - Start Vite dev server (proxies `/api/*` to Go backend)
- `bun run build` - Build production SPA
- `bun run typecheck` - TypeScript type checking
- `bun run lint` / `bun run lint:fix` - Run OXlint
- `bun run fmt` / `bun run fmt:check` - Format with OXfmt
- `bun run test:unit` - Run unit tests (Vitest)
- `bun run test:unit:coverage` - Unit tests with coverage
- `bun run test:e2e` - Run end-to-end tests (Playwright)
- `bun run coverage:summary` - Display coverage summary

Run a single unit test file or pattern:
```bash
bun run test:unit test/composables/useApiFetch.spec.ts
bun run test:unit -- --reporter=verbose -t "pattern"
```

### Backend (run from `backend/` directory)

- `go run cmd/server/main.go` - Start Go API server
- `go test ./...` - Run all tests
- `go test ./internal/handlers/... -v` - Run handler tests verbosely
- `go test ./internal/handlers/... -run TestFunctionName` - Run a specific test
- `go build -o bin/alcoves cmd/server/main.go` - Build binary

### Docker (local development)

```bash
# Start infrastructure (Postgres + Dragonfly job queue)
docker compose up -d postgres dragonfly

# Start all services including backend with hot reload (Air)
docker compose up

# Include the frontend Vite dev server
docker compose --profile frontend up
```

## Architecture Notes

### Backend (`backend/`)

- Entry point: `backend/cmd/server/main.go`
- `backend/internal/` contains all application code
- `backend/internal/handlers/` — HTTP request handlers (one file per resource)
- `backend/internal/middleware/` — Auth + library-access-control middleware
- `backend/internal/models/` — GORM entity definitions
- `backend/internal/services/` — Business logic: auth, storage, facedetection, objectdetection, imageproxy, videoproxy
- `backend/internal/spa/` — Embeds the compiled frontend (`//go:embed dist/*`)
- Database migrations use [Goose](https://github.com/pressly/goose) format, located in `migrations/`
- Async processing uses [Asynq](https://github.com/hibiken/asynq) backed by Dragonfly (Redis-compatible); workers run when `ALCOVES_MODE=all` or `ALCOVES_MODE=worker`
- Image processing: `govips` (libvips wrapper); object/face detection: ONNX Runtime via `onnxruntime_go`

Route groups registered in `main.go`:
```
/api/auth            → Auth (login, register, OAuth, session)
/api/libraries       → Library CRUD
/api/libraries/:id/* → Files, folders, tags, members, invites, people
/api/invites         → Invite acceptance
/api/search          → Global search
/api/admin           → Admin + job queue dashboard
/api/tus             → TUS resumable uploads
/api/files           → File proxy (image transform, video)
/api/_auth/session   → Session validation (used by frontend auth guard)
/api/health          → Health check
```

### Frontend (`frontend/`)

- **Not using Nuxt SSR** — Pure Vue 3 + Vite SPA
- Uses Nuxt UI v4 in standalone mode via `@nuxt/ui/vite` plugin
- `app/pages/` defines routes; `app/router.ts` wires them up
- `app/router/auth-guard.ts` — vue-router `beforeEach` hook that redirects unauthenticated users
- `app/layouts/dashboard.vue` — Primary authenticated shell
- `app/composables/` — Shared composition hooks (useAuth, useApiFetch, useLibraryExplorer, useUploadQueue, etc.)
- `app/utils/api-fetch.ts` — Custom fetch wrapper (replaces Nuxt's `$fetch`)
- `shared/types/api.ts` — API response type definitions shared across the app
- Vite dev server proxies `/api/*` to Go backend (controlled by `ALCOVES_API_URL`)

### Testing Conventions

**Frontend unit tests** (Vitest + jsdom, files in `test/`):
- Mock `useRouter`/`useRoute` via `vi.mock("vue-router")`
- Mock `useToast` via `vi.mock("@nuxt/ui/composables/useToast")`
- Nuxt UI component stubs use **unprefixed** names (e.g., `Modal`, not `UModal`)
- `vi.mock("#imports")` does not work — mock the actual module paths

**Frontend E2E tests** (Playwright, files in `test/e2e/`):
- All API calls are mocked via `page.route()` — no real backend needed
- Playwright starts Vite preview server at `http://127.0.0.1:4173` automatically

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
- `ALCOVES_BASE_URL` — Public-facing URL (used for OAuth redirects)
- S3 vars: `ALCOVES_S3_BUCKET`, `ALCOVES_S3_REGION`, `ALCOVES_S3_ENDPOINT`, etc.

Frontend env vars (Vite):

- `ALCOVES_API_URL` — Go backend URL for dev proxy (default: `http://localhost:3001`)

See `.env.example` for full list and defaults.

## Lights Off Software Factory

When the user says "turn off the lights", follow this full workflow:

### Project Board Reference

- **Project number:** 4 (`PVT_kwHOAIy35s4BPqTK`)
- **Status field ID:** `PVTSSF_lAHOAIy35s4BPqTKzg-AY68`
- **Status option IDs:**
  - Ready: `61e4505c`
  - In progress: `47fc9ee4`
  - In review: `df73e18b`
  - Done: `98236657`

### Workflow

**0. Prepare the workspace**
- Stash any uncommitted changes on the current branch
- Checkout `main` and pull with rebase

**1. Pick an issue from Ready**
```bash
gh project item-list 4 --owner rustyguts --format json | jq '[.items[] | select(.status == "Ready" and .content.type == "Issue")]'
```
Pick the first item. Note its `id` (the project item ID, e.g. `PVTI_...`) and the issue number.

**2. Read the ticket**
```bash
gh issue view <issue-number> --repo rustyguts/alcoves
```

**3. Move to "In Progress"**
```bash
gh project item-edit \
  --id <project-item-id> \
  --field-id PVTSSF_lAHOAIy35s4BPqTKzg-AY68 \
  --project-id PVT_kwHOAIy35s4BPqTK \
  --single-select-option-id 47fc9ee4
```

**4. Implement the ticket**
Create a branch named after the issue (e.g. `git checkout -b issue-<number>-short-description`), then implement the changes.

**5. Write tests for the code**
Follow the testing conventions in this file. Run targeted tests first.

**6. Run all linting and tests**

Frontend (from `frontend/`):
```bash
bun run lint && bun run fmt:check && bun run typecheck && bun run test:unit
```

Backend (from `backend/`):
```bash
go test ./...
```

Fix any issues before proceeding.

**7. Open a PR with the code changes**

Include `Closes #<issue-number>` in the PR body to link the issue:
```bash
gh pr create \
  --repo rustyguts/alcoves \
  --title "<descriptive title>" \
  --body "$(cat <<'EOF'
## Summary
<bullet points>

## Test plan
<checklist>

Closes #<issue-number>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**8. Add the PR to the project board and move ticket to "In Review"**

Add the PR to the project:
```bash
gh project item-add 4 --owner rustyguts --url <PR_URL>
```

Move the issue to "In Review":
```bash
gh project item-edit \
  --id <project-item-id> \
  --field-id PVTSSF_lAHOAIy35s4BPqTKzg-AY68 \
  --project-id PVT_kwHOAIy35s4BPqTK \
  --single-select-option-id df73e18b
```

**9. Done** — Report the PR URL to the user.

## Engineering Guardrails

- Do not switch package manager (Bun) or lint/format stack (OXlint/OXfmt)
- Prefer adding/adjusting tests when behavior changes
- Run targeted tests first, then broader suites when needed
- Avoid destructive git commands and do not revert unrelated local changes
