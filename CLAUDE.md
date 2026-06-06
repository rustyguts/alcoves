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
- [Frontend Architecture (Nuxt 4)](website/src/content/docs/architecture/frontend-architecture.md) — Nuxt SSR topology, isomorphic fetch, layouts, middleware, and the typed API client.
- [ML Models & Runtime Inference](website/src/content/docs/architecture/ml-models-runtime.md) — The CPU-only ONNX/whisper model stack, on-demand download, and runtime selection.
- [Deployment & Operations (Docker, Helm, CI/CD)](website/src/content/docs/self-hosting/deploying-alcoves.md) — Docker images, compose, the Helm chart, CI pipelines, and release-please.

**Internal documentation** (`docs/internal/`, maintainer-only — not published): ML
model evaluation/publishing notes and the engineering TODO list. See
[`docs/internal/README.md`](docs/internal/README.md).

## Project Summary

Alcoves is a self-hosted collaborative file library with a Nuxt 4 (Vue 3) frontend and a Go API backend.

- **Frontend** (`frontend/`): Nuxt 4 + Nuxt UI v4 + Tailwind 4, runs on its own Nitro server (Bun preset in prod). Top-level `ssr: true`, but `routeRules` make `/**` client-rendered (SPA) and SSR only `/s/**` (public moment share pages). This avoids SSR-time backend coupling on auth-gated routes and a native-form-submit race during hydration.
- **Backend** (`backend/`): Go (1.26) API server — Echo, GORM, PostgreSQL 18 + pgvector.
  - Session auth with AES-GCM encrypted cookies; PAT (Bearer) auth for MCP.
  - Local file/avatar/cache storage (S3 config exists but is **not yet wired in `main.go`** — see Known Gaps).
  - Async job queue (Asynq + Dragonfly/Redis) for hashing, metadata, thumbnails, waveforms, face/object/audio detection, transcription, and video transcoding.
  - CPU-only ONNX/whisper.cpp inference; models download on demand.
- The Go binary is **pure API** — it no longer embeds or serves the frontend.

**Deploy topology**: Nitro server on **:3000** (Nuxt UI) + Go API on **:3001** (`/api/**`). In dev, Nitro's devProxy forwards `/api/**` (and `/s/**`) to the Go backend. In prod, both sit behind one reverse proxy (or Nitro's `routeRules["/api/**"]` proxy).

**Production image**: a single unified image (root `Dockerfile`, published as `ghcr.io/rustyguts/alcoves`) bundles the Go API/worker binary, a stdio MCP binary (`/alcoves-mcp`), and the Nuxt/Nitro frontend (via a copied Bun binary + `.output`). Its entrypoint (`docker/entrypoint.sh`) supervises both processes; a role arg (`all` default | `web` | `api` | `worker`) lets the same image run the whole stack or one role. `tini` is PID 1; unknown role → exit 64. The Helm chart's three workloads (`frontend`/`api`/`worker`) all pull this one image and set `args` to pick a role. Dev uses the two-service `docker-compose.yml` with `frontend/Dockerfile.dev` (hot reload) — only production packaging is unified.

## Core Commands

### Frontend (run from `frontend/` directory)

- `bun install` — installs with hoisted linker (see `bunfig.toml`; avoids a Nitro symlink-loop ELOOP bug); `postinstall` runs `nuxt prepare`
- `bun run dev` — Start Nuxt dev server on :3000; Nitro proxies `/api/**` + `/s/**` to the Go backend
- `bun run build` — Build production Nitro server (writes `.output/`)
- `bun run preview` — Serve the built server (`nuxt preview`)
- `bun run typecheck` — `nuxt typecheck` (vue-tsc against generated types)
- `bun run lint` / `bun run lint:fix` — OXlint (no-fix / `--fix`)
- `bun run fmt` / `bun run fmt:check` — OXfmt (100-char, tabs)
- `bun run test:unit` — Vitest unit tests once (`vitest run`, Nuxt test env)
- `bun run test:unit:coverage` — Unit tests with V8 coverage
- `bun run test:e2e` — Playwright e2e (`playwright test`); `test:e2e:flow`, `test:e2e:screenshots` (`@screenshot`), `test:e2e:headed`, `test:e2e:report` are scoped variants
- `bun run test` — Full suite: `test:unit:coverage` then `test:e2e`
- `bun run coverage:summary` — Print coverage summary from JSON artifact

Run a single unit test file or pattern:
```bash
bun run test:unit test/composables/useApiFetch.spec.ts
bun run test:unit -- --reporter=verbose -t "pattern"
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
docker compose up                       # postgres + dragonfly + backend (Air) + frontend (bun dev)
docker compose up -d postgres dragonfly # Infrastructure only
docker compose down -v                  # Drop the postgres_data volume (full reset, re-seeds)
```

