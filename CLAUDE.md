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

The user-facing product and developer documentation lives in the documentation
site under `website/src/content/docs/` (Astro + Starlight, published to
[alcoves.io](https://alcoves.io)). **When working on a subsystem, read its page
first** to align with the existing product intent and architecture before
changing code — then update that page in the same change if behavior shifts.

**Feature documentation** (`website/src/content/docs/features/`, what the product does):

- [Authentication & Sessions](website/src/content/docs/features/authentication-and-sessions.md) — Registration, login, OAuth, session cookies, profile, and avatars.
- [Libraries, Roles & Access Control](website/src/content/docs/features/libraries-and-access-control.md) — Library CRUD, owner/admin/viewer roles, invites, and the access-control model.
- [Files, Folders, Tags & Resumable Uploads](website/src/content/docs/features/files-folders-and-uploads.md) — File/folder CRUD, trash/restore/purge, tagging, dedup, and TUS uploads.
- [AI: Face Recognition & Object Detection](website/src/content/docs/features/face-and-object-detection.md) — Face detection/clustering into people and YOLO object labeling.
- [AI: Audio Event Detection & Speech Transcription](website/src/content/docs/features/audio-detection-and-transcription.md) — AudioSet tagging and whisper.cpp transcription with admin-selectable models.
- [Video Editor, Moments & Highlight Filters](website/src/content/docs/features/video-editor-and-moments.md) — Timeline editor, moment clips, export, and word/sound highlight filters.
- [Public Moment Sharing](website/src/content/docs/features/moment-sharing.md) — Public share links for moment clips with OG/Twitter embeds and SSR landing.
- [Search, Activity Feed & Notifications](website/src/content/docs/features/search-activity-notifications.md) — Cross-library search and the real-time activity/notification system.
- [Admin Panel & Async Job Queue](website/src/content/docs/features/admin-and-job-queue.md) — Owner-gated admin stats, settings, ML-model selection, and the Asynq job dashboard.
- [MCP Server (Model Context Protocol)](website/src/content/docs/features/mcp-server.md) — Tools, stdio + HTTP transports, personal access tokens, and the large-file (signed curl URL / tus) model.

**Technical documentation** (`website/src/content/docs/architecture/` + `self-hosting/`, how the system is built):

- [Media Processing: Image Proxy, Video Proxy, Thumbnails & Waveforms](website/src/content/docs/architecture/media-processing-pipeline.md) — On-demand image transforms, video transcoding, thumbnails, and audio waveforms.
- [Storage Backends (Local & S3)](website/src/content/docs/architecture/storage-backends.md) — Pluggable blob storage: scopes, key routing, range reads, and cache lifecycle.
- [Backend Architecture (Go / Echo / GORM / Asynq)](website/src/content/docs/architecture/backend-architecture-go.md) — Server bootstrap, modes, route registration, middleware chain, and config.
- [Database Schema & Migrations](website/src/content/docs/architecture/database-schema-and-migrations.md) — GORM models, Goose migrations, pgvector/HNSW, soft-delete and job-state patterns.
- [Frontend Architecture (SvelteKit)](website/src/content/docs/architecture/frontend-architecture.md) — SSR topology, route groups, auth via hooks, the `createApi` client + in-process `/api` proxy, Svelte 5 rune stores, Skeleton UI, and adapter-node deployment.
- [ML Models & Runtime Inference](website/src/content/docs/architecture/ml-models-runtime.md) — The CPU-only ONNX/whisper model stack, on-demand download, and runtime selection.
- [Deployment & Operations (Docker, Helm, CI/CD)](website/src/content/docs/self-hosting/deploying-alcoves.md) — Docker images, compose, the Helm chart, CI pipelines, and release-please.

**Internal documentation** (`docs/internal/`, maintainer-only — not published): ML
model evaluation/publishing notes and the engineering TODO list. See
[`docs/internal/README.md`](docs/internal/README.md).

## Project Summary

Alcoves is a self-hosted collaborative file library with a SvelteKit (Svelte 5) frontend and a Go API backend.

- **Frontend** (`client/`): SvelteKit + Svelte 5 (runes) + Skeleton UI v4 (cerberus theme, class-based dark via a `@custom-variant`) + Tailwind 4 (CSS-first, `src/app.css`), built with `adapter-node` and run under Bun (`bun /app/build/index.js`). SvelteKit's **default SSR + hydration** is on for the whole app — server `load`/`hooks.server.ts` fetch the **Go API** (never the DB) and forward the session cookie. `/s/[token]` public moment-share pages SSR for OG/SEO meta. A pre-hydration form guard in `app.html` blocks native `<form>` submits during the SSR→hydration window.
- **Backend** (`backend/`): Go (1.26) API server — Echo, GORM, PostgreSQL 18 + pgvector.
  - Session auth with AES-GCM encrypted cookies; PAT (Bearer) auth for MCP.
  - Local file/avatar/cache storage (S3 config exists but is **not yet wired in `main.go`** — see Known Gaps).
  - Async job queue (Asynq + Dragonfly/Redis) for hashing, metadata, thumbnails, waveforms, face/object/audio detection, transcription, and video transcoding.
  - CPU-only ONNX/whisper.cpp inference; models download on demand.
- The Go binary is **pure API** — it no longer embeds or serves the frontend.

**Deploy topology**: SvelteKit (adapter-node) server on **:3000** (UI + SSR) + Go API on **:3001** (`/api/**`). The SvelteKit server proxies same-origin `/api/**` to the co-located Go API (in-process catch-all route `src/routes/api/[...path]/+server.ts`); in dev the docker-compose `frontend` service points `INTERNAL_API_URL` at the backend. In prod both sit behind one reverse proxy, and `PUBLIC_API_ORIGIN` lets browsers stream binaries (and the activity WebSocket) directly from the API, bypassing the proxy.

**Production image**: a single unified image (root `Dockerfile`, published as `ghcr.io/rustyguts/alcoves`) bundles the Go API/worker binary, a stdio MCP binary (`/alcoves-mcp`), and the SvelteKit frontend (adapter-node `build/` + its pruned production `node_modules`, run via a copied Bun binary as `bun /app/build/index.js`). Its entrypoint (`docker/entrypoint.sh`) supervises both processes; a role arg (`all` default | `web` | `api` | `worker`) lets the same image run the whole stack or one role. `tini` is PID 1; unknown role → exit 64. The Helm chart's three workloads (`frontend`/`api`/`worker`) all pull this one image and set `args` to pick a role. Dev uses the two-service `docker-compose.yml` with `client/Dockerfile.dev` (Vite dev server, hot reload) — only production packaging is unified.

## Core Commands

### Frontend (run from `client/` directory)

- `bun install` — install deps (`bun.lock`); `prepare` runs `svelte-kit sync` to generate `.svelte-kit/` types
- `bun run dev` — Start the Vite dev server (SvelteKit) on :3000; same-origin `/api/**` is proxied to `INTERNAL_API_URL` (the Go backend)
- `bun run build` — Build the production server with `adapter-node` (writes `build/`)
- `bun run preview` — Serve the built app (`vite preview`)
- `bun run typecheck` — `svelte-kit sync && svelte-check` (also aliased as `check`)
- `bun run lint` — `prettier --check . && eslint .`
- `bun run fmt` / `bun run fmt:check` — Prettier write / check (100-char, tabs; `prettier-plugin-svelte` + `-tailwindcss`)
- `bun run test:unit` — Vitest run once (both `server` + `client` projects — see Testing Conventions)
- `bun run test:unit:coverage` — Unit tests with V8 coverage (writes `coverage/`)
- `bun run coverage:floor` — Enforce the per-file 60% floor (`scripts/coverage-floor.mjs`, reads `coverage/coverage-summary.json`)
- `bun run test:e2e` — Playwright e2e (`playwright test`) against a **real running stack** (see Testing Conventions)
- `bun run test` — `vitest run` then `playwright test`

Run a single unit test file or pattern:
```bash
bun run test:unit src/lib/api/fetch.test.ts          # one server-project file
bun run test:unit src/lib/components/ui/AppIcon.svelte.test.ts   # one client-project (browser) file
bun run test:unit -- -t "pattern"
```

### Backend (run from `backend/` directory)

```bash
go run cmd/server/main.go              # Start server (version reports "dev" — no ldflags)
air                                     # Hot reload (reads .air.toml; builds with -tags dev)
go build -o bin/alcoves cmd/server/main.go   # Build binary
go test ./...                           # All tests
go test ./... -race -count=1            # Race detector (CI standard)
go test ./internal/handlers/... -v      # Verbose package run
go test ./internal/handlers/... -run TestFunctionName   # Single test
go test ./... -cover                    # Coverage summary
```

Module: `github.com/alcoves/alcoves-backend`. Production builds inject version via ldflags into `internal/version` (`commit`, `buildTime`, `appVersion`); CI passes `APP_VERSION=$(cat VERSION)` as a docker build-arg.

### Docker (local development)

```bash
docker compose up                       # postgres + dragonfly + backend (Air) + frontend (SvelteKit Vite dev)
docker compose up -d postgres dragonfly # Infrastructure only
docker compose down -v                  # Drop the postgres_data volume (full reset, re-seeds)
```

Ports: frontend :3000, backend :3001, postgres :5432, **Dragonfly published on host :6389 → container :6379**. The backend service sets `ALCOVES_QUEUE_PORT=6379` (in-container); the config default when the env var is absent is `6389`. The frontend container (`client/Dockerfile.dev`) sets `INTERNAL_API_URL=http://backend:3001`; the named `client_node_modules` volume plus anonymous volumes over `/app/.svelte-kit` and `/app/build` keep host-side build artifacts from leaking in.

## Local Dev Seed Data (`backend/internal/seed`)

`docker compose up` against an **empty** database auto-loads a rich, representative
data set so you can log in immediately and exercise every feature with real
content. **Log in with `test@alcoves.io` / `password123`** (an owner/admin).
Other seeded logins: `alice@alcoves.io`, `bob@alcoves.io` (both `password123`).
Dev PAT: `alc_pat_localdev0000000000000000000000000000`.

- **What's seeded:** 3 users (admin + two members for collaboration), 5 libraries
  (Family Photos, Travel 2025, Podcast Recordings, Alice's, Bob's — with member
  roles and face/object/sharing flags), nested folders, real image / video /
  audio files, tags, people + face crops, object detections, EXIF/GPS metadata
  (Timeline + Map), transcripts, audio-event detections, waveforms, moments, a
  **public moment share** (`token="devseedshare01"`), highlight filters, the
  activity feed, app settings, and a dev personal access token.
- **The media files are real**, committed under `backend/internal/seed/assets/`
  (`images/`, `videos/`, `audio/`, `thumbs/`, `faces/`) and embedded via
  `go:embed`. Regenerate with `assets/generate.sh` (ImageMagick + ffmpeg +
  cwebp). They are labeled placeholders, not real photos.
- **Gating — this matters:** `MaybeRun` seeds **only** when ALL hold:
  `ALCOVES_SEED=true` (set in `docker-compose.yml`; never in real deployments),
  `ALCOVES_MODE != worker`, `ALCOVES_ENV != production`, and the DB has **zero
  users** (serialized across replicas via a Postgres advisory lock). A populated
  DB — a real deployment or an already-seeded dev DB — is left untouched, so a
  **real owner's first-time setup is never affected**. Safe on every boot; a
  no-op after the first run.
- **Tests reuse it:** `seed.Run(db, storage)` is exported; `seed_test.go`
  (`TestRun` + `TestMaybeRunGating`) runs it against an isolated schema + temp
  storage and asserts minimum counts to guard against accidental shrinkage.

> [!IMPORTANT]
> **Keep the seed relevant to features.** When you add or change a user-facing
> feature, extend the seeder in the same change so the feature has representative
> data here (a new model → seed a few rows; a new view → seed what it renders).
> The bar: after `docker compose up`, logging in as `test@alcoves.io` should show
> realistic content for **every** shipped feature. A feature with no seed data is
> invisible in local dev and untested by the seed test — treat that as a gap.

## Architecture Notes

### Backend (`backend/`)

- Entry point: `backend/cmd/server/main.go`; stdio MCP server entry: `backend/cmd/mcp`.
- Bootstrap order: `config.Load()` (fails fast if `ALCOVES_SESSION_SECRET` unset) → optional Sentry → `database.Connect()` (GORM) → `database.RunMigrations()` (Goose, **applied on every boot**) → service graph → `seed.MaybeRun()` → Asynq client + Inspector → Redis pub/sub activity bus → Activity Hub (non-`worker` modes only) → ONNX pre-download + Asynq server + maintenance loops (`all`/`worker` only) → Echo server (graceful 10s shutdown on SIGINT).

**`ALCOVES_MODE`:**

| Mode | HTTP server | Asynq worker | Notes |
|------|-------------|--------------|-------|
| `all` (default) | yes | yes | Single-process full stack |
| `api` | yes | no | API only; no background jobs |
| `worker` | health + version only | yes | No API routes besides `/api/health`, `/api/version` |

**Echo middleware chain (order matters):** `Logger` → `sentryhttp` (if DSN set) → custom `HTTPErrorHandler` (Sentry, if enabled) → `Recover` → CORS (explicit origin allowlist; `AllowCredentials: true`; exposes TUS + byte-range headers) → `AuthMiddleware` (AES-GCM session cookie **or** `Authorization: Bearer <PAT>`; skips public paths) → `LibraryAccessMiddleware` (on `/api/libraries/:id/*`: read → viewer+, write → admin+).

**`internal/` layout:**

- `config` — `Config` + `Load()`, all env parsing with defaults
- `database` — `Connect()` (GORM), `RunMigrations()` (Goose embedded FS)
- `handlers` — HTTP handlers, one file per resource; `validator.go` wraps go-playground/validator
- `middleware` — `AuthMiddleware`, `LibraryAccessMiddleware`
- `models` — all GORM entities in a single `models.go`
- `mcpserver` — `*mcp.Server` with the v1 tool set (22 tools: discovery/libraries, files/folders, tags, AI insights, moments — see `website/.../features/mcp-server.md`) + per-request identity bridge
- `queues` — named Asynq queue constants + `Priorities` weight map (single source of truth)
- `queuerouting` — **tests-only** regression guard pinning service→queue routing (no prod code)
- `seed` — dev/test data seeder (`MaybeRun`/`Run`)
- `services/` — all business logic (below)
- `testsupport` — shared test helpers (`db.go` in-memory DB, `mlfixtures.go`, `onnxtest/`, `testdata/`)
- `version` — `App()`, `Commit()`, `BuildTime()`, `Dirty()` (ldflags → `debug.ReadBuildInfo()` fallback)

**Services (`internal/services/`) — full list (19 packages):**

| Package | Responsibility |
|---------|----------------|
| `access` | Library membership checks; `RequireLibraryAccess` / `RequireLibraryAdmin`; sets `LibraryAccess` context value |
| `activity` | Activity log + notifications: `Service.Emit()` inserts rows; `Hub` fans out over WebSocket; `Bus` is the cross-process Redis pub/sub bridge |
| `audiodetection` | AudioSet 527-class ONNX tagging; admin-selectable model from `Registry` (default `efficientat_mn10`); enqueues `file:audio-detect` |
| `auth` | AES-GCM session cookies; bcrypt passwords; PAT minting (SHA-256 stored) + `ValidateMCPToken()` |
| `avatarproc` | Avatar resize/crop/webp via govips |
| `facedetection` | SCRFD `det_10g` (detect) + ArcFace `w600k_r50` (512-dim embed); pgvector cosine ANN clustering; enqueues `face:detect` |
| `filehash` | SHA-256 content hashing for dedup; enqueues `file:hash` |
| `files` | File listing, timeline, map queries; `ingest.go` `ServiceWithIngest` chains all post-upload processing |
| `imageproxy` | On-demand transforms via govips; 5 named variants; Redis pub/sub cache coalescing; `PrewarmService`; enqueues `image:proxy` + `image:prewarm` |
| `invites` | Invite link redemption (validate token, create `LibraryMember`, bump `UseCount`) |
| `metadata` | EXIF/GPS (goexif) for images + ffprobe for video; backfill maintenance loop; enqueues `file:metadata` |
| `momentexport` | ffmpeg clip encode for moment export; enqueues `moment:export` |
| `objectdetection` | YOLO26x FP16 ONNX (in `pixel_values`; out `logits`,`pred_boxes`); enqueues `object:detect` |
| `settings` | Single-row `app_settings` JSONB; `RegistrationMode`, `WhisperModel`, `AudioDetectModel`, etc.; lets workers honor admin changes without restart |
| `signing` | HMAC signed-URL minting/validation for MCP curl upload/download (falls back to `ALCOVES_SESSION_SECRET`) |
| `storage` | Pluggable `Driver` interface; `LocalDriver` + S3 driver; scopes `files`/`avatars`/`cache`. **`main.go` constructs `NewLocalDriver()` unconditionally** |
| `transcribe` | whisper.cpp (`whisper-cli`) subprocess + Silero VAD; admin-selectable model allow-list; enqueues `file:transcribe` |
| `videoproxy` | ffmpeg transcode + poster-frame; DB-tracked progress/ETA; enqueues `video:proxy` + `video:thumbnail` |
| `waveform` | ffmpeg PCM extraction + peak windowing; enqueues `file:waveform` |

(Plus `mcpserver` and `signing` integrate with handlers `signed.go` / `/api/mcp`.)

**Route groups (registered in `main.go`):**

| Prefix | Purpose / handler |
|--------|-------------------|
| `/api/health` · `/api/version` | Inline; always registered (all modes) |
| `/api/auth/*` · `/api/_auth/session` | Auth, sessions, avatars, PATs, Google OAuth (`auth.go`, `avatar.go`, `tokens.go`, `oauth.go`) |
| `/api/libraries` | Library CRUD (`library.go`) |
| `/api/libraries/:id/*` | Files, folders, tags, highlight-filters, moments + shares, members + invites, people, objects, downloads, timeline/map, library feed (`file.go`, `folder.go`, `tag.go`, `highlight_filter.go`, `moment.go`, `moment_share.go`, `member.go`, `people.go`, `objects.go`, `download.go`, `notifications.go`) |
| `/api/notifications` · `/api/ws` | Global notification feed + dismissals + WebSocket (`notifications.go`) |
| `/api/invites/:token` | Lookup (GET, public) + Accept (POST, auth in handler) |
| `/api/search` | Cross-library search |
| `/api/admin/*` | Owner-gated: stats, users, settings, backfill, Asynq job dashboard (list/purge/control/SSE stream) (`admin.go`, `admin_jobs.go`) |
| `/api/_meta/registration-mode` | Public; returns `{mode: open\|invite_only\|closed}` |
| `/api/tus` | TUS v1.0 resumable upload (`tus.go`) |
| `/api/files/proxy/*` | On-demand image transform / video proxy (`download.go`) |
| `/api/files/signed` · `/api/files/upload-signed` | Signed MCP curl download / upload (`signed.go`; public) |
| `/api/mcp` | MCP HTTP transport (gated by `ALCOVES_MCP_HTTP_ENABLED`) |
| `/api/share/:token` · `/share/:token/video` · `/thumbnail` | Public moment share metadata + stream + thumbnail (no auth) (`share.go`) |

**Models & migrations:** All GORM entities live in one file `internal/models/models.go`, UUID PKs with `BeforeCreate` generation. **No GORM soft-delete** — soft-delete is a nullable `TrashedAt *time.Time` on `File`/`Folder`/`Moment`, filtered manually. File sizes are `bigint`. Each async job type on `File` carries a `_status`/`_error`/`_version` + last-completed `_*ed_version` column set; a version mismatch triggers re-run (metadata + image_proxy use a 3-strike `_attempts` cap). Face embeddings are `vector(512)` (pgvector). Migrations are Goose SQL in `backend/migrations/` (`00001`→`00022`), embedded via `embed.go`, applied with `provider.Up()`; `00019` builds the HNSW `vector_cosine_ops` index (`m=16, ef_construction=64`, `CONCURRENTLY`/`NO TRANSACTION`).

**Async queue (Asynq + Dragonfly):** named queues with weighted-random scheduling, worker concurrency 8. Queue constants + weights in `internal/queues`: `imageproxy` (100), `metadata` (70), `thumbnail` (65), `hash` (60), `default` (50), `moment-export` (45), `waveform` (40), `object-detection` (30), `face-detection` (30), `audio-detection` (25), `video-transcode` (10), `transcription` (5), `maintenance` (1). Task types: `image:proxy`, `image:prewarm`, `file:metadata`, `video:thumbnail`, `file:hash`, `moment:export`, `file:waveform`, `object:detect`, `face:detect`, `file:audio-detect`, `video:proxy`, `file:transcribe`.

**ML / inference (CPU-only ONNX + whisper.cpp):**

- **Faces:** SCRFD `det_10g.onnx` + ArcFace `w600k_r50.onnx`; clustering via pgvector cosine ANN. ONNX init once via `sync.Once` (`onnxruntime_go`).
- **Objects:** YOLO26x FP16 `yolo26x_fp16.onnx` (640×640 input).
- **Audio:** model registry of 7; 2 available (`efficientat_mn10` default, `pann_cnn14`); the other 5 (`efficientat_mn04/mn40`, `ced_tiny/small/base`) are catalogued `Available: false` and silently fall back to the default. Admin-selectable via settings.
- **Transcription:** whisper.cpp `whisper-cli` + Silero VAD; 9-model allow-list (`tiny`→`large-v3` + quants), language defaults `auto`.
- **Images:** govips; 5 variants — `search` (80², jpeg), `timeline` (240², webp), `face` (300², jpeg), `card` (720×360, jpeg), `preview` (1920×1080, jpeg); `VariantsVersion` bump triggers prewarm.
- Models download on demand from `https://s3.rustyguts.net/models` (configurable) with retry + minimum-size validation.

**Storage:** `Driver` interface (`EnsureReady`, `PutBuffer`/`PutStream`, `OpenReadStream` w/ `ByteRange`, `ReadBuffer`, `Exists`, `Stat`, `DeletePrefix`). Three scopes: `files` (`{libraryId}/{fileId}/blob`), `avatars` (`{userId}/avatar.webp`), `cache`. `LocalDriver` exposes `LocalFilePath()` so ffprobe/ffmpeg read on-disk without temp copies.

### Frontend (`client/`)

- SvelteKit + Svelte 5 (runes mode forced for non-`node_modules` files in `svelte.config.js`) + Skeleton UI v4 + Tailwind 4 + Bun. `adapter-node` with `envPrefix: 'FRONTEND_'` so the Node/Bun server reads `FRONTEND_HOST`/`FRONTEND_PORT`/etc. and never collides with the Go API's `PORT` in the unified `all` role. Tailwind + Skeleton are configured CSS-first in `src/app.css` (`@import 'tailwindcss'` + `@skeletonlabs/skeleton` + the `cerberus` theme; no `tailwind.config`). `vite.config.ts` wires `@tailwindcss/vite` + `sveltekit()` (and the Vitest config — see Testing Conventions).
- **Rendering / SSR:** SvelteKit default SSR + hydration for the whole app. `app.html` carries a pre-paint theme bootstrap (reads `localStorage` key `alcoves.theme`, toggles the `.dark` class) and a pre-hydration form guard (blocks native `<form>` submits until `window.__alcovesReady`).
- **`src/routes/` route groups** (file-based; dynamic segments `[id]`, `[token]`, `[fileId]`, `[personId]`, catch-all `[...path]`):
  - `(app)/` — authed dashboard group. `(app)/+layout.server.ts` redirects anonymous users → `/login?redirect=…` and loads the sidebar libraries list (degrades to `[]` on failure); `(app)/+layout.svelte` is the shell (sidebar, search, notifications, avatar menu). Sub-routes: `libraries/[id]` (browser; `trash/` sibling) + `feed`, `map`, `objects`, `tags`, `timeline`, `settings`, `people/[personId]`, `edit/[fileId]` (video editor); plus `notifications`, `profile`, `search`, and owner-only `admin/` + `admin/jobs/` (gated by `(app)/admin/+layout.server.ts`, which redirects non-`owner` → `/`).
  - Public routes (outside the group): `login`, `register`, `invites/[token]`, and `s/[token]` (public moment share landing — `+page.server.ts` SSRs OG/SEO meta).
  - `api/[...path]/+server.ts` — in-process catch-all proxy (below).
- **`hooks.server.ts`:** `handle` resolves `event.locals.user` for app navigations by calling the Go API's `GET /api/_auth/session` (never 401s; a backend hiccup returns `null` instead of 500ing the page) — skipped for `/api/*` paths. `handleFetch` rewrites same-origin `/api/*` fetches made in server `load`/actions to `INTERNAL_API_URL`, forwarding the session `cookie` plus `X-Forwarded-Host`/`-Proto` (the proto/host are load-bearing: backend `share.go` builds absolute OG/share URLs from the forwarded host). `hooks.client.ts` just logs client errors (Sentry is a later phase).
- **`src/routes/api/[...path]/+server.ts`** — in-process catch-all proxy (browser → SvelteKit → co-located Go API) that streams bodies both ways and passes status/headers verbatim so Range (206), ETag, TUS, and `Set-Cookie` all work (`duplex: 'half'` for streamed PATCH bodies). Binary GETs and the activity WebSocket can bypass it via `PUBLIC_API_ORIGIN`; in single-port unified mode (no `PUBLIC_API_ORIGIN`) the notifications socket degrades to its poll fallback (the WS works directly via a k8s ingress or `PUBLIC_API_ORIGIN`).
- **`src/lib/api/`** — `createApi(fetch)` factory (`client.ts`, 15 namespaces: `auth`, `libraries`, `files`, `folders`, `tags`, `highlightFilters`, `members`, `people`, `objects`, `downloads`, `search`, `invites`, `admin`, `moments`, `meta`). Server `load` passes `event.fetch`; the browser uses the `api` singleton (`index.ts`, bound to global `fetch`). `fetch.ts` is the isomorphic `apiFetch` + `ApiError` (`.status`/`.data`); `url.ts` resolves data-vs-asset URLs: server keeps `/api/*` relative (so `handleFetch` rewrites + forwards the cookie); browser uses `PUBLIC_API_ORIGIN` when set (direct to Go, avoids Range mangling) else relative through the proxy.
- **`src/lib/state/`** — Svelte 5 rune stores in `*.svelte.ts` files (these replace the old Vue composables): `auth`, `theme`, `toast`, `library-explorer`, `upload-queue` (TUS, `/api/tus`), `libraries-list`, `notifications` + `notifications-socket`, `async-job-status`, plus per-feature stores (`library-people/members/moments/feed/timeline/map/tags/folder-path/folder-actions`, `transcript`/`transcribe-job`, `audio-detections`/`audio-detect-job`, `waveform*`, `highlight-filters`, `editor-highlights`/`editor-shortcuts`, `moment-downloads`, `download-zip`, `file-drop`).
- **`src/lib/components/`** — `ui/` primitives (`AppIcon`, `AppModal`, `AppPanel`/`AppPanelRow`, `AlcovesImage`, `UserAvatar`, `ConfirmModal`, `AuthCardShell`, `OAuthGoogleButton`, `EmojiPicker`) plus feature dirs (`library/`, `editor/`, `admin/`, `notifications/`, `profile/`) and top-level components (`LibraryHeader`, `LibraryBreadcrumb`, `LibrarySwitcher`, `SidebarLibraryNav`, `JustifiedGallery`, `FilePreview`, `TimelineScrubber`, `UploadModal`/`UploadProgress`, `LibraryMap` — Leaflet, browser-only). `src/lib/actions/portal.ts` is a `use:portal` action.
- **`src/lib/shared/`** (`image-variants`, `tag-colors`), **`src/lib/utils/`** (pure helpers — `activity-format`, `justified-layout`, `mime-icons`, `parse-vtt`, `highlight-expression`, `permissions`, `icons`, …), **`src/lib/types/api.ts`** (response types, imported as `$lib/types/api`).
- **Icons:** `@iconify/svelte` rendered fully **offline** — `ui/AppIcon.svelte` calls `addCollection(@iconify-json/lineicons/icons.json)` (privacy-first; no network icon fetch). The `ICONS` registry (`src/lib/utils/icons.ts`) maps names → `lineicons:<glyph>`, validated against the installed set by `icons.test.ts`.
- **Env (SvelteKit):** server-only `INTERNAL_API_URL` (via `$env/dynamic/private`); browser-visible `PUBLIC_*` (`$env/dynamic/public`): `PUBLIC_API_ORIGIN`, `PUBLIC_GOOGLE_AUTH_ENABLED`, `PUBLIC_SENTRY_DSN`, `PUBLIC_MAP_TILE_URL`/`_ATTRIBUTION`. adapter-node runtime: `FRONTEND_HOST`/`FRONTEND_PORT`/`FRONTEND_ORIGIN`/`FRONTEND_PROTOCOL_HEADER`/`FRONTEND_HOST_HEADER`/`FRONTEND_BODY_SIZE_LIMIT` (the last must be unbounded or TUS chunk PATCHes through the proxy are rejected).

### Testing Conventions

**Frontend unit tests** (Vitest, dual `projects` defined in `vite.config.ts` — colocated `*.test.ts` next to source under `client/src/`):
- **`server` project** (`environment: 'node'`, `*.{test,spec}.ts` excluding `*.svelte.*`) — pure logic, hooks, `load` functions, the `/api` proxy, the API client, utils. Route-server tests must NOT use `+`-prefixed filenames (use e.g. `layout.server.test.ts`, `page.server.test.ts`).
- **`client` project** (`browser.enabled`, real **chromium** via `@vitest/browser-playwright` + `vitest-browser-svelte`, `*.svelte.{test,spec}.ts`, excludes `src/lib/server/**`) — components and DOM-touching rune stores. Route-page tests use `page.svelte.test.ts` (never `+page.svelte.test.ts`).
- `$env/dynamic/public` isn't initialized in browser mode, so it's aliased to `vitest/env-public-stub.ts`; tests needing a value mock `$lib/api` directly.
- ~1,600 unit tests total. Coverage: V8, headline thresholds 90% (lines/functions/statements) + 80% branches in `vite.config.ts`; the per-file 60% floor is enforced separately by `scripts/coverage-floor.mjs` (`bun run coverage:floor`). Coverage-excluded (e2e-covered instead): `LibraryMap.svelte`, `editor/VideoEditorPlayer.svelte`, and the two trivial `libraries/*/+page.svelte` / `trash/+page.svelte` passthrough wrappers.

**Frontend E2E** (Playwright, `client/playwright.config.ts`, `client/test/e2e/*.e2e.ts`, sequential `workers: 1`, chromium):
- Runs against the **REAL full stack** — there is **no mock backend**. Local: `docker compose up` (brings up Postgres + Dragonfly + the seeded Go API/worker behind the SvelteKit server), then `bun run test:e2e`. CI brings the stack up via `docker compose` and sets `E2E_BASE_URL` (default `http://localhost:3000`).
- Seed login: `test@alcoves.io` / `password123` (see `backend/internal/seed`). The shared login helper is `client/test/e2e/helpers/auth.ts`.

**Backend tests** (standard `testing`):
- `*_test.go` alongside source; `-run TestName` targets one function; `internal/testsupport` provides shared DB/ML fixtures.

## Environment

**Backend (`ALCOVES_*`):**

- `ALCOVES_MODE` — `all` (default) | `api` | `worker`; `ALCOVES_ENV` — `development` | `production`
- `ALCOVES_DATABASE_URL` (required) — PostgreSQL DSN
- `ALCOVES_SESSION_SECRET` (required) — AES-GCM key, ≥32 bytes
- `ALCOVES_QUEUE_HOST` / `ALCOVES_QUEUE_PORT` (default `6389`; compose uses `6379` in-container) / `ALCOVES_QUEUE_PASSWORD`
- `ALCOVES_BASE_URL` — public URL for OAuth redirects + share/MCP signed links
- `ALCOVES_STORAGE_DRIVER` — `local` (default) | `s3`; `ALCOVES_STORAGE_PATH` / `ALCOVES_AVATAR_STORAGE_PATH` / `ALCOVES_CACHE_STORAGE_PATH` / `ALCOVES_MODELS_PATH` / `ALCOVES_WHISPER_MODELS_DIR`
- S3 (when driver=s3): `ALCOVES_S3_BUCKET`, `_REGION`, `_ENDPOINT`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_FORCE_PATH_STYLE`, `_FILES_PREFIX`/`_AVATARS_PREFIX`/`_CACHE_PREFIX`
- `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` / `_SECRET`
- `ALCOVES_SEED` — `true` loads dev data if DB empty; never set in production
- ML: `ALCOVES_WHISPER_MODEL` (default `large-v3`), `_WHISPER_LANGUAGE` (`auto`), `_WHISPER_VAD_MODEL` (`silero-v6.2.0`; `""` disables), `_WHISPER_MODEL_BASE_URL`, `_AUDIO_DETECT_MODEL_BASE_URL`/`_LABELS_URL`/`_WINDOW_SEC`/`_THRESHOLD`/`_TOP_K`, `_FACE_DETECTION_MIN_SCORE`, `_FACE_RECOGNITION_MAX_DISTANCE`/`_MIN_FACES`/`_NEIGHBOR_LOOKUP`, `_OBJECT_DETECTION_MIN_SCORE`/`_MAX_DETECTIONS`/`_NMS_THRESHOLD`
- MCP: `ALCOVES_MCP_HTTP_ENABLED` (default false), `ALCOVES_MCP_TOKEN` (stdio PAT), `ALCOVES_MCP_SIGNING_SECRET` (falls back to session secret)
- `ALCOVES_IMAGE_PROXY_PREWARM_ENABLED` (default true), `ALCOVES_SENTRY_DSN` / `_TRACES_SAMPLE_RATE`
- `PORT` (Go listen port, default 3001), `LD_LIBRARY_PATH=/usr/local/lib` (required in container for ONNX `dlopen`)

**Frontend (SvelteKit):**

- `INTERNAL_API_URL` — Go backend URL for the `/api/[...path]` proxy + server `load`/`handleFetch` (default `http://localhost:3001`; docker-compose uses `http://backend:3001`); server-only (`$env/dynamic/private`)
- `FRONTEND_HOST` / `FRONTEND_PORT` — adapter-node bind address (default `0.0.0.0:3000`); `FRONTEND_ORIGIN` (required by adapter-node for POST/cookie origin checks unless `FRONTEND_PROTOCOL_HEADER`/`FRONTEND_HOST_HEADER` are set); `FRONTEND_BODY_SIZE_LIMIT` (set to `Infinity` so TUS PATCH chunks aren't rejected). All read via the `FRONTEND_` adapter `envPrefix`.
- `PUBLIC_API_ORIGIN` — public API origin for browser binary streaming + the activity WebSocket (bypasses the SvelteKit proxy); empty = everything same-origin through the proxy
- `PUBLIC_GOOGLE_AUTH_ENABLED`, `PUBLIC_SENTRY_DSN`, `PUBLIC_MAP_TILE_URL`/`_ATTRIBUTION` (browser-visible `$env/dynamic/public`)

See `.env.example` for the full list and defaults.

## Build, Deploy & CI

- **Root `Dockerfile`** — 4 stages: Go build (`golang:1.26-bookworm`, libvips/ffmpeg, ONNX Runtime v1.26.0, builds `/alcoves` + `/alcoves-mcp` with `CGO_ENABLED=1` and version ldflags), whisper.cpp build (`v1.8.4`, hardened x86 baseline `-march=x86-64-v3` / AVX-512 off), SvelteKit client build (`oven/bun:1`, `--frozen-lockfile` → `bun run build` writes `build/`, then `bun install --production` prunes to a lean runtime `node_modules`), and a `debian:bookworm-slim` runtime that copies `build/` + the pruned `node_modules` + `package.json` + a `bun` binary. Env defaults: `ALCOVES_MODE=all`, `FRONTEND_HOST=0.0.0.0`, `FRONTEND_PORT=3000`, `FRONTEND_PROTOCOL_HEADER=x-forwarded-proto`, `FRONTEND_HOST_HEADER=x-forwarded-host`, `FRONTEND_BODY_SIZE_LIMIT=Infinity`, `PORT=3001`, `INTERNAL_API_URL=http://127.0.0.1:3001`. `EXPOSE 3000 3001`; `ENTRYPOINT tini -- /app/entrypoint.sh`; `CMD ["all"]`.
- **`docker/entrypoint.sh`** — role arg `all|web|api|worker`. `web` `exec bun /app/build/index.js` (SvelteKit); `api`/`worker` `exec` the Go binary with `ALCOVES_MODE` set (signals pass through). `all` supervises the Go process AND `bun /app/build/index.js`, `trap`s `TERM`/`INT` to `SIGTERM` both children, `wait -n`, and exits non-zero on any child exit to force orchestrator restart.
- **Helm (`helm/alcoves/`)** — three Deployments off the one image with different `args`: `frontend` (`web`, :3000), `backend-api` (`api`, :3001), `backend-worker` (`worker`, no Service). Single RWX PVC at `/app/data` for `local` storage; chart does NOT deploy Postgres/Dragonfly. Shared backend env from `_envvars.tpl`.
- **CI (`.github/workflows/`)** — `ci.yml`: `backend-test` (`go test -race -count=1 -p 1`, sharded 5 ways — each shard has its own postgres+dragonfly so the shared test DB/queue can't be contended across shards, and `-p 1` stays within a shard; the heavy `internal/handlers` package is split by test name across shards, everything else round-robined by `go list`; whisper.cpp build cached), `unit-and-coverage` (runs in `client/`: `bun run lint` + `typecheck` + `test:unit:coverage` + `coverage:floor`; installs the chromium Playwright browser because the `client` vitest project runs component tests in real chromium), `e2e` (Playwright against the **REAL full stack** — `docker compose up -d --build --wait` brings up Postgres + Dragonfly + the seeded Go API/worker behind the SvelteKit server, then `bunx playwright test` with `E2E_BASE_URL=http://localhost:3000`; **no mock backend**, chromium cached). `build-images.yml` (reusable) builds + pushes to GHCR. `publish.yml` calls it on push/tags/release. `release-please.yml` runs release-please and, on release, re-publishes `X.Y.Z`/`X.Y` tags. `website.yml` builds + deploys the Starlight site.

## Versioning

Alcoves is **alpha**. Releases are automated by **release-please** — do NOT manually edit `/VERSION`, `/CHANGELOG.md`, or `helm/alcoves/Chart.yaml` versions in feature PRs. The plain-text `/VERSION` file is the single runtime source of truth; release-please owns updating it (and `helm/alcoves/Chart.yaml` via `extra-files`).

**How releases happen:**

1. Land feature PRs to `main` with **Conventional Commit** subjects: `feat(scope):`, `fix(scope):`, `perf(scope):`, `refactor(scope):`, `docs(scope):`, `test(scope):`, `build(scope):`, `ci(scope):`, `chore(scope):`. The CC type drives both the bump and the CHANGELOG section.
2. `release-please.yml` opens/updates a single Release PR `chore(main): release 0.x.y` (diffs `VERSION`, `helm/alcoves/Chart.yaml`, `.release-please-manifest.json`, `CHANGELOG.md`).
3. Hand-edit the auto-generated CHANGELOG section before merge if you want richer entries.
4. Merge the Release PR → release-please creates the annotated `v0.x.y` tag + GitHub Release; CI publishes Docker images tagged `0.x.y` and `0.x`.

**Bump policy** (`release-please-config.json`, `release-type: simple`):

- `feat:` → minor (`0.x.0`)
- `fix:` / `perf:` / `refactor:` / `revert:` / `docs:` / `test:` / `build:` / `ci:` → patch
- `chore:` / `style:` are hidden — no CHANGELOG entry, no Release PR alone
- `feat!` / `BREAKING CHANGE:` → still minor while pre-1.0 (`bump-patch-for-minor-pre-major: false`)
- **Never bumps to `1.0.0`.** Cap at `0.x.y` until an explicit decision.
- Force a version: add `Release-As: 0.x.y` as a commit footer.

**Verifying the embedded version:** the backend reads `appVersion` from ldflags (`backend/internal/version/version.go`; resolution: ldflags → `runtime/debug.ReadBuildInfo()` → empty). After a built image, `curl localhost:3001/api/version` returns `{"version":"0.x.y", ...}`; `go run` returns `"version":"dev"`.

## Test discipline (REQUIRED for every code change)

These rules are non-optional. Skipping them is what produced the multi-month test rot we just spent a session unwinding.

**Before merging any feature, refactor, or bug fix:**

1. **Run the targeted suite first.** Changed `client/src/` → `bun run test:unit -- <changed file paths>` (the colocated `*.test.ts` / `*.svelte.test.ts`) + the matching `client/test/e2e/*.e2e.ts` if one exists. Changed `backend/` → `go test ./internal/<changed package>/...`. Don't claim done before this.
   - **Frontend changes MUST run the Playwright e2e suite before being marked done — non-negotiable, not "if one exists".** A change to a shared component/layout/store can break a flow unrelated to your feature; run `bun run test:e2e` broadly, not just the one flow you think you touched, and watch for cross-flow text-locator collisions when adding shared UI. The e2e suite runs against the **real seeded stack**, so bring it up first (`docker compose up`); if it isn't up the e2e job has nothing to hit.
2. **Then run the full suite for the side you touched.** Frontend (in `client/`): `bun run typecheck && bun run lint && bun run test:unit && bun run test:e2e` (all exit 0; e2e needs the stack up). Backend: `go test ./... -race -count=1` (green).
3. **If a test fails, fix it before merge.** Either the test caught a real regression (fix the source) or it was wrong (update/delete in the same PR). **Never commit while ignoring a failure.** "Pre-existing failure, not mine" is how the suite rotted to 104 failures — if it failed during your run, you own quieting it (fix, update, delete, or `it.skip` with a comment + a `docs/internal/todos.md` entry).
4. **If you skip a test, leave a paper trail.** `it.skip` with a comment saying *why* and a `docs/internal/todos.md` link. Never silently delete coverage.
5. **Add tests for new behavior.** New rune store, component, handler, util, or branch gets a test in the same PR. Bar: "would a future regression be caught?"
6. **For UI/frontend changes, also exercise the feature in a browser.** Type-check + tests verify code correctness, not feature correctness. Bring up the stack (`docker compose up`), then either hit the running SvelteKit server or `bun run dev`, click the golden path and a couple edge cases, watch for unrelated regressions before reporting done.

**Frontend testing gotchas (read before writing a new test):**

- **Pick the right vitest project by filename.** Pure logic / hooks / `load` / proxy / API-client tests are `*.test.ts` (the `server`/node project). Component and DOM-rune-store tests are `*.svelte.test.ts` (the `client`/chromium browser project, via `vitest-browser-svelte`). The wrong suffix routes the test to the wrong environment.
- **Route tests must NOT use `+`-prefixed filenames.** SvelteKit treats `+page`/`+layout`/`+server` files as routes; a `+page.svelte.test.ts` would be picked up as a route module. Use `page.svelte.test.ts`, `layout.server.test.ts`, `page.server.test.ts`, `proxy.test.ts`, etc.
- **Mock `$lib/api` (not `fetch`) for component/store tests** — `$env/dynamic/public` is stubbed in browser mode (`vitest/env-public-stub.ts`), so anything reading `PUBLIC_*` (e.g. `url.ts`) gets empty values unless the test mocks `$lib/api` directly.
- **`createApi(fetch)` is the seam.** Server `load` tests pass a fake `fetch`; don't reach for a global fetch mock. `ApiError` carries `.status`/`.data` — assert on those for error-path narrowing.
- Coverage is per-file-floored at 60% (`coverage:floor`) — a new `.svelte`/`.ts` under `src/` needs a colocated test or a documented exclusion.

**Coverage targets (recommendations, not hard gates):**

- **No single file below 60%.** If a file you touch or add is under, add tests in the same PR or note the gap in `docs/internal/todos.md`. Applies to both `client/` and `backend/`. The frontend floor is **enforced in CI** by `client/scripts/coverage-floor.mjs` (`bun run coverage:floor`).
- **Backend aims for 80% global** (`go test ./... -cover`); **frontend gates 90% global** (lines/functions/statements) + 80% branches via the V8 thresholds in `client/vite.config.ts`. Backend global is aspirational (not a CI gate); the frontend thresholds **do** fail CI.
- Frontend coverage config (thresholds + the `LibraryMap`/`VideoEditorPlayer` + trivial `+page` passthrough exclusions) lives in `client/vite.config.ts`. Treat any backend package at `0.0%` with non-test source as a known gap (`docs/internal/todos.md`). Current known under-floor backend package: `objectdetection` (~56%).

## Engineering Guardrails

- Do not switch the package manager (Bun stays repo-wide). **Tooling deviation for `client/`:** because OXlint/OXfmt can't parse `.svelte`, the SvelteKit client uses `svelte-check` (typecheck), Prettier + `prettier-plugin-svelte` (+ `-tailwindcss`) (format), and ESLint flat config + `eslint-plugin-svelte` + `typescript-eslint` (lint). The Go backend keeps its own Go toolchain; don't try to unify the two stacks.
- Schema is **Goose-owned only** — never use GORM `AutoMigrate` in production paths.
- Use `bigint` for file sizes; never `integer` (PostgreSQL `integer` caps at ~2GB).
- Prefer adding/adjusting tests when behavior changes; run targeted tests first, broader suites second.
- Avoid destructive git commands and do not revert unrelated local changes.
- DOM / `window` / `localStorage` access in a Svelte component or rune store: guard with `import { browser } from '$app/environment'` (or run it inside `onMount`/an effect) — SvelteKit SSR is on, so top-level browser-API access crashes the server render.

## Git commit authorship

- Commits are authored by the human (the configured `user.name` / `user.email`). Do **not** add `Co-Authored-By: Claude …` trailers or any other AI attribution. Don't append generator footers (e.g. "🤖 Generated with Claude Code"). The commit message is the message — nothing else.

## Lights Off Software Factory

When the user says "turn off the lights", follow the full workflow defined in [turn-off-the-lights.md](turn-off-the-lights.md).

## Known Gaps (verified against code)

- **S3 storage is not wired in `main.go`** — `ALCOVES_STORAGE_DRIVER=s3` and `ALCOVES_S3_*` are parsed into `Config`, but `main.go` always constructs `storage.NewLocalDriver()`. S3 is config-documented but not yet functional.
- **5 audio-tagger models** (`efficientat_mn04/mn40`, `ced_tiny/small/base`) are catalogued `Available: false` (weights not uploaded); selecting them falls back to `efficientat_mn10`.
- **`helm/alcoves/Chart.yaml`** `appVersion` and `home:` can drift from `VERSION` / the real repo URL — verify before relying on the default image tag.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
