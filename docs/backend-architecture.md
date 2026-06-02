# Backend Architecture (Go / Echo / GORM / Asynq)

This document gives a contributor the mental model of the Alcoves Go backend:
how the process boots, how requests are authenticated and authorized, how
configuration flows in, how async media/ML jobs are modeled, and where to look
when extending each piece.

Alcoves is a self-hosted collaborative media library. The backend is a pure
JSON API (Echo) backed by PostgreSQL (GORM) and a Redis-compatible async job
queue (Asynq on Dragonfly). It serves no HTML — the Nuxt frontend is a separate
process that proxies `/api/**` and `/s/**` to this service.

---

## Module and key dependencies

Module path: `github.com/alcoves/alcoves-backend` (`backend/go.mod`, `go 1.26`).

| Dependency | Version | Role |
|---|---|---|
| `github.com/labstack/echo/v4` | v4.15.0 | HTTP framework, routing, middleware |
| `gorm.io/gorm` + `gorm.io/driver/postgres` | v1.31.1 / v1.6.0 | ORM over PostgreSQL |
| `github.com/pressly/goose/v3` | v3.26.0 | SQL migrations (embedded, run at startup) |
| `github.com/hibiken/asynq` | v0.26.0 | Redis-backed async job queue + inspector |
| `github.com/redis/go-redis/v9` | v9.18.0 | Redis client (Asynq + activity pub/sub) |
| `github.com/davidbyttow/govips/v2` | v2.16.0 | libvips image processing (CGO) |
| `github.com/yalue/onnxruntime_go` | v1.26.0 | ONNX Runtime bindings (face/object/audio ML) |
| `golang.org/x/oauth2` | v0.35.0 | Google OAuth2 |
| `github.com/go-playground/validator/v10` | v10.30.1 | Struct/request validation |
| `github.com/coder/websocket` | v1.8.12 | WebSocket (activity hub / notifications) |
| `github.com/google/uuid` | v1.6.0 | UUID generation |
| `golang.org/x/crypto` | v0.48.0 | bcrypt + AES-GCM |
| `github.com/alicebob/miniredis/v2` | v2.36.1 | In-process Redis for tests |

Native runtime dependencies (provided by the Docker image): libvips, ffmpeg,
ONNX Runtime shared library, and the `whisper-cli` binary from whisper.cpp.

---

## Startup sequence (`backend/cmd/server/main.go`)

The entire process is wired in `main.go` in strict dependency order. A
contributor adding a service or route will edit this file.

1. **`config.Load()`** — read and validate all `ALCOVES_*` env vars into a flat
   `*config.Config`. Fatal if `ALCOVES_SESSION_SECRET` is missing (the only
   hard-required field).
2. **`database.Connect(cfg.DatabaseURL)`** — open the GORM Postgres connection.
   Pool config: `MaxOpenConns=25`, `MaxIdleConns=5`, log level `Warn`, and
   `DisableForeignKeyConstraintWhenMigrating: true` (GORM never touches FK
   constraints — schema is owned entirely by Goose SQL migrations).
3. **`database.RunMigrations(sqlDB)`** — apply all pending Goose migrations from
   the embedded `migrations.FS` before any handler is registered. Fatal on
   failure. This is why a rolling deploy of a new image auto-applies schema
   changes on the api pod.
4. **Service construction (dependency order):**
   - `authservice.NewService(db, cfg.SessionSecret)` — AES-GCM cookie crypto
   - `access.NewService(db)` — library RBAC
   - `files.NewService(db)` — paginated listing
   - `settings.NewService(db)` — single-row `app_settings` cache
   - `storage.NewLocalDriver(...)` → `storage.NewService(...)` → `EnsureReady()`
   - Asynq `*Client` + `*Inspector` (connected to `QueueHost:QueuePort`)
   - `activity.NewBus(redis)` (cross-process pub/sub) and `activity.NewHub()`
     (in-process WebSocket fan-out; not created in `worker` mode)
   - `activity.NewService(db, hub, bus)`
   - ML/media services: `facedetection`, `objectdetection`, `videoproxy`,
     `transcribe`, `audiodetection`, `waveform`, `momentexport`, `filehash`,
     `imageproxy` — each takes `db`, `storageSvc`, the Asynq client, and config.