Ports: frontend :3000, backend :3001, postgres :5432, **Dragonfly published on host :6389 → container :6379**. The backend service sets `ALCOVES_QUEUE_PORT=6379` (in-container); the config default when the env var is absent is `6389`. The frontend container runs `bun install` at startup because the named `frontend_node_modules` volume starts empty.

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

### Frontend (`frontend/`)

- Nuxt 4, `srcDir: 'app'` (default). Config in `nuxt.config.ts`: modules `@nuxt/ui` (pulls Tailwind 4) + `@sentry/nuxt/module`; `nitro.preset: "bun"`; Vidstack via `media-*` custom elements + `vite.plugins`.
- **`routeRules`:** `/api/**` → proxy to `${apiTarget}/api/**`; `/**` → `{ ssr: false }` (client-render all); `/s/**` → `{ ssr: true }` (public share pages need OG/SEO meta). `Document-Policy: js-profiling` header is for Sentry profiling.
- **Nitro devProxy:** `/api` → `${apiTarget}/api` (`changeOrigin`, `ws: true`); `icon.localApiEndpoint: "/_nuxt_icon"` to avoid the backend proxy capturing it.
- **`bunfig.toml`** sets `linker = "hoisted"` — Bun's default symlink layout self-references `vue`/`@vue/server-renderer` and triggers Node `ELOOP` during Nitro's dependency-trace at `nuxt build`. Removing it breaks the build.
- `app/pages/` — file-based routes; dynamic segments `[id]`, `[token]`, `[fileId]`, `[personId]`.
  - `libraries/[id]/index.vue` — browser, aliased to `/libraries/:id/trash`; sub-pages `feed`, `map`, `objects`, `tags`, `timeline`, `settings`, `people/`, `edit/[fileId]` (video editor)
  - `s/[token].vue` — public moment share landing (SSR, `layout: false`, OG via `useSeoMeta`)
  - `admin/index.vue` + `admin/jobs.vue` — owner-only; `invites/[token].vue` — public
- `app/layouts/dashboard.vue` — authenticated shell (sidebar, search, `NotificationBell`, avatar menu); `app/layouts/library.vue` — nested layout (wraps `dashboard`, fetches the library, `provide()`s `libraryId`/`library`/`refreshLibrary`/`canManageLibrary`, renders `LibraryHeader` + `LibraryTabs` + `<slot>`).
- `app/middleware/auth.global.ts` — runs every navigation; skips `/login`, `/register`, `/s/**`, `/invites/**`; lazily `fetchSession()`; redirects unauth → `/login?redirect=…`; gates `/admin*` to owners. Destructures `{ loggedIn, user, fetchSession }` from `useAuth()`.
- `app/composables/` (auto-imported): `useAuth`, `useApiFetch`, `useLibraryExplorer`, `useUploadQueue` (TUS, endpoint `/api/tus`, concurrency 3), `useLibrariesList`, `useNotifications` + `useNotificationsSocket` (WS/SSE), plus per-feature hooks (`useLibraryPeople/Members/Moments/Feed/Timeline/Map/Tags/FolderPath/FolderActions`, `useTranscript`/`useTranscribeJob`, `useAudioDetections`/`useAudioDetectJob`, `useWaveform*`, `useHighlightFilters`, `useEditorHighlights`/`useEditorShortcuts`, `useMomentDownloads`, `useDownloadZip`, `useAsyncJobStatus`, `useFileDrop`, `useTheme`, `useToast`).
- `app/utils/api-fetch.ts` — isomorphic fetch. **SSR:** prepends `runtimeConfig.apiUrl` and forwards `Cookie` via `useRequestHeaders(["cookie"])`. **Client:** uses `runtimeConfig.public.apiOrigin` if set (direct to Go, bypasses the proxy — avoids Range-request mangling for video), else relative URLs through Nitro. Exports `apiFetch`, `apiUrl`, `ApiError` (with `.status`/`.data`).
- `app/api/index.ts` — typed API client (`api.auth.*`, `api.libraries.*`, …) built on `apiFetch`. `shared/types/api.ts` — response types, imported as `~~/shared/types/api`. `LibraryMap.client.vue` is client-only (Leaflet, no SSR).
- **Runtime config:** server-only `apiUrl`; `public.googleAuthEnabled`, `public.apiOrigin`, `public.sentry.dsn`, `public.mapTileUrl`/`mapTileAttribution`.

### Testing Conventions

