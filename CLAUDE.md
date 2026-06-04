# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🧭 North Star — Read This First

**[docs/vision.md](docs/vision.md) is the project's north-star vision document. ALWAYS read it before building, designing, or reviewing a feature.**

It defines what Alcoves is, who it's for, what it explicitly is and is NOT, and
the guiding principles every change must honor (privacy-first / CPU-only local
inference, owner-gated control, async-by-default heavy work, graceful
degradation, self-hosted-for-a-bounded-trusted-group). Before you build
anything, confirm it aligns with the vision's pillars and passes its
"how to use this as a compass" checklist. **If a change conflicts with
[docs/vision.md](docs/vision.md), stop and surface the conflict instead of
shipping it.** The vision document is the tie-breaker for any product decision.

## Feature & Technical Documentation

Each distinct subsystem has a dedicated product + technical doc in `docs/`.
**When working on a subsystem, read its doc first** to align with the existing
product intent and architecture before changing code — then update the doc in
the same change if behavior shifts. These docs are derived from the codebase
and meant to keep what you build consistent with the project vision.

**Feature documentation** (what the product does, end to end):

- [Authentication & Sessions](docs/authentication-and-sessions.md) — Registration, login, OAuth, session cookies, profile, and avatars.
- [Libraries, Roles & Access Control](docs/libraries-and-access-control.md) — Library CRUD, owner/admin/viewer roles, invites, and the access-control model.
- [Files, Folders, Tags & Resumable Uploads](docs/files-folders-and-uploads.md) — File/folder CRUD, trash/restore/purge, tagging, dedup, and TUS uploads.
- [AI: Face Recognition & Object Detection](docs/face-and-object-detection.md) — Face detection/clustering into people and YOLO object labeling.
- [AI: Audio Event Detection & Speech Transcription](docs/audio-detection-and-transcription.md) — AudioSet tagging and whisper.cpp transcription with admin-selectable models.
- [Video Editor, Moments & Highlight Filters](docs/video-editor-and-moments.md) — Timeline editor, moment clips, export, and word/sound highlight filters.
- [Public Moment Sharing](docs/moment-sharing.md) — Public share links for moment clips with OG/Twitter embeds and SSR landing.
- [Search, Activity Feed & Notifications](docs/search-activity-and-notifications.md) — Cross-library search and the real-time activity/notification system.
- [Admin Panel & Async Job Queue](docs/admin-and-job-queue.md) — Owner-gated admin stats, settings, ML-model selection, and the Asynq job dashboard.
- [MCP Server (Model Context Protocol)](docs/mcp-server.md) — Tools, stdio + HTTP transports, personal access tokens, and the large-file (signed curl URL / tus) model.

**Technical documentation** (how the system is built):

- [Media Processing: Image Proxy, Video Proxy, Thumbnails & Waveforms](docs/media-processing-pipeline.md) — On-demand image transforms, video transcoding, thumbnails, and audio waveforms.
- [Storage Backends (Local & S3)](docs/storage-backends.md) — Pluggable blob storage: scopes, key routing, range reads, and cache lifecycle.
- [Backend Architecture (Go / Echo / GORM / Asynq)](docs/backend-architecture.md) — Server bootstrap, modes, route registration, middleware chain, and config.
- [Database Schema & Migrations](docs/database-schema-and-migrations.md) — GORM models, Goose migrations, pgvector/HNSW, soft-delete and job-state patterns.
- [Frontend Architecture (Nuxt 4)](docs/frontend-architecture.md) — Nuxt SSR topology, isomorphic fetch, layouts, middleware, and the typed API client.
- [ML Models & Runtime Inference](docs/ml-models-and-runtime-inference.md) — The CPU-only ONNX/whisper model stack, on-demand download, and runtime selection.
- [Deployment & Operations (Docker, Helm, CI/CD)](docs/deployment-and-operations.md) — Docker images, compose, the Helm chart, CI pipelines, and release-please.

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
- **`vue-router` mocks do NOT intercept Nuxt's auto-imported `useRoute`/`useRouter`** — Nuxt re-exports them from `#app/composables/router`, which is what the source code resolves to. See "Test discipline" → "Frontend mocking gotchas" below.

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

## Git commit authorship

- Commits are authored by the human (the configured `user.name` /
  `user.email`). Do **not** add `Co-Authored-By: Claude …` trailers or
  any other AI attribution to commit messages. Don't append generator
  footers either (e.g. "🤖 Generated with Claude Code"). The commit
  message is the message — nothing else.

## Versioning

Alcoves is **alpha**. Releases are automated by **release-please** —
do NOT manually edit `/VERSION`, `/CHANGELOG.md`, or `helm/alcoves/Chart.yaml`
versions in feature PRs. The plain-text `/VERSION` file at the repo root
remains the single source of truth at runtime; release-please owns updating it.

**How releases happen:**

1. Land feature PRs to `main` using **Conventional Commit** subjects:
   `feat(scope):`, `fix(scope):`, `perf(scope):`, `refactor(scope):`,
   `docs(scope):`, `test(scope):`, `build(scope):`, `ci(scope):`,
   `chore(scope):`. The CC type drives both the version bump and the
   CHANGELOG section the entry lands in (see `release-please-config.json`).