5. **ONNX model pre-fetch goroutine** (`mode=all|worker`): calls
   `faceSvc.EnsureModels()` and `objSvc.EnsureModels()` in the background.
   Non-fatal — logs a warning on failure; the first job then blocks while it
   lazily downloads the model.
6. **Asynq worker goroutine** (`mode=all|worker`): concurrency 8, queue
   priorities `imageproxy:10 >> default:1` (interactive image transforms
   preempt batch ML work). Full handler registration table:

   | Task type constant | Handler |
   |---|---|
   | `imageproxy.TaskTypeImageProxy` (`image:proxy`) | `imgSvc.NewTaskHandler().ProcessTask` |
   | `facedetection.TaskTypeFaceDetect` (`face:detect`) | `faceSvc...ProcessTask` |
   | `objectdetection.TaskTypeObjectDetect` (`object:detect`) | `objSvc...ProcessTask` |
   | `videoproxy.TaskTypeVideoProxy` (`video:proxy`) | `videoTaskHandler.ProcessTask` |
   | `videoproxy.TaskTypeVideoThumb` (`video:thumbnail`) | `videoTaskHandler.ProcessThumbnailTask` |
   | `filehash.TaskTypeFileHash` (`file:hash`) | `hashSvc...ProcessTask` |
   | `momentexport.TaskTypeMomentExport` (`moment:export`) | `momentExportSvc...ProcessTask` |
   | `transcribe.TaskTypeTranscribe` (`file:transcribe`) | `transcribeSvc...ProcessTask` |
   | `audiodetection.TaskTypeAudioDetect` (`file:audio-detect`) | `audioDetectSvc...ProcessTask` |
   | `waveform.TaskTypeWaveform` (`file:waveform`) | `waveformSvc...ProcessTask` |

7. **Echo setup:** `HideBanner = true`, `e.Validator = handlers.NewValidator()`,
   and the global middleware chain in order: `Logger()`, `Recover()`, CORS
   (allowlist), `AuthMiddleware`, `LibraryAccessMiddleware`.
8. **Route registration** (skipped entirely when `mode=worker`): all handlers
   register under the `/api` group via their `RegisterRoutes` method.
9. **`GET /api/health`** — always registered. Returns `{"status":"ok","mode":"<mode>"}`.
10. **`GET /api/version`** — always registered, public. Returns
    `{version, commit, buildTime, dirty, mode}`.
11. **Activity bus goroutine:** `activityBus.Run(ctx, activityHub)` subscribes to
    Redis pub/sub and fans messages out to the in-process WebSocket hub.
12. **Graceful shutdown** on `os.Interrupt`: `asynqServer.Shutdown()` then
    `e.Shutdown()` with a 10-second timeout.

---

## Runtime modes (`ALCOVES_MODE`)

A single binary, three behaviors selected at boot:

| Mode | HTTP routes | Asynq worker | Activity hub (WS) | Use |
|---|---|---|---|---|
| `all` (default) | yes | yes | yes | Single-node / dev |
| `api` | yes | no | yes | HTTP front, scale separately |
| `worker` | health + version only | yes | no | CPU/RAM-heavy jobs (ffmpeg, whisper, ONNX) |

In Kubernetes the chart runs `backend-api` (`api`) and `backend-worker`
(`worker`) from the same image against the same database, queue, and shared
storage. The worker deployment runs with **no CPU limit** because whisper.cpp +
ffmpeg + ONNX are bursty and CFS throttling hurts latency more than it helps.

---

## Configuration (`backend/internal/config/config.go`)

`Config` is a flat value struct loaded once via `Load() (*Config, error)`.
`getEnv` treats empty-string values as unset; `parseCommaList` trims and
de-blanks comma lists (used for extra CORS origins). Grouped surface:

- **Server / mode / env:** `PORT` (3000), `ALCOVES_MODE` (`all|api|worker`),
  `ALCOVES_ENV` (`development`).
- **Database:** `ALCOVES_DATABASE_URL`.
- **Session:** `ALCOVES_SESSION_SECRET` — **required, ≥32 chars**; the only field
  whose absence aborts startup. SHA-256'd to a 32-byte AES key.
- **Storage:** `ALCOVES_STORAGE_DRIVER` (`local|s3`), `ALCOVES_STORAGE_PATH`
  (`{path}/files`), `ALCOVES_AVATAR_STORAGE_PATH`, `ALCOVES_CACHE_STORAGE_PATH`,
  plus the full `ALCOVES_S3_*` set (bucket/region/endpoint/keys/prefixes/path-style).