**Frontend unit tests** (Vitest + `@nuxt/test-utils`, `environment: "nuxt"`, `vitest.config.ts` via `defineVitestConfig`):
- Test globs under `test/{components,composables,shared,utils,app,pages,layouts,router}/**/*.spec.ts`; setup in `test/setup.ts`.
- `test/setup.ts` stubs all Nuxt UI components by their **prefixed** names (`UButton`, `UModal`, …), plus `Teleport`/`Transition`/`NuxtLayout`/`NuxtPage`/`NuxtLink`. `localStorage`, `sessionStorage`, `navigator.clipboard`, `matchMedia` are shimmed there — **don't re-stub per file**.
- Mock `useToast` via `vi.mock("@nuxt/ui/composables/useToast")`.
- `#imports` mocks DO work inside the Nuxt test env.
- Coverage: V8, thresholds set low (25%) — signal, not gate; excludes `app/pages/libraries/**`.

**Frontend E2E** (Playwright, `test/e2e/`, `baseURL` :4173, sequential `workers: 1`):
- Playwright launches **two** processes: a mock backend (`test/e2e/helpers/mock-backend.mjs` on :3099) and `bun run dev --port 4173` pointed at it (`ALCOVES_API_URL=http://127.0.0.1:3099`).
- `/s/**` share pages fetch metadata **server-side** through Nitro, so `page.route()` browser mocks can't intercept them — the :3099 mock backend handles those.
- Flows in `test/e2e/flows/` (auth, library-browser, editor, people-objects, settings, modals, notifications, profile, responsive, search-invites, share, admin); `tus-upload.e2e.spec.ts` at the e2e root.

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

**Frontend (Nuxt):**

- `ALCOVES_API_URL` — Go backend URL for Nitro proxy / SSR calls (default `http://localhost:3001`); exposed as `runtimeConfig.apiUrl`
- `NITRO_HOST` / `NITRO_PORT` — bind address (default `0.0.0.0:3000`)
- `NUXT_PUBLIC_API_ORIGIN` — public API origin for browser binary streaming (bypasses the Nitro proxy)
- `NUXT_PUBLIC_SENTRY_DSN`, `NUXT_PUBLIC_MAP_TILE_URL`/`_ATTRIBUTION`; `SENTRY_AUTH_TOKEN`/`_ORG`/`_PROJECT_FRONTEND` (CI source-map upload)

See `.env.example` for the full list and defaults.

## Build, Deploy & CI

- **Root `Dockerfile`** — 4 stages: Go build (`golang:1.26-bookworm`, libvips/ffmpeg, ONNX Runtime v1.26.0, builds `/alcoves` + `/alcoves-mcp` with `CGO_ENABLED=1` and version ldflags), whisper.cpp build (`v1.8.4`, hardened x86 baseline `-march=x86-64-v3` / AVX-512 off), frontend build (`oven/bun:1`, `--frozen-lockfile`), and a `debian:bookworm-slim` runtime. Env defaults: `ALCOVES_MODE=all`, `NITRO_PORT=3000`, `PORT=3001`, `ALCOVES_API_URL=http://127.0.0.1:3001`. `EXPOSE 3000 3001`; `ENTRYPOINT tini -- /app/entrypoint.sh`; `CMD ["all"]`.
- **`docker/entrypoint.sh`** — role arg `all|web|api|worker`. Single roles `exec` directly (signals pass through). `all` supervises both processes, `trap`s `TERM`/`INT` to `SIGTERM` both children, `wait -n`, and exits non-zero on any child exit to force orchestrator restart.
- **Helm (`helm/alcoves/`)** — three Deployments off the one image with different `args`: `frontend` (`web`, :3000), `backend-api` (`api`, :3001), `backend-worker` (`worker`, no Service). Single RWX PVC at `/app/data` for `local` storage; chart does NOT deploy Postgres/Dragonfly. Shared backend env from `_envvars.tpl`.
- **CI (`.github/workflows/`)** — `ci.yml`: `backend-test` (`go test ./... -race -count=1 -p 1`), `unit-and-coverage` (lint + typecheck + vitest coverage), `e2e` (Playwright, 8-shard; runs against the mock backend only — no DB/queue service containers, browser cached). `build-images.yml` (reusable) builds + pushes to GHCR. `publish.yml` calls it on push/tags/release. `release-please.yml` runs release-please and, on release, re-publishes `X.Y.Z`/`X.Y` tags. `website.yml` builds + deploys the Starlight site.

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

1. **Run the targeted suite first.** Changed `frontend/app/` → `bun run test:unit -- <changed file paths>` + the matching `frontend/test/e2e/flows/` file if one exists. Changed `backend/` → `go test ./internal/<changed package>/...`. Don't claim done before this.
   - **Frontend changes MUST run the Playwright e2e suite before being marked done — non-negotiable, not "if one exists".** A change to a shared component/layout/composable can break a flow unrelated to your feature: e.g. adding a "Files" item to the shared sidebar nav broke `admin.e2e.spec.ts`, whose `getByText("Files")` then matched two elements (strict-mode violation). Run `bunx playwright test` broadly, not just the one flow you think you touched, and watch for cross-flow text-locator collisions when adding shared UI. If the full sweep crashes the dev server mid-run (`ERR_CONNECTION_REFUSED` cascade), re-run the affected flows per-file to get a clean signal; CI shards the suite so it stays stable there.