2. `release-please.yml` runs on each push to `main` and opens (or updates) a
   single Release PR titled `chore(main): release 0.x.y`. The PR diff:
   `VERSION`, `helm/alcoves/Chart.yaml`, `.release-please-manifest.json`,
   `CHANGELOG.md`.
3. Review the Release PR. You can hand-edit the auto-generated CHANGELOG
   section before merging if you want richer entries than the commit
   subjects alone provide.
4. Merge the Release PR. release-please then creates the annotated `v0.x.y`
   tag + a GitHub Release; the existing `publish.yml` builds Docker images
   tagged `0.x.y` and `0.x` from that tag.

**Bump policy** (encoded in `release-please-config.json`):

- `feat:` → minor (`0.x.0`)
- `fix:` / `perf:` / `refactor:` / `docs:` / `test:` / `build:` / `ci:` →
  patch (`0.x.y+1`)
- `chore:` / `style:` are hidden — they don't appear in the CHANGELOG and
  don't open a Release PR by themselves
- `feat!` or `BREAKING CHANGE:` footer → still minor while pre-1.0
  (`bump-patch-for-minor-pre-major: false` keeps us inside `0.x.y`)
- **Never bumps to `1.0.0`.** Cap at `0.x.y` indefinitely until an explicit
  decision; remove `bump-minor-pre-major: true` only with sign-off.

**Forcing a specific version** (rare): add `Release-As: 0.19.0` as a
commit footer. release-please will use that version for the next release.

**Verifying the embedded version:**

The backend reads `appVersion` from ldflags at build time
(`backend/internal/version/version.go`). After a fresh build, `curl
localhost:3001/api/version` should return `{"version":"0.x.y", ...}`. Local
`go run` returns `"version":"dev"` because ldflags are not set. CI passes
`APP_VERSION=$(cat VERSION)` as a docker build-arg — see
`.github/workflows/publish.yml`.

## Test discipline (REQUIRED for every code change)

These rules are non-optional. Skipping them is what produced the multi-month
test rot we just spent a session unwinding.

**Before merging any feature, refactor, or bug fix:**

1. **Run the targeted suite first.** If you changed `frontend/app/`, run
   `bun run test:unit -- <changed file paths>` and the matching e2e file in
   `frontend/test/e2e/flows/` if one exists. If you changed `backend/`, run
   `go test ./internal/<changed package>/...`. Don't claim done before this.
2. **Then run the full suite for the side you touched.** Frontend:
   `bun run typecheck && bun run lint && bun run test:unit && bunx playwright test`. Backend:
   `go test ./... -race -count=1`. All four steps must exit 0 (frontend) /
   `go test` must be green (backend).
3. **If a test fails, fix it before merge.** Two valid outcomes:
   - The test caught a real regression → fix the source.
   - The test was wrong (asserting against an outdated UI/API contract) →
     update or delete the test in the same PR. **Never commit while ignoring
     a failure.** "Pre-existing failure, not mine" is how the suite rotted to
     104 failures. The rule: if it failed during your run and you didn't
     touch it, you still own quieting it (fix, update, delete, or `it.skip`
     with a comment + a `docs/todos.md` entry).
4. **If you skip a test, leave a paper trail.** Use `it.skip` with a comment
   that says *why* and links to a `docs/todos.md` line. Never silently
   delete coverage — either keep + skip, or delete with the rationale in the
   commit message.
5. **Add tests for new behavior.** New composable, handler, util, or branch
   gets a test in the same PR. The bar is "would a future regression be
   caught?" — if no, write one.
6. **For UI/frontend changes, also exercise the feature in a browser.**
   Type-check + tests verify code correctness, not feature correctness. See
   the "doing tasks" guidance — start `bun run dev`, click the golden path
   and a couple of edge cases, watch for unrelated regressions before
   reporting done.

**Frontend mocking gotchas (read before writing a new test):**

- `useRoute` and `useRouter` auto-import from `#app/composables/router`,
  not `vue-router`. Mocking `vue-router` alone does **not** intercept Nuxt's
  auto-imports. Tests that need to control route data either (a) avoid
  `useRoute`-dependent code paths, or (b) wait for the project to adopt a
  proper Nuxt route mount helper (tracked in `docs/todos.md` item 9).
- When mocking `vue-router`, always spread `await importOriginal()` —
  partial mocks break Nuxt plugins that need `createWebHistory` /
  `router.beforeEach` / etc.
- When mocking `~/utils/api-fetch`, return `apiUrl` and `ApiError` along
  with `apiFetch` — multiple components import `apiUrl` and several use
  `ApiError` for type narrowing. Missing exports surface as opaque vitest
  module errors.
- When mocking `~/composables/useAuth`, always include `{ loggedIn,
  user, fetchSession }` (the shape `auth.global.ts` middleware destructures
  on every page mount). Returning a partial shape crashes the middleware
  during app init.
- `localStorage`, `sessionStorage`, `navigator.clipboard`, and `<NuxtLayout>`
  are stubbed in `test/setup.ts` — don't re-stub them per file.

**Coverage:**

- Frontend coverage thresholds live in `frontend/vitest.config.ts`. If they
  trip, the CI run reports it but the suite still passes — they're a
  signal, not a gate. If you raise them, raise them as part of the same PR
  that lifts coverage so subsequent PRs aren't blocked.
- Backend per-package coverage shows up in `go test ./... -cover`. Treat
  any package at `0.0%` with non-test source as a known gap (catalogued in
  `docs/todos.md` item 9).