- **Queue/Redis:** `ALCOVES_QUEUE_HOST`, `ALCOVES_QUEUE_PORT`, `ALCOVES_QUEUE_PASSWORD`.
- **OAuth:** `ALCOVES_OAUTH_GOOGLE_CLIENT_ID/SECRET`. `GoogleAuthEnabled` is
  auto-derived from a non-empty client ID.
- **CORS:** `ALCOVES_BASE_URL` (derives the primary allowed origin),
  `ALCOVES_EXTRA_CORS_ORIGINS` (comma list). See `buildCORSOrigins` below.
- **Face detection:** `ALCOVES_FACE_DETECTION_MIN_SCORE`,
  `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE`,
  `ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP`,
  `ALCOVES_FACE_RECOGNITION_MIN_FACES`, `ALCOVES_MODELS_PATH`.
- **Object detection:** `ALCOVES_OBJECT_DETECTION_MIN_SCORE`,
  `ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS`,
  `ALCOVES_OBJECT_DETECTION_NMS_THRESHOLD`.
- **Audio detection:** `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL`,
  `ALCOVES_AUDIO_DETECT_LABELS_URL`, `ALCOVES_AUDIO_DETECT_WINDOW_SEC` (10.0),
  `ALCOVES_AUDIO_DETECT_THRESHOLD` (0.2), `ALCOVES_AUDIO_DETECT_TOP_K` (5).
- **Whisper transcription:** `ALCOVES_WHISPER_BINARY` (`whisper-cli`),
  `ALCOVES_WHISPER_MODEL` (`large-v3`), `ALCOVES_WHISPER_LANGUAGE` (`auto`),
  `ALCOVES_WHISPER_VAD_MODEL` (`silero-v6.2.0`), `ALCOVES_WHISPER_MODELS_DIR`,
  `ALCOVES_WHISPER_MODEL_BASE_URL`, `ALCOVES_FFMPEG_BINARY` (`ffmpeg`).

Inference model selections (whisper model/language, audio-detect model) are
**boot-time fallbacks only** — the admin UI overrides them at runtime via the
`app_settings` table; the worker reads admin settings first and falls back to
env on fresh installs.

### CORS construction (`buildCORSOrigins`)

A strict allowlist, never a reflecting wildcard (required because
`AllowCredentials: true`):
- Always includes the scheme+host of `cfg.BaseURL` (path stripped).
- Appends every entry from `cfg.ExtraCORSOrigins`.
- In `development`, adds `http://localhost:3000` and `http://localhost:5173`.
- De-duplicates the final list.

---

## Global middleware

Two custom middlewares are registered globally, after Echo's `Logger`,
`Recover`, and CORS.

### Auth (`backend/internal/middleware/auth.go`)

`AuthMiddleware(authSvc)` runs on every request and calls `needsAuth(path)` to
decide enforcement. **Public (no session required):**
- any non-`/api/` path
- `/api/auth/{login,register,providers,logout,google,google/callback}`
- `/api/_auth/session`, `/api/health`, `/api/version`, `/api/_meta/**`
- `/api/invites/{token}` (GET token lookup only; the POST `.../accept` is
  enforced inside the handler via `RequireUserID`)
- `/api/share/**` (public moment share)

On a protected path it calls `authSvc.GetUserBySession(c)`; failure → `401`.
On success it sets three context keys:
- `ContextKeyUserID = "userId"` (string UUID)
- `ContextKeyUser = "user"` (`*models.User`)
- `ContextKeySessionToken = "sessionToken"`

Helpers: `GetUserID(c) uuid.UUID` (parses the context value, `uuid.Nil` on
failure) and `RequireUserID(c) (uuid.UUID, error)` (returns a `401` echo error
when nil).

### Library access (`backend/internal/middleware/library_access.go`)

`LibraryAccessMiddleware(accessSvc)` activates only for paths shaped like
`/api/libraries/{id}/...`. It parses the library UUID from `parts[2]` (`400` on
parse failure), requires an authenticated user (`401` if nil), then gates by
**HTTP method**:
- `GET`/`HEAD`/`OPTIONS` → `RequireLibraryAccess` (viewer or above)
- `POST`/`PUT`/`PATCH`/`DELETE` → `RequireLibraryAdmin` (admin or owner)