2. **Then run the full suite for the side you touched.** Frontend: `bun run typecheck && bun run lint && bun run test:unit && bunx playwright test` (all four exit 0). Backend: `go test ./... -race -count=1` (green).
3. **If a test fails, fix it before merge.** Either the test caught a real regression (fix the source) or it was wrong (update/delete in the same PR). **Never commit while ignoring a failure.** "Pre-existing failure, not mine" is how the suite rotted to 104 failures — if it failed during your run, you own quieting it (fix, update, delete, or `it.skip` with a comment + a `docs/internal/todos.md` entry).
4. **If you skip a test, leave a paper trail.** `it.skip` with a comment saying *why* and a `docs/internal/todos.md` link. Never silently delete coverage.
5. **Add tests for new behavior.** New composable, handler, util, or branch gets a test in the same PR. Bar: "would a future regression be caught?"
6. **For UI/frontend changes, also exercise the feature in a browser.** Type-check + tests verify code correctness, not feature correctness. Start `bun run dev`, click the golden path and a couple edge cases, watch for unrelated regressions before reporting done.

**Frontend mocking gotchas (read before writing a new test):**

- `useRoute` / `useRouter` auto-import from `#app/composables/router`, **not** `vue-router`. Mocking `vue-router` alone does **not** intercept Nuxt's auto-imports — avoid `useRoute`-dependent paths or wait for a proper Nuxt route mount helper (`docs/internal/todos.md`).
- When mocking `vue-router`, always spread `await importOriginal()` — partial mocks break Nuxt plugins needing `createWebHistory` / `router.beforeEach`.
- When mocking `~/utils/api-fetch`, return `apiUrl` and `ApiError` alongside `apiFetch` — many components import `apiUrl`; several use `ApiError` for narrowing. Missing exports surface as opaque vitest module errors.
- When mocking `~/composables/useAuth`, always include `{ loggedIn, user, fetchSession }` — the shape `auth.global.ts` destructures on every page mount. A partial shape crashes the middleware during app init.
- `localStorage`, `sessionStorage`, `navigator.clipboard`, and `<NuxtLayout>` are stubbed in `test/setup.ts` — don't re-stub them per file.

**Coverage targets (recommendations, not hard gates):**

- **No single file below 60%.** If a file you touch or add is under, add tests in the same PR or note the gap in `docs/internal/todos.md`. Applies to both `frontend/` and `backend/`.
- **Backend aims for 80% global** (`go test ./... -cover`); **frontend aims for 90% global** (Vitest summary). Aspirational, not CI gates — don't block a merge solely on the global number, but a change that lowers coverage should add tests.
- Frontend thresholds live in `frontend/vitest.config.ts` (report-only). Treat any backend package at `0.0%` with non-test source as a known gap (`docs/internal/todos.md`). Current known under-floor package: `objectdetection` (~56%).

## Engineering Guardrails

- Do not switch package manager (Bun) or lint/format stack (OXlint/OXfmt).
- Schema is **Goose-owned only** — never use GORM `AutoMigrate` in production paths.
- Use `bigint` for file sizes; never `integer` (PostgreSQL `integer` caps at ~2GB).
- Prefer adding/adjusting tests when behavior changes; run targeted tests first, broader suites second.
- Avoid destructive git commands and do not revert unrelated local changes.
- DOM / `window` / `localStorage` access in a new component or composable: guard with `import.meta.client` or wrap in `onMounted` — top-level SSR is on.

## Git commit authorship

- Commits are authored by the human (the configured `user.name` / `user.email`). Do **not** add `Co-Authored-By: Claude …` trailers or any other AI attribution. Don't append generator footers (e.g. "🤖 Generated with Claude Code"). The commit message is the message — nothing else.

## Lights Off Software Factory

When the user says "turn off the lights", follow the full workflow defined in [turn-off-the-lights.md](turn-off-the-lights.md).

## Known Gaps (verified against code)

- **S3 storage is not wired in `main.go`** — `ALCOVES_STORAGE_DRIVER=s3` and `ALCOVES_S3_*` are parsed into `Config`, but `main.go` always constructs `storage.NewLocalDriver()`. S3 is config-documented but not yet functional.
- **5 audio-tagger models** (`efficientat_mn04/mn40`, `ced_tiny/small/base`) are catalogued `Available: false` (weights not uploaded); selecting them falls back to `efficientat_mn10`.
- **`helm/alcoves/Chart.yaml`** `appVersion` and `home:` can drift from `VERSION` / the real repo URL — verify before relying on the default image tag.
