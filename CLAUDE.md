# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🧭 North Star — Read This First

**[docs/vision.md](docs/vision.md) is the project's north-star vision document. ALWAYS read it before building, designing, or reviewing a feature.**

It defines what Alcoves is, who it's for, what it explicitly is and is NOT, and the
guiding principles every change must honor (privacy-first / CPU-only local inference,
owner-gated control, async-by-default heavy work, graceful degradation,
self-hosted-for-a-bounded-trusted-group). Confirm a change aligns with the vision's
pillars and passes its "how to use this as a compass" checklist before building.
**If a change conflicts with [docs/vision.md](docs/vision.md), stop and surface the
conflict instead of shipping it.** The vision document is the tie-breaker for any
product decision.

## Feature & Technical Documentation

Product and developer docs live under `website/src/content/docs/` (Astro + Starlight,
published to [alcoves.io](https://alcoves.io)). **When working on a subsystem, read its
page first** to align with existing product intent and architecture — then update that
page in the same change if behavior shifts.

**Features** (`features/`, what the product does):

- `authentication-and-sessions.md` — Registration, login, OAuth, session cookies, profile, avatars.
- `libraries-and-access-control.md` — Library CRUD, owner/admin/viewer roles, invites, access-control model.
- `files-folders-and-uploads.md` — File/folder CRUD, trash/restore/purge, tagging, dedup, TUS uploads.
- `face-and-object-detection.md` — Face detection/clustering into people; YOLO object labeling.
- `audio-detection-and-transcription.md` — AudioSet tagging + whisper.cpp transcription (admin-selectable models).
- `video-editor-and-moments.md` — Timeline editor, moment clips, export, word/sound highlight filters.
- `moment-sharing.md` — Public share links for moment clips with OG/Twitter embeds + SSR landing.
- `search-activity-notifications.md` — Cross-library search + the real-time activity/notification system.
- `admin-and-job-queue.md` — Owner-gated admin stats, settings, ML-model selection, Asynq job dashboard.
- `mcp-server.md` — Tools, stdio + HTTP transports, PATs, large-file (signed curl URL / tus) model.

**Architecture** (`architecture/` + `self-hosting/`, how the system is built):

- `media-processing-pipeline.md` — On-demand image transforms, video transcoding, thumbnails, waveforms.
- `storage-backends.md` — Pluggable blob storage: scopes, key routing, range reads, cache lifecycle.
- `backend-architecture-go.md` — Server bootstrap, modes, route registration, middleware chain, config.
- `database-schema-and-migrations.md` — GORM models, Goose migrations, pgvector/HNSW, soft-delete + job-state patterns.
- `frontend-architecture.md` — SSR topology, route groups, auth hooks, `createApi` + `/api` proxy, rune stores, Skeleton, adapter-node.
- `ml-models-runtime.md` — CPU-only ONNX/whisper stack, on-demand download, runtime selection.
- `self-hosting/deploying-alcoves.md` — Docker images, compose, Helm chart, CI pipelines, release-please.

**Internal docs** (`docs/internal/`, maintainer-only — not published): ML model
evaluation/publishing notes + the engineering TODO list. See `docs/internal/README.md`.

## Project Summary

Alcoves is a self-hosted collaborative file library with a SvelteKit (Svelte 5) frontend and a Go API backend.

- **Frontend** (`client/`): SvelteKit + Svelte 5 (runes) + Skeleton UI v4 (cerberus theme, class-based dark via `@custom-variant`) + Tailwind 4 (CSS-first, `src/app.css`), built with `adapter-node`, run under Bun (`bun /app/build/index.js`). **Default SSR + hydration** app-wide — server `load`/`hooks.server.ts` fetch the **Go API** (never the DB) and forward the session cookie. `/s/[token]` share pages SSR for OG/SEO meta. A pre-hydration form guard in `app.html` blocks native `<form>` submits during the SSR→hydration window.
- **Backend** (`backend/`): Go 1.26 — Echo, GORM, PostgreSQL 18 + pgvector.
  - Session auth (AES-GCM encrypted cookies); PAT (Bearer) auth for MCP.
  - Local file/avatar/cache storage (S3 config exists but is **not yet wired in `main.go`** — see Known Gaps).
  - Async job queue (Asynq + Dragonfly/Redis): hashing, metadata, thumbnails, waveforms, face/object/audio detection, transcription, video transcoding.
  - CPU-only ONNX/whisper.cpp inference; models download on demand.
- The Go binary is **pure API** — it no longer embeds or serves the frontend.

**Deploy topology**: SvelteKit (adapter-node) on **:3000** (UI + SSR) + Go API on **:3001** (`/api/**`). SvelteKit proxies same-origin `/api/**` to the co-located Go API (in-process catch-all `src/routes/api/[...path]/+server.ts`); dev compose points `INTERNAL_API_URL` at the backend. In prod both sit behind one reverse proxy; `PUBLIC_API_ORIGIN` lets browsers stream binaries (and the activity WebSocket) directly from the API, bypassing the proxy.

**Production image**: a single unified image (root `Dockerfile`, `ghcr.io/rustyguts/alcoves`) bundles the Go API/worker binary, a stdio MCP binary (`/alcoves-mcp`), and the SvelteKit frontend (adapter-node `build/` + pruned production `node_modules`, run via a copied Bun binary). Entrypoint (`docker/entrypoint.sh`) supervises both; a role arg (`all` default | `web` | `api` | `worker`) runs the whole stack or one role. `tini` is PID 1; unknown role → exit 64. Helm's three workloads (`frontend`/`api`/`worker`) all pull this image and set `args` to pick a role. Dev uses the two-service `docker-compose.yml` with `client/Dockerfile.dev` (Vite dev server, hot reload) — only production packaging is unified.

## Core Commands

### Frontend (run from `client/`)

- `bun install` — install deps (`bun.lock`); `prepare` runs `svelte-kit sync` to generate `.svelte-kit/` types
- `bun run dev` — Vite dev server on :3000; same-origin `/api/**` proxied to `INTERNAL_API_URL`
- `bun run build` — production build via `adapter-node` (writes `build/`); `bun run preview` serves it
- `bun run typecheck` — `svelte-kit sync && svelte-check` (aliased `check`)
- `bun run lint` — `prettier --check . && eslint .`; `bun run fmt` / `fmt:check` — Prettier write / check (100-char, tabs)
- `bun run test:unit` — Vitest once (both `server` + `client` projects); `test:unit:coverage` adds V8 coverage
- `bun run coverage:floor` — enforce per-file 60% floor (`scripts/coverage-floor.mjs`)
- `bun run test:e2e` — Playwright e2e against a **real running stack**; `bun run test` = `vitest run` then `playwright test`

Run a single unit test file or pattern:
```bash
bun run test:unit src/lib/api/fetch.test.ts                      # one server-project file
bun run test:unit src/lib/components/ui/AppIcon.svelte.test.ts   # one client-project (browser) file
bun run test:unit -- -t "pattern"
```

### Backend (run from `backend/`)

```bash
go run cmd/server/main.go                     # Start server (version "dev" — no ldflags)
air                                           # Hot reload (.air.toml; builds -tags dev)
go build -o bin/alcoves cmd/server/main.go    # Build binary
go test ./...                                 # All tests
go test ./... -race -count=1                  # Race detector (CI standard)
go test ./internal/handlers/... -run TestName # Single test (-v for verbose package run)
go test ./... -cover                          # Coverage summary
```

Module: `github.com/alcoves/alcoves-backend`. Production builds inject version via ldflags into `internal/version` (`commit`, `buildTime`, `appVersion`); CI passes `APP_VERSION=$(cat VERSION)` as a docker build-arg.

### Docker (local development)

```bash
docker compose up                       # postgres + dragonfly + backend (Air) + frontend (SvelteKit Vite dev)
docker compose up -d postgres dragonfly # Infrastructure only
docker compose down -v                  # Drop postgres_data volume (full reset, re-seeds)
```

Ports: frontend :3000, backend :3001, postgres :5432, **Dragonfly host :6389 → container :6379**. The backend service sets `ALCOVES_QUEUE_PORT=6379` (in-container); the config default when unset is `6389`. The frontend container (`client/Dockerfile.dev`) sets `INTERNAL_API_URL=http://backend:3001`; the named `client_node_modules` volume plus anonymous volumes over `/app/.svelte-kit` and `/app/build` keep host-side build artifacts from leaking in.

## Local Dev Seed Data (`backend/internal/seed`)

`docker compose up` against an **empty** DB auto-loads a rich data set so you can log in immediately and exercise every feature. **Log in with `test@alcoves.io` / `password123`** (owner/admin). Other logins: `alice@alcoves.io`, `bob@alcoves.io` (both `password123`). Dev PAT: `alc_pat_localdev0000000000000000000000000000`.

- **Seeded:** 3 users, 5 libraries (Family Photos, Travel 2025, Podcast Recordings, Alice's, Bob's — with member roles + face/object/sharing flags), nested folders, real image/video/audio files, tags, people + face crops, object detections, EXIF/GPS (Timeline + Map), transcripts, audio-event detections, waveforms, moments, a **public moment share** (`token="devseedshare01"`), highlight filters, the activity feed, app settings, a dev PAT.
- **Media files are real**, committed under `backend/internal/seed/assets/` (`images/videos/audio/thumbs/faces/`), embedded via `go:embed`. Regenerate with `assets/generate.sh` (ImageMagick + ffmpeg + cwebp). Labeled placeholders, not real photos.
- **Gating:** `MaybeRun` seeds **only** when ALL hold: `ALCOVES_SEED=true` (set in compose; never in real deployments), `ALCOVES_MODE != worker`, `ALCOVES_ENV != production`, and the DB has **zero users** (serialized via a Postgres advisory lock). A populated DB is left untouched, so a **real owner's first-time setup is never affected**. Safe on every boot; no-op after the first run.
- **Tests reuse it:** `seed.Run(db, storage)` is exported; `seed_test.go` (`TestRun` + `TestMaybeRunGating`) runs it against an isolated schema + temp storage and asserts minimum counts to guard against shrinkage.

> [!IMPORTANT]
> **Keep the seed relevant to features.** When you add or change a user-facing feature,
> extend the seeder in the same change (new model → seed a few rows; new view → seed what
> it renders). Bar: after `docker compose up`, logging in as `test@alcoves.io` shows
> realistic content for **every** shipped feature. A feature with no seed data is invisible
> in local dev and untested by the seed test — treat that as a gap.

## Architecture Notes

### Backend (`backend/`)

- Entry: `backend/cmd/server/main.go`; stdio MCP entry: `backend/cmd/mcp`.
- Bootstrap order: `config.Load()` (fails fast if `ALCOVES_SESSION_SECRET` unset) → optional Sentry → `database.Connect()` (GORM) → `database.RunMigrations()` (Goose, **every boot**) → service graph → `seed.MaybeRun()` → Asynq client + Inspector → Redis pub/sub activity bus → Activity Hub (non-`worker` only) → ONNX pre-download + Asynq server + maintenance loops (`all`/`worker` only) → Echo server (graceful 10s shutdown on SIGINT).

**`ALCOVES_MODE`:**

| Mode | HTTP server | Asynq worker | Notes |
|------|-------------|--------------|-------|
| `all` (default) | yes | yes | Single-process full stack |
| `api` | yes | no | API only; no background jobs |
| `worker` | health + version only | yes | No API routes besides `/api/health`, `/api/version` |

**Echo middleware chain (order matters):** `Logger` → `sentryhttp` (if DSN) → custom `HTTPErrorHandler` (Sentry, if enabled) → `Recover` → CORS (explicit origin allowlist; `AllowCredentials: true`; exposes TUS + byte-range headers) → `AuthMiddleware` (AES-GCM session cookie **or** `Authorization: Bearer <PAT>`; skips public paths) → `LibraryAccessMiddleware` (on `/api/libraries/:id/*`: read → viewer+, write → admin+).

**`internal/` layout:** `config` (`Config` + `Load()`, env parsing), `database` (`Connect()`, `RunMigrations()`), `handlers` (HTTP handlers, one file per resource; `validator.go` wraps go-playground/validator), `middleware` (`AuthMiddleware`, `LibraryAccessMiddleware`), `models` (all GORM entities in `models.go`), `mcpserver` (`*mcp.Server`, v1 22-tool set + per-request identity bridge), `queues` (Asynq queue constants + `Priorities` weights), `queuerouting` (**tests-only** service→queue routing guard), `seed`, `services/` (below), `testsupport` (shared test helpers — `db.go`, `mlfixtures.go`, `onnxtest/`, `testdata/`), `version`.

**Services (`internal/services/`) — 19 packages:**

| Package | Responsibility |
|---------|----------------|
| `access` | Library membership checks; `RequireLibraryAccess`/`RequireLibraryAdmin`; sets `LibraryAccess` context |
| `activity` | Activity log + notifications: `Service.Emit()` inserts; `Hub` fans out over WS; `Bus` is the Redis pub/sub bridge |
| `audiodetection` | AudioSet 527-class ONNX tagging; admin-selectable model (default `efficientat_mn10`); `file:audio-detect` |
| `auth` | AES-GCM session cookies; bcrypt passwords; PAT minting (SHA-256) + `ValidateMCPToken()` |
| `avatarproc` | Avatar resize/crop/webp via govips |
| `facedetection` | SCRFD `det_10g` (detect) + ArcFace `w600k_r50` (512-dim); pgvector cosine ANN clustering; `face:detect` |
| `filehash` | SHA-256 content hashing for dedup; `file:hash` |
| `files` | File listing, timeline, map queries; `ingest.go` `ServiceWithIngest` chains post-upload processing |
| `imageproxy` | On-demand transforms (govips); 5 variants; Redis pub/sub cache coalescing; `PrewarmService`; `image:proxy`+`image:prewarm` |
| `invites` | Invite redemption (validate token, create `LibraryMember`, bump `UseCount`) |
| `metadata` | EXIF/GPS (goexif) for images + ffprobe for video; backfill loop; `file:metadata` |
| `momentexport` | ffmpeg clip encode for moment export; `moment:export` |
| `objectdetection` | YOLO26x FP16 ONNX (in `pixel_values`; out `logits`,`pred_boxes`); `object:detect` |
| `settings` | Single-row `app_settings` JSONB (`RegistrationMode`, `WhisperModel`, …); workers honor admin changes without restart |
| `signing` | HMAC signed-URL mint/validate for MCP curl upload/download (falls back to `ALCOVES_SESSION_SECRET`) |
| `storage` | Pluggable `Driver`; `LocalDriver` + S3; scopes `files`/`avatars`/`cache`. **`main.go` always builds `NewLocalDriver()`** |
| `transcribe` | whisper.cpp (`whisper-cli`) + Silero VAD; admin-selectable allow-list; `file:transcribe` |
| `videoproxy` | ffmpeg transcode + poster-frame; DB-tracked progress/ETA; `video:proxy`+`video:thumbnail` |
| `waveform` | ffmpeg PCM extraction + peak windowing; `file:waveform` |

**Route groups (registered in `main.go`):**

| Prefix | Purpose / handler |
|--------|-------------------|
| `/api/health` · `/api/version` | Inline; always registered (all modes) |
| `/api/auth/*` · `/api/_auth/session` | Auth, sessions, avatars, PATs, Google OAuth (`auth.go`, `avatar.go`, `tokens.go`, `oauth.go`) |
| `/api/libraries` | Library CRUD (`library.go`) |
| `/api/libraries/:id/*` | Files, folders, tags, highlight-filters, moments+shares, members+invites, people, objects, downloads, timeline/map, feed (`file.go`, `folder.go`, `tag.go`, `highlight_filter.go`, `moment.go`, `moment_share.go`, `member.go`, `people.go`, `objects.go`, `download.go`, `notifications.go`) |
| `/api/notifications` · `/api/ws` | Global notification feed + dismissals + WebSocket (`notifications.go`) |
| `/api/invites/:token` | Lookup (GET, public) + Accept (POST, auth in handler) |
| `/api/search` | Cross-library search |
| `/api/admin/*` | Owner-gated: stats, users, settings, backfill, Asynq dashboard (`admin.go`, `admin_jobs.go`) |
| `/api/_meta/registration-mode` | Public; `{mode: open\|invite_only\|closed}` |
| `/api/tus` | TUS v1.0 resumable upload (`tus.go`) |
| `/api/files/proxy/*` | On-demand image transform / video proxy (`download.go`) |
| `/api/files/signed` · `/api/files/upload-signed` | Signed MCP curl download / upload (`signed.go`; public) |
| `/api/mcp` | MCP HTTP transport (gated by `ALCOVES_MCP_HTTP_ENABLED`) |
| `/api/share/:token` · `/share/:token/video` · `/thumbnail` | Public moment share metadata + stream + thumbnail (no auth) (`share.go`) |

**Models & migrations:** all GORM entities in one file `internal/models/models.go`, UUID PKs with `BeforeCreate`. **No GORM soft-delete** — a nullable `TrashedAt *time.Time` on `File`/`Folder`/`Moment`, filtered manually. File sizes are `bigint`. Each async job type on `File` carries a `_status`/`_error`/`_version` + last-completed `_*ed_version` column set; a version mismatch triggers re-run (metadata + image_proxy use a 3-strike `_attempts` cap). Face embeddings are `vector(512)` (pgvector). Migrations are Goose SQL in `backend/migrations/` (`00001`→`00022`), embedded via `embed.go`, applied with `provider.Up()`; `00019` builds the HNSW `vector_cosine_ops` index (`m=16, ef_construction=64`, `CONCURRENTLY`/`NO TRANSACTION`).

**Async queue (Asynq + Dragonfly):** named queues, weighted-random scheduling, worker concurrency 8. Constants + weights in `internal/queues`: `imageproxy` (100), `metadata` (70), `thumbnail` (65), `hash` (60), `default` (50), `moment-export` (45), `waveform` (40), `object-detection` (30), `face-detection` (30), `audio-detection` (25), `video-transcode` (10), `transcription` (5), `maintenance` (1). Task types: `image:proxy`, `image:prewarm`, `file:metadata`, `video:thumbnail`, `file:hash`, `moment:export`, `file:waveform`, `object:detect`, `face:detect`, `file:audio-detect`, `video:proxy`, `file:transcribe`.

**ML / inference (CPU-only ONNX + whisper.cpp):**

- **Faces:** SCRFD `det_10g.onnx` + ArcFace `w600k_r50.onnx`; pgvector cosine ANN clustering. ONNX init once via `sync.Once` (`onnxruntime_go`).
- **Objects:** YOLO26x FP16 `yolo26x_fp16.onnx` (640×640 input).
- **Audio:** registry of 7; 2 available (`efficientat_mn10` default, `pann_cnn14`); the other 5 (`efficientat_mn04/mn40`, `ced_tiny/small/base`) are `Available: false` and fall back to the default. Admin-selectable.
- **Transcription:** whisper.cpp `whisper-cli` + Silero VAD; 9-model allow-list (`tiny`→`large-v3` + quants); language defaults `auto`.
- **Images:** govips; 5 variants — `search` (80², jpeg), `timeline` (240², webp), `face` (300², jpeg), `card` (720×360, jpeg), `preview` (1920×1080, jpeg); `VariantsVersion` bump triggers prewarm.
- Models download on demand from `https://s3.rustyguts.net/models` (configurable) with retry + minimum-size validation.

**Storage:** `Driver` interface (`EnsureReady`, `PutBuffer`/`PutStream`, `OpenReadStream` w/ `ByteRange`, `ReadBuffer`, `Exists`, `Stat`, `DeletePrefix`). Three scopes: `files` (`{libraryId}/{fileId}/blob`), `avatars` (`{userId}/avatar.webp`), `cache`. `LocalDriver` exposes `LocalFilePath()` so ffprobe/ffmpeg read on-disk without temp copies.

### Frontend (`client/`)

- SvelteKit + Svelte 5 (runes forced for non-`node_modules` files in `svelte.config.js`) + Skeleton UI v4 + Tailwind 4 + Bun. `adapter-node` with `envPrefix: 'FRONTEND_'` so the server reads `FRONTEND_*` and never collides with the Go API's `PORT` in the `all` role. Tailwind + Skeleton are CSS-first in `src/app.css` (`@import 'tailwindcss'` + `@skeletonlabs/skeleton` + `cerberus`; no `tailwind.config`). `vite.config.ts` wires `@tailwindcss/vite` + `sveltekit()` (and the Vitest config).
- **SSR:** default SSR + hydration app-wide. `app.html` has a pre-paint theme bootstrap (reads `localStorage` `alcoves.theme`, toggles `.dark`) and a pre-hydration form guard (blocks native submits until `window.__alcovesReady`).
- **`src/routes/` groups** (dynamic `[id]`/`[token]`/`[fileId]`/`[personId]`, catch-all `[...path]`):
  - `(app)/` — authed dashboard. `(app)/+layout.server.ts` redirects anon → `/login?redirect=…` and loads the sidebar libraries list (degrades to `[]`); `(app)/+layout.svelte` is the shell. Sub-routes: `libraries/[id]` (browser; `trash/` sibling) + `feed`, `map`, `objects`, `tags`, `timeline`, `settings`, `people/[personId]`, `edit/[fileId]` (video editor); plus `notifications`, `profile`, `search`, and owner-only `admin/` + `admin/jobs/` (gated by `admin/+layout.server.ts`, non-`owner` → `/`).
  - Public (outside the group): `login`, `register`, `invites/[token]`, `s/[token]` (share landing — `+page.server.ts` SSRs OG/SEO meta).
  - `api/[...path]/+server.ts` — in-process catch-all proxy (below).
- **`hooks.server.ts`:** `handle` resolves `event.locals.user` for app navigations via the Go API's `GET /api/_auth/session` (never 401s; a backend hiccup → `null`, not a 500) — skipped for `/api/*`. `handleFetch` rewrites same-origin `/api/*` fetches in server `load`/actions to `INTERNAL_API_URL`, forwarding the session `cookie` + `X-Forwarded-Host`/`-Proto` (load-bearing: `share.go` builds absolute OG/share URLs from the forwarded host). `hooks.client.ts` just logs client errors.
- **`src/routes/api/[...path]/+server.ts`** — in-process catch-all proxy (browser → SvelteKit → co-located Go API); streams bodies both ways, passes status/headers verbatim so Range (206), ETag, TUS, `Set-Cookie` all work (`duplex: 'half'` for streamed PATCH). Binary GETs + activity WS can bypass via `PUBLIC_API_ORIGIN`; in single-port mode (no `PUBLIC_API_ORIGIN`) the notifications socket degrades to poll fallback (WS works directly via k8s ingress or `PUBLIC_API_ORIGIN`).
- **`src/lib/api/`** — `createApi(fetch)` factory (`client.ts`, 15 namespaces: `auth`, `libraries`, `files`, `folders`, `tags`, `highlightFilters`, `members`, `people`, `objects`, `downloads`, `search`, `invites`, `admin`, `moments`, `meta`). Server `load` passes `event.fetch`; browser uses the `api` singleton (`index.ts`). `fetch.ts` is isomorphic `apiFetch` + `ApiError` (`.status`/`.data`); `url.ts` resolves data-vs-asset URLs: server keeps `/api/*` relative (so `handleFetch` rewrites + forwards the cookie); browser uses `PUBLIC_API_ORIGIN` when set (direct to Go, avoids Range mangling) else relative through the proxy.
- **`src/lib/state/`** — Svelte 5 rune stores (`*.svelte.ts`): `auth`, `theme`, `toast`, `library-explorer`, `upload-queue` (TUS, `/api/tus`), `libraries-list`, `notifications`(+`-socket`), `async-job-status`, plus per-feature stores (`library-people/members/moments/feed/timeline/map/tags/folder-path/folder-actions`, `transcript`/`transcribe-job`, `audio-detections`/`audio-detect-job`, `waveform*`, `highlight-filters`, `editor-highlights`/`editor-shortcuts`, `moment-downloads`, `download-zip`, `file-drop`).
- **`src/lib/components/`** — `ui/` primitives (`AppIcon`, `AppModal`, `AppPanel`/`AppPanelRow`, `AlcovesImage`, `UserAvatar`, `ConfirmModal`, `AuthCardShell`, `OAuthGoogleButton`, `EmojiPicker`), feature dirs (`library/`, `editor/`, `admin/`, `notifications/`, `profile/`), and top-level components (`LibraryHeader`, `LibraryBreadcrumb`, `LibrarySwitcher`, `SidebarLibraryNav`, `JustifiedGallery`, `FilePreview`, `TimelineScrubber`, `UploadModal`/`UploadProgress`, `LibraryMap` — Leaflet, browser-only). `src/lib/actions/portal.ts` is a `use:portal` action.
- **`src/lib/`** — `shared/` (`image-variants`, `tag-colors`), `utils/` (pure helpers — `activity-format`, `justified-layout`, `mime-icons`, `parse-vtt`, `highlight-expression`, `permissions`, `icons`, …), `types/api.ts` (response types, `$lib/types/api`).
- **Icons:** `@iconify/svelte` rendered fully **offline** — `ui/AppIcon.svelte` calls `addCollection(@iconify-json/lineicons/icons.json)` (privacy-first; no network fetch). The `ICONS` registry (`src/lib/utils/icons.ts`) maps names → `lineicons:<glyph>`, validated by `icons.test.ts`.
- **Env:** server-only `INTERNAL_API_URL` (`$env/dynamic/private`); browser `PUBLIC_*` (`$env/dynamic/public`): `PUBLIC_API_ORIGIN`, `PUBLIC_GOOGLE_AUTH_ENABLED`, `PUBLIC_SENTRY_DSN`, `PUBLIC_MAP_TILE_URL`/`_ATTRIBUTION`. adapter-node runtime: `FRONTEND_HOST`/`_PORT`/`_ORIGIN`/`_PROTOCOL_HEADER`/`_HOST_HEADER`/`_BODY_SIZE_LIMIT` (the last must be unbounded or TUS chunk PATCHes through the proxy are rejected).

### Testing Conventions

**Frontend unit tests** (Vitest, dual `projects` in `vite.config.ts`, colocated `*.test.ts` under `client/src/`):
- **`server` project** (`node`, `*.{test,spec}.ts` excluding `*.svelte.*`) — pure logic, hooks, `load`, the `/api` proxy, the API client, utils. Route-server tests must NOT use `+`-prefixed filenames (use `layout.server.test.ts`, `page.server.test.ts`).
- **`client` project** (real **chromium** via `@vitest/browser-playwright` + `vitest-browser-svelte`, `*.svelte.{test,spec}.ts`, excludes `src/lib/server/**`) — components + DOM-touching rune stores. Route-page tests use `page.svelte.test.ts` (never `+page.svelte.test.ts`).
- `$env/dynamic/public` isn't initialized in browser mode → aliased to `vitest/env-public-stub.ts`; tests needing a value mock `$lib/api` directly.
- ~1,600 unit tests. Coverage: V8, 90% (lines/functions/statements) + 80% branches in `vite.config.ts`; the per-file 60% floor is enforced separately (`scripts/coverage-floor.mjs`). Coverage-excluded (e2e-covered): `LibraryMap.svelte`, `editor/VideoEditorPlayer.svelte`, and the two trivial `libraries/*/+page.svelte` / `trash/+page.svelte` wrappers.

**Frontend E2E** (Playwright, `client/playwright.config.ts`, `client/test/e2e/*.e2e.ts`, `workers: 1`, chromium):
- Runs against the **REAL full stack** — **no mock backend**. Local: `docker compose up` (Postgres + Dragonfly + seeded Go API/worker behind SvelteKit), then `bun run test:e2e`. CI brings the stack up via `docker compose` and sets `E2E_BASE_URL` (default `http://localhost:3000`).
- Seed login: `test@alcoves.io` / `password123`. Shared login helper: `client/test/e2e/helpers/auth.ts`.

**Backend tests** (standard `testing`): `*_test.go` alongside source; `-run TestName` targets one function; `internal/testsupport` provides shared DB/ML fixtures.

## Environment

**Backend (`ALCOVES_*`):**

- `ALCOVES_MODE` — `all` (default) | `api` | `worker`; `ALCOVES_ENV` — `development` | `production`
- `ALCOVES_DATABASE_URL` (required) — PostgreSQL DSN; `ALCOVES_SESSION_SECRET` (required) — AES-GCM key ≥32 bytes
- `ALCOVES_QUEUE_HOST` / `_PORT` (default `6389`; compose uses `6379` in-container) / `_PASSWORD`
- `ALCOVES_BASE_URL` — public URL for OAuth redirects + share/MCP signed links
- `ALCOVES_STORAGE_DRIVER` — `local` (default) | `s3`; `ALCOVES_STORAGE_PATH` / `_AVATAR_STORAGE_PATH` / `_CACHE_STORAGE_PATH` / `_MODELS_PATH` / `_WHISPER_MODELS_DIR`
- S3 (driver=s3): `ALCOVES_S3_BUCKET`, `_REGION`, `_ENDPOINT`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_FORCE_PATH_STYLE`, `_FILES_PREFIX`/`_AVATARS_PREFIX`/`_CACHE_PREFIX`
- `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` / `_SECRET`; `ALCOVES_SEED` — `true` loads dev data if DB empty (never in production)
- ML: `ALCOVES_WHISPER_MODEL` (default `large-v3`), `_WHISPER_LANGUAGE` (`auto`), `_WHISPER_VAD_MODEL` (`silero-v6.2.0`; `""` disables), `_WHISPER_MODEL_BASE_URL`, `_AUDIO_DETECT_MODEL_BASE_URL`/`_LABELS_URL`/`_WINDOW_SEC`/`_THRESHOLD`/`_TOP_K`, `_FACE_DETECTION_MIN_SCORE`, `_FACE_RECOGNITION_MAX_DISTANCE`/`_MIN_FACES`/`_NEIGHBOR_LOOKUP`, `_OBJECT_DETECTION_MIN_SCORE`/`_MAX_DETECTIONS`/`_NMS_THRESHOLD`
- MCP: `ALCOVES_MCP_HTTP_ENABLED` (default false), `_MCP_TOKEN` (stdio PAT), `_MCP_SIGNING_SECRET` (falls back to session secret)
- `ALCOVES_IMAGE_PROXY_PREWARM_ENABLED` (default true), `_SENTRY_DSN` / `_TRACES_SAMPLE_RATE`
- `PORT` (Go listen port, default 3001), `LD_LIBRARY_PATH=/usr/local/lib` (required in container for ONNX `dlopen`)

**Frontend (SvelteKit):**

- `INTERNAL_API_URL` — Go backend URL for the proxy + server `load`/`handleFetch` (default `http://localhost:3001`; compose `http://backend:3001`); server-only (`$env/dynamic/private`)
- `FRONTEND_HOST`/`_PORT` — adapter-node bind (default `0.0.0.0:3000`); `FRONTEND_ORIGIN` (required for POST/cookie origin checks unless `_PROTOCOL_HEADER`/`_HOST_HEADER` are set); `FRONTEND_BODY_SIZE_LIMIT` (`Infinity` so TUS PATCH chunks aren't rejected). All read via the `FRONTEND_` `envPrefix`.
- `PUBLIC_API_ORIGIN` — public API origin for browser binary streaming + the activity WebSocket (bypasses the proxy); empty = same-origin through the proxy
- `PUBLIC_GOOGLE_AUTH_ENABLED`, `PUBLIC_SENTRY_DSN`, `PUBLIC_MAP_TILE_URL`/`_ATTRIBUTION` (`$env/dynamic/public`)

See `.env.example` for the full list and defaults.

## Build, Deploy & CI

- **Root `Dockerfile`** — 4 stages: Go build (`golang:1.26-bookworm`, libvips/ffmpeg, ONNX Runtime v1.26.0, builds `/alcoves` + `/alcoves-mcp` with `CGO_ENABLED=1` + version ldflags), whisper.cpp build (`v1.8.4`, hardened `-march=x86-64-v3` / AVX-512 off), SvelteKit client build (`oven/bun:1`, `--frozen-lockfile` → `bun run build`, then `bun install --production` prunes a lean runtime `node_modules`), and a `debian:bookworm-slim` runtime copying `build/` + pruned `node_modules` + `package.json` + a `bun` binary. Env defaults: `ALCOVES_MODE=all`, `FRONTEND_HOST=0.0.0.0`, `FRONTEND_PORT=3000`, `FRONTEND_PROTOCOL_HEADER=x-forwarded-proto`, `FRONTEND_HOST_HEADER=x-forwarded-host`, `FRONTEND_BODY_SIZE_LIMIT=Infinity`, `PORT=3001`, `INTERNAL_API_URL=http://127.0.0.1:3001`. `EXPOSE 3000 3001`; `ENTRYPOINT tini -- /app/entrypoint.sh`; `CMD ["all"]`.
- **`docker/entrypoint.sh`** — role arg `all|web|api|worker`. `web` → `exec bun /app/build/index.js`; `api`/`worker` → `exec` the Go binary with `ALCOVES_MODE` set. `all` supervises both, `trap`s `TERM`/`INT` → `SIGTERM` both children, `wait -n`, exits non-zero on any child exit to force restart.
- **Helm (`helm/alcoves/`)** — three Deployments off the one image with different `args`: `frontend` (`web`, :3000), `backend-api` (`api`, :3001), `backend-worker` (`worker`, no Service). Single RWX PVC at `/app/data` for `local` storage; chart does NOT deploy Postgres/Dragonfly. Shared backend env from `_envvars.tpl`.
- **CI (`.github/workflows/`)** — `ci.yml`: `backend-test` (`go test -race -count=1 -p 1`, sharded 5 ways — each shard has its own postgres+dragonfly, `-p 1` stays within a shard; the heavy `internal/handlers` package is split by test name, the rest round-robined by `go list`; whisper.cpp cached), `unit-and-coverage` (in `client/`: `lint` + `typecheck` + `test:unit:coverage` + `coverage:floor`; installs the chromium browser for component tests), `e2e` (Playwright against the **REAL full stack** — `docker compose up -d --build --wait`, then `bunx playwright test` with `E2E_BASE_URL=http://localhost:3000`; **no mock backend**). `build-images.yml` (reusable) builds + pushes to GHCR; `publish.yml` calls it on push/tags/release; `release-please.yml` runs release-please + re-publishes `X.Y.Z`/`X.Y` tags on release; `website.yml` builds + deploys the Starlight site.

## Versioning

Alcoves is **alpha**. Releases are automated by **release-please** — do NOT manually edit `/VERSION`, `/CHANGELOG.md`, or `helm/alcoves/Chart.yaml` versions in feature PRs. The plain-text `/VERSION` file is the single runtime source of truth; release-please owns updating it (and `Chart.yaml` via `extra-files`).

**How releases happen:**

1. Land feature PRs to `main` with **Conventional Commit** subjects: `feat(scope):`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`. The CC type drives both the bump and the CHANGELOG section.
2. `release-please.yml` opens/updates a single Release PR `chore(main): release 0.x.y` (diffs `VERSION`, `Chart.yaml`, `.release-please-manifest.json`, `CHANGELOG.md`).
3. Hand-edit the auto-generated CHANGELOG section before merge for richer entries.
4. Merge the Release PR → release-please creates the annotated `v0.x.y` tag + GitHub Release; CI publishes Docker images tagged `0.x.y` and `0.x`.

**Bump policy** (`release-please-config.json`, `release-type: simple`):

- `feat:` → minor (`0.x.0`); `fix`/`perf`/`refactor`/`revert`/`docs`/`test`/`build`/`ci` → patch
- `chore:`/`style:` hidden — no CHANGELOG entry, no Release PR alone
- `feat!` / `BREAKING CHANGE:` → still minor while pre-1.0 (`bump-patch-for-minor-pre-major: false`)
- **Never bumps to `1.0.0`** — cap at `0.x.y` until an explicit decision. Force a version with a `Release-As: 0.x.y` footer.

**Verifying the embedded version:** the backend reads `appVersion` from ldflags (`backend/internal/version/version.go`; resolution: ldflags → `runtime/debug.ReadBuildInfo()` → empty). On a built image `curl localhost:3001/api/version` returns `{"version":"0.x.y", ...}`; `go run` returns `"version":"dev"`.

## Test discipline (REQUIRED for every code change)

These rules are non-optional. Skipping them is what produced the multi-month test rot we just spent a session unwinding.

**Before merging any feature, refactor, or bug fix:**

1. **Run the targeted suite first.** Changed `client/src/` → `bun run test:unit -- <changed paths>` + the matching `client/test/e2e/*.e2e.ts` if one exists. Changed `backend/` → `go test ./internal/<changed package>/...`. Don't claim done before this.
   - **Frontend changes MUST run the Playwright e2e suite before being marked done — non-negotiable, not "if one exists".** A change to a shared component/layout/store can break an unrelated flow; run `bun run test:e2e` broadly, and watch for cross-flow text-locator collisions when adding shared UI. The suite hits the **real seeded stack**, so bring it up first (`docker compose up`).
2. **Then run the full suite for the side you touched.** Frontend (in `client/`): `bun run typecheck && bun run lint && bun run test:unit && bun run test:e2e` (all exit 0; e2e needs the stack up). Backend: `go test ./... -race -count=1` (green).
3. **If a test fails, fix it before merge.** Either it caught a real regression (fix the source) or it was wrong (update/delete in the same PR). **Never commit while ignoring a failure** — "pre-existing failure, not mine" is how the suite rotted to 104 failures. If it failed during your run, you own quieting it (fix, update, delete, or `it.skip` + comment + `docs/internal/todos.md` entry).
4. **If you skip a test, leave a paper trail.** `it.skip` with a *why* comment and a `docs/internal/todos.md` link. Never silently delete coverage.
5. **Add tests for new behavior.** New rune store, component, handler, util, or branch gets a test in the same PR. Bar: "would a future regression be caught?"
6. **For UI changes, also exercise the feature in a browser.** Type-check + tests verify code correctness, not feature correctness. Bring up the stack, hit the running server (or `bun run dev`), click the golden path + a couple edge cases, watch for unrelated regressions before reporting done.

**Frontend testing gotchas (read before writing a new test):**

- **Pick the right vitest project by filename.** Pure logic / hooks / `load` / proxy / API-client tests are `*.test.ts` (`server`/node project). Component + DOM-rune-store tests are `*.svelte.test.ts` (`client`/chromium browser project). The wrong suffix routes the test to the wrong environment.
- **Route tests must NOT use `+`-prefixed filenames** — SvelteKit treats `+page`/`+layout`/`+server` as routes. Use `page.svelte.test.ts`, `layout.server.test.ts`, `page.server.test.ts`, `proxy.test.ts`.
- **Mock `$lib/api` (not `fetch`) for component/store tests** — `$env/dynamic/public` is stubbed in browser mode, so anything reading `PUBLIC_*` (e.g. `url.ts`) gets empty values unless the test mocks `$lib/api` directly.
- **`createApi(fetch)` is the seam.** Server `load` tests pass a fake `fetch`. `ApiError` carries `.status`/`.data` — assert on those for error-path narrowing.
- Coverage is per-file-floored at 60% (`coverage:floor`) — a new `.svelte`/`.ts` under `src/` needs a colocated test or a documented exclusion.

**Coverage targets (recommendations, not hard gates):**

- **No single file below 60%.** If a file you touch/add is under, add tests in the same PR or note the gap in `docs/internal/todos.md` (applies to `client/` + `backend/`). The frontend floor is **enforced in CI** (`coverage-floor.mjs`).
- **Backend aims for 80% global** (`go test ./... -cover`, aspirational); **frontend gates 90% global** (lines/functions/statements) + 80% branches via the V8 thresholds in `client/vite.config.ts` (these **do** fail CI). Current known under-floor backend package: `objectdetection` (~56%).

## Engineering Guardrails

- Do not switch the package manager (Bun stays repo-wide). **`client/` tooling deviation:** because OXlint/OXfmt can't parse `.svelte`, the client uses `svelte-check` (typecheck), Prettier + `prettier-plugin-svelte` (+ `-tailwindcss`) (format), ESLint flat config + `eslint-plugin-svelte` + `typescript-eslint` (lint). The Go backend keeps its own toolchain; don't unify the stacks.
- Schema is **Goose-owned only** — never use GORM `AutoMigrate` in production paths.
- Use `bigint` for file sizes; never `integer` (PostgreSQL `integer` caps at ~2GB).
- Prefer adding/adjusting tests when behavior changes; targeted tests first, broader suites second.
- Avoid destructive git commands; do not revert unrelated local changes.
- DOM / `window` / `localStorage` access in a Svelte component or rune store: guard with `import { browser } from '$app/environment'` (or run inside `onMount`/an effect) — SSR is on, so top-level browser-API access crashes the server render.

## Git commit authorship

Commits are authored by the human (the configured `user.name` / `user.email`). Do **not** add `Co-Authored-By: Claude …` trailers or any other AI attribution, and don't append generator footers (e.g. "🤖 Generated with Claude Code"). The commit message is the message — nothing else.

## Lights Off Software Factory

When the user says "turn off the lights", follow the full workflow in [turn-off-the-lights.md](turn-off-the-lights.md).

## Known Gaps (verified against code)

- **S3 storage is not wired in `main.go`** — `ALCOVES_STORAGE_DRIVER=s3` and `ALCOVES_S3_*` are parsed into `Config`, but `main.go` always constructs `storage.NewLocalDriver()`. S3 is config-documented but not yet functional.
- **5 audio-tagger models** (`efficientat_mn04/mn40`, `ced_tiny/small/base`) are `Available: false` (weights not uploaded); selecting them falls back to `efficientat_mn10`.
- **`helm/alcoves/Chart.yaml`** `appVersion` and `home:` can drift from `VERSION` / the real repo URL — verify before relying on the default image tag.

## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts — these return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain don't surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