On success it sets `c.Set("libraryAccess", *access.LibraryAccess)`, which
handlers read via `GetLibraryAccess(c)`. The `access.LibraryAccess` struct
carries `LibraryID`, `LibraryName`, `OwnerID`, `IsDefault`, `Role`, `IsOwner`,
`IsAdmin`. The `readMethods` map (`GET/HEAD/OPTIONS`) drives the write-guard.

RBAC rules (in `services/access`): the library owner is always `RoleOwner`
(`IsOwner` + `IsAdmin`); default/personal libraries are never collaborative
(non-owners always resolve to `nil`); collaborative members get their role from
`library_members.role`. Admin-only mutations on collaborative libraries use
`RequireCollaborativeLibraryAdmin`, which additionally `400`s on default
libraries.

> Endpoints that live outside `/api/libraries/*` but still need library scoping
> (e.g. `FileProxyHandler.Serve` at `/api/files/proxy/*`) call
> `access.NewService(db).GetLibraryAccess` directly and return **404** (not 403)
> to non-members to avoid library enumeration.

---

## Request validation (`backend/internal/handlers/validator.go`)

`CustomValidator` wraps `go-playground/validator/v10` and is installed on every
Echo instance (`e.Validator = handlers.NewValidator()`). `Validate(i)` converts
`validator.ValidationErrors` into a `*echo.HTTPError(400)` with a human-readable
message. Active tags: `required`, `email`, `min`, `oneof`. Handlers bind a
request struct and call `c.Validate(&req)` before touching the DB.

---

## Version embedding (`backend/internal/version/version.go`)

Build metadata is injected via ldflags and exposed at `GET /api/version`.

- `App()` → `appVersion` ldflag, or `"dev"` when unset.
- `Commit()` → git SHA ldflag, falling back to `runtime/debug.ReadBuildInfo()`
  `vcs.revision`.
- `BuildTime()` → RFC 3339 ldflag, falling back to `vcs.time`.
- `Dirty()` → `vcs.modified` from build info.

Resolution is memoized with `sync.Once`. The Docker build passes
`-X ...version.appVersion=$(cat VERSION)` (plus commit/buildTime). A local
`go run` therefore reports `"version":"dev"`; CI/Docker reports the real
`0.x.y`. (The Dockerfile mounts `.git` so the VCS stamp resolves even without
explicit ldflags.)

---

## Route-group map

Registered in `main.go` (omitted entirely in `worker` mode except health and
version):

| Route group | Handler(s) | Notes |
|---|---|---|
| `GET /api/health` | inline | always on |
| `GET /api/version` | inline | always on, public |
| `/api/auth/**` | `AuthHandler`, `OAuthHandler`, `AvatarHandler` | login, register, logout, providers, me, sessions, Google OAuth, avatar |
| `/api/_auth/session` | `AuthHandler` | session validation for the Nuxt guard, no auth |
| `/api/libraries` | `LibraryHandler` | library CRUD |
| `/api/libraries/:id/**` | `FileHandler`, `FolderHandler`, `TagHandler`, `HighlightFilterHandler`, `MomentHandler`, `MemberHandler`, `PeopleHandler`, `ObjectsHandler`, `DownloadHandler`, `NotificationsHandler` | library-scoped resources + feed |
| `/api/invites/**` | `InviteHandler` | invite lookup (public GET) + accept |
| `/api/notifications/**`, `/api/ws` | `NotificationsHandler` | global bell feed, dismiss, WebSocket |
| `/api/search` | `SearchHandler` | cross-library search |
| `/api/admin/**` | `AdminHandler` + `AdminJobsHandler` | owner-gated admin + Asynq dashboard |
| `/api/_meta/registration-mode` | inline | public registration mode |
| `/api/tus/**` | `TusHandler` | TUS resumable uploads (admin-gated per library) |
| `/api/files/proxy/**` | `FileProxyHandler` | authenticated image transform / file serve |
| `/api/share/:token/**` | `ShareHandler` | public moment share, no auth |

---

## The handler pattern

Every handler in `backend/internal/handlers/` follows the same shape:

1. A struct holding injected dependencies (db, services), constructed in
   `main.go`.
2. A `RegisterRoutes(g *echo.Group)` method (some also expose
   `RegisterGlobalRoutes` / `RegisterLibraryRoutes`) that binds methods to paths.
3. Individual handler funcs that read auth context via
   `middleware.GetUserID(c)` / `middleware.RequireUserID(c)` /
   `middleware.GetLibraryAccess(c)`, bind+validate the request, call services,
   and serialize a response.

Owner-only admin routes layer an extra guard: `AdminHandler` exposes
`RequireOwnerMiddleware()` (a DB lookup of `users.role == "owner"`, `403`
otherwise) which is applied to both the admin handler group and the
`AdminJobsHandler` job-queue routes.

Services under `backend/internal/services/` contain the business logic and
expose no HTTP routes of their own — they are injected into handlers and the
Asynq mux.

---

## Async-job model

Media/ML processing is modeled as a uniform state machine stored on the row
being processed. The columns repeat per job type on `files` (`proxy`,
`transcribe`, `audio_detect`, `waveform`) and on `moments` (`export`):

- `<job>_status` — `queued | processing | ready | not_needed | failed`
- `<job>_progress` (int, 0–100) and `<job>_eta_seconds` (nullable)
- `<job>_error` (nullable) for the failure reason
- `<job>_version` / `<job>ed_version` (or `exported_version`) — the optimistic
  versioning pair

### Versioning, idempotency, and re-triggering

- **Idempotency:** stateless detectors skip already-processed inputs
  (`face:detect` / `object:detect` skip files that already have detection rows;
  `file:hash` skips files whose `hash` is non-null; `video:proxy` skips
  `proxy_status="ready"`).
- **Version-bump re-trigger:** to force a re-run, callers increment
  `<job>_version`. The worker captures the target version at job start, writes
  `<job>ed_version = target` (or `target+1`) on completion, and re-checks the
  row before persisting. If `version` changed mid-flight (the user edited the
  moment's time range, or replaced the file during a waveform encode), the stale
  result is discarded silently. This is the core of moment export's optimistic
  concurrency: each edit bumps `export_version`, output is written to a
  **version-stamped cache key** (`{lib}/moments/{moment}/v{version}.mp4`), and
  old exports survive until a new encode succeeds.
- **Audio detection** additionally enqueues with `asynq.Unique(2h)` to dedupe
  double-clicks and replaces detections transactionally (DELETE + bulk INSERT)
  to avoid a torn read.
- **Image proxy** is the only inline-capable job: it coordinates worker results
  over Redis pub/sub (`imageproxy:done:{key}`) and falls back to synchronous
  `processor.Transform` when no Asynq/Redis client is configured (dev/test).

Activity events (`activity.ActionSystem*`) are emitted as best-effort
fire-and-forget notifications when proxy/waveform/transcribe jobs complete; the
durable record is the DB row, and clients re-fetch over HTTP on reconnect.

---

## Data layer

- **Connection:** `database.Connect` (pool tuning +
  `DisableForeignKeyConstraintWhenMigrating`).
- **Migrations:** `database.RunMigrations` runs Goose against `migrations.FS`
  (`backend/migrations/embed.go`, `//go:embed *.sql`). Migration `00001`
  bootstraps the schema and the pgvector extension; later migrations add per-job
  status columns, moments/shares, the invites overhaul, the activity feed, and
  the pgvector HNSW index (`00019`, which uses `-- +goose NO TRANSACTION` for
  `CREATE INDEX CONCURRENTLY`).
- **Models:** `backend/internal/models/models.go` — all PKs are `uuid.UUID` with
  `gen_random_uuid()` defaults and `BeforeCreate` hooks. `files.size` is
  `bigint` (file sizes exceed the ~2 GB `integer` max). `users.password_hash`
  and `notifications_cleared_before` are `json:"-"`. The 512-dim
  `face_detections.embedding vector(512)` column is **not** in the GORM struct —
  it is written/queried via raw SQL with `$N::vector` casts.

---

## Related code

- Entry point / wiring: `backend/cmd/server/main.go`
- Configuration: `backend/internal/config/config.go`
- DB connect + migrations: `backend/internal/database/database.go`,
  `backend/internal/database/migrate.go`, `backend/migrations/`
- GORM models: `backend/internal/models/models.go`
- Middleware: `backend/internal/middleware/auth.go`,
  `backend/internal/middleware/library_access.go`
- Validator: `backend/internal/handlers/validator.go`
- Version: `backend/internal/version/version.go`
- Handlers: `backend/internal/handlers/*.go`
- Services (business logic + Asynq workers): `backend/internal/services/*`
- Module/deps: `backend/go.mod`
