---
title: "Backend architecture"
description: "How the Go API server boots, handles requests, manages async jobs, and is extended — for contributors and operators."
---

The Alcoves backend is a pure JSON API written in Go. It runs as a single binary
against PostgreSQL, a Dragonfly/Redis-compatible queue, and local blob storage
(an S3 driver exists in the codebase but is not wired up yet). It serves no
HTML — the SvelteKit frontend is a separate process that renders the UI and
proxies same-origin `/api/**` requests to this service.

If you are contributing a new feature, adding a service, or debugging a
production issue, this page gives you the mental model you need: how the process
boots, how auth and library access are enforced before your handler runs, how
async work is queued and tracked, and where the extension points are.

For the overall system topology, see [Architecture](/architecture/overview/).
For environment variables and operator configuration, see
[Configuration](/getting-started/configuration/).

---

## Key dependencies

| Library | Role |
|---|---|
| Echo v4 | HTTP framework, routing, middleware |
| GORM + `gorm.io/driver/postgres` | ORM over PostgreSQL |
| Goose v3 | SQL migrations (embedded, applied at startup) |
| Asynq | Redis-backed async job queue and inspector UI |
| govips (libvips) | Image processing (CGO) |
| onnxruntime_go | CPU-only ONNX Runtime bindings for face, object, and audio ML |
| golang.org/x/oauth2 | Google OAuth2 |
| coder/websocket | WebSocket for the real-time activity feed |
| miniredis v2 | In-process Redis for tests |

Native dependencies shipped in the Docker image: **libvips**, **ffmpeg**, the
**ONNX Runtime shared library**, and the **whisper-cli** binary from
whisper.cpp.

---

## Startup sequence

The entire process is wired in strict dependency order in `backend/cmd/server/main.go`.
A contributor adding a new service or route edits this file.

1. **Load config** — read and validate all `ALCOVES_*` environment variables.
   Startup aborts immediately if `ALCOVES_SESSION_SECRET` is missing; it is the
   only required field.

2. **Connect to the database** — open the GORM PostgreSQL connection with a
   bounded connection pool (`MaxOpenConns=25`, `MaxIdleConns=5`). GORM never
   manages foreign-key constraints; the schema is owned entirely by Goose
   migrations.

3. **Apply migrations** — run all pending Goose SQL migrations from the embedded
   `migrations.FS` before any handler is registered. Startup aborts on failure.
   This is what makes a rolling Kubernetes deployment auto-apply schema changes:
   the first api pod to start applies the migration; later pods see it as
   already applied.

4. **Construct services** — in dependency order:
   - Auth service (AES-GCM cookie crypto)
   - Library access service (RBAC)
   - Files service, settings service (single-row `app_settings` cache)
   - Storage driver + service
   - Asynq client and inspector
   - Activity bus (Redis pub/sub) and activity hub (in-process WebSocket fan-out)
   - All media and ML services: face detection, object detection, video proxy,
     transcription, audio detection, waveform, moment export, file hashing, image
     proxy

5. **Pre-fetch ONNX models** (`mode=all|worker`) — a background goroutine calls
   `EnsureModels` for face and object detection. Non-fatal: logs a warning on
   failure and the first job will block while the model downloads lazily.

6. **Start the Asynq worker** (`mode=all|worker`) — concurrency 8, with
   per-job-type queue priorities (weighted by importance ÷ complexity) that let
   interactive image-transform requests preempt batch ML work and keep the
   heavy long-runners (video transcode, whisper transcription) from starving
   fast jobs like thumbnailing.

7. **Configure Echo** — install the custom validator, then the global middleware
   chain: logger, recover, CORS (strict allowlist, never a wildcard), auth
   middleware, library access middleware.

8. **Register routes** — skipped entirely in `worker` mode. All handlers
   register under `/api` via their `RegisterRoutes` method.

9. **Start the activity bus goroutine** — subscribes to Redis pub/sub and fans
   messages out to the in-process WebSocket hub.

10. **Listen and graceful shutdown** — on interrupt, the Asynq server shuts
    down first, then Echo with a 10-second timeout.

---

## Runtime modes

A single binary, three behaviors selected by the `ALCOVES_MODE` environment
variable:

| Mode | HTTP routes | Asynq worker | Activity hub | Typical use |
|---|---|---|---|---|
| `all` (default) | yes | yes | yes | Single-node, local dev |
| `api` | yes | no | yes | Horizontally-scaled request path |
| `worker` | health + version only | yes | no | CPU/RAM-heavy background jobs |

In Kubernetes the Helm chart runs `backend-api` and `backend-worker` as
separate deployments from the same image, against the same database, queue, and
shared storage. The worker deployment intentionally has **no CPU limit** —
whisper.cpp, ffmpeg, and ONNX are bursty; CFS throttling hurts throughput more
than it protects the cluster.

:::tip
You can run `ALCOVES_MODE=worker` on a separate, more powerful machine while
`ALCOVES_MODE=api` handles the web traffic on lighter hardware. Both connect to
the same PostgreSQL and Dragonfly instances.
:::

---

## Configuration

Config is loaded once at startup into a flat struct via `ALCOVES_*` environment
variables. The only required field is `ALCOVES_SESSION_SECRET` (≥ 32 bytes; used
as the AES-GCM key for encrypted session cookies).

Beyond the core server and database settings covered in
[Configuration](/getting-started/configuration/), the backend exposes tuning
knobs for each ML pipeline:

**Face detection / recognition**

| Variable | Description |
|---|---|
| `ALCOVES_FACE_DETECTION_MIN_SCORE` | Minimum confidence to keep a detected face |
| `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE` | Maximum embedding distance for cluster assignment |
| `ALCOVES_FACE_RECOGNITION_MIN_FACES` | Minimum faces before a cluster becomes a named person |
| `ALCOVES_MODELS_PATH` | Directory where ONNX model files are stored |

**Object detection**

| Variable | Description |
|---|---|
| `ALCOVES_OBJECT_DETECTION_MIN_SCORE` | Minimum confidence threshold |
| `ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS` | Cap on detections per image |
| `ALCOVES_OBJECT_DETECTION_NMS_THRESHOLD` | Non-maximum suppression threshold |

**Whisper transcription**

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_WHISPER_BINARY` | `whisper-cli` | Path to the whisper.cpp CLI binary |
| `ALCOVES_WHISPER_MODEL` | `large-v3` | Default model (overridable in admin UI) |
| `ALCOVES_WHISPER_LANGUAGE` | `auto` | Transcription language |
| `ALCOVES_WHISPER_VAD_MODEL` | `silero-v6.2.0` | Voice-activity-detection model |

**Audio event detection**

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_AUDIO_DETECT_WINDOW_SEC` | `10.0` | Analysis window in seconds |
| `ALCOVES_AUDIO_DETECT_THRESHOLD` | `0.2` | Minimum confidence to record an audio tag |
| `ALCOVES_AUDIO_DETECT_TOP_K` | `5` | Number of top events to retain per window |

:::note
ML model selection (whisper model, audio-detect model) can be changed at
runtime from the admin UI. The environment variables are boot-time fallbacks
only — the `app_settings` table takes precedence when set.
:::

### CORS

The backend builds a strict allowlist; it never reflects a wildcard origin
(required because credentials are attached). The allowlist always includes
the scheme + host from `ALCOVES_BASE_URL`, any entries in
`ALCOVES_EXTRA_CORS_ORIGINS` (comma-separated), and in development mode it also
allows `localhost:3000` and `localhost:5173`.

---

## Global middleware

Two custom middlewares run after Echo's built-in logger, recover, and CORS.

### Auth middleware

Runs on every request. Decides whether the path requires an authenticated
session:

**Public paths (no session required):**
- `/api/auth/{login,register,providers,logout,google,google/callback}`
- `/api/_auth/session` (used by the SvelteKit server to resolve the signed-in user)
- `/api/share/**` (public moment share)
- `/api/health`, `/api/version`, `/api/_meta/**`
- `GET /api/invites/{token}` (invite lookup; the accept POST is guarded inside
  the handler)

For all other `/api/**` paths the middleware validates the encrypted session
cookie. On failure it returns `401`. On success it sets the authenticated user
and session token into the request context so handlers can read them without
touching the session layer again.

### Library access middleware

Activates only for paths shaped like `/api/libraries/{id}/...`. It parses the
library UUID, requires an authenticated user, then gates by HTTP method:

- `GET` / `HEAD` / `OPTIONS` — viewer role or above is sufficient
- `POST` / `PUT` / `PATCH` / `DELETE` — admin or owner role required

The resolved access record (library ID, name, owner, role, `IsOwner`, `IsAdmin`)
is placed in the request context for handlers to read.

RBAC rules:
- The library owner always has the owner role.
- Default (personal) libraries are never collaborative — non-owners always
  resolve to no access.
- Collaborative library members get the role stored in `library_members`.
- Mutations that only make sense on a collaborative library (e.g. managing
  members) additionally reject calls against personal libraries.

Endpoints outside `/api/libraries/*` that still need library scoping (such as
the image/file proxy) call the access service directly and return **404** (not
403) to non-members to avoid leaking that a library exists at all.

---

## Route map

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check — always available, always public |
| `GET /api/version` | Build version, commit SHA, build time |
| `/api/auth/**` | Login, register, logout, session, avatar, Google OAuth |
| `/api/_auth/session` | Session resolution for the SvelteKit server hooks |
| `/api/libraries` | Library CRUD |
| `/api/libraries/:id/**` | Files, folders, tags, moments, members, people, objects, downloads, notifications |
| `/api/invites/**` | Invite lookup (public GET) and accept |
| `/api/notifications/**`, `/api/ws` | Global notification feed, dismiss, WebSocket |
| `/api/search` | Cross-library full-text search |
| `/api/admin/**` | Owner-gated admin panel and Asynq job-queue dashboard |
| `/api/tus/**` | TUS resumable uploads |
| `/api/files/proxy/**` | Authenticated image transform and file serve |
| `/api/share/:token/**` | Public moment share — no auth, used for OG embeds |

Routes in the `worker` mode are limited to `/api/health` and `/api/version`.

---

## Handler pattern

Every handler in `backend/internal/handlers/` follows the same shape:

1. A struct holding injected services, constructed in `main.go`.
2. A `RegisterRoutes(g *echo.Group)` method that binds methods to paths.
3. Individual handler functions that read auth context, bind and validate the
   request body, call services, and serialize a JSON response.

Admin routes layer an extra ownership guard: a middleware checks that the
authenticated user has the owner role and returns `403` otherwise. This guard
wraps both the admin panel and the job-queue dashboard.

Services in `backend/internal/services/` contain all business logic and expose
no HTTP routes. They are injected into handlers and into the Asynq worker mux.

---

## Async job model

Media and ML processing never blocks a request. When a file is uploaded, or a
moment's time range is edited, the API enqueues a job and returns immediately.
Status, progress, and results are stored as columns on the affected row and
polled by the frontend.

### Job state machine

Each job type tracks five fields on the row being processed:

| Column | Values |
|---|---|
| `<job>_status` | `queued`, `processing`, `ready`, `not_needed`, `failed` |
| `<job>_progress` | 0–100 |
| `<job>_eta_seconds` | nullable, estimated time remaining |
| `<job>_error` | nullable, failure reason |
| `<job>_version` / `<job>ed_version` | optimistic versioning pair |

Jobs tracked this way: `proxy`, `transcribe`, `audio_detect`, `waveform` (on
files) and `export` (on moments).

### Queue tasks

| Task | Queue | What it does |
|---|---|---|
| `image:proxy` | `imageproxy` | On-demand image transforms (resize, crop, format) |
| `file:metadata` | `metadata` | EXIF/GPS + ffprobe metadata extraction |
| `video:thumbnail` | `thumbnail` | Extracts a thumbnail from a video file |
| `file:hash` | `hash` | SHA-256 dedup hash |
| `moment:export` | `moment-export` | Exports a named moment clip to MP4 |
| `file:waveform` | `waveform` | Extracts and stores the audio waveform |
| `object:detect` | `object-detection` | COCO object detection for a file |
| `face:detect` | `face-detection` | Face detection and embedding for a file |
| `file:audio-detect` | `audio-detection` | AudioSet audio-event classification |
| `video:proxy` | `video-transcode` | Video transcoding to HLS/MP4 |
| `file:transcribe` | `transcription` | whisper.cpp speech transcription |
| `image:prewarm` | `maintenance` | Hourly pre-warm of every image-proxy variant |

The queue runs at concurrency 8. Each job type has its own queue, weighted by
**importance ÷ complexity** (see `internal/queues`): interactive image
transforms rank highest, fast post-upload derivations (metadata, thumbnails,
hashes) next, then ML inference, then the heavy long-runners (full video
transcode, whisper transcription) just above background maintenance. So a long
transcription or transcode job can never queue ahead of an interactive
thumbnail request — and, per the explicit priority intent, whisper sits *below*
thumbnailing.

### Idempotency and re-triggering

Jobs are designed to be re-enqueued safely:

- **Idempotency:** stateless detectors skip already-processed inputs. Face and
  object detection skip files that already have detection rows; file hashing
  skips files with a non-null hash; video proxy skips files already in `ready`
  status.

- **Version-bump re-trigger:** to force a re-run, callers increment
  `<job>_version`. The worker captures the target version at job start and
  discards the result if the version changed mid-flight (e.g. the user edited
  the moment's time range while the export was running). This is how moment
  export handles concurrent edits: each edit bumps `export_version`, and the
  output is written to a version-stamped cache key
  (`{lib}/moments/{moment}/v{version}.mp4`) so old exports survive until a new
  encode succeeds.

- **Audio detection** additionally uses Asynq's uniqueness option (2-hour
  window) to deduplicate double-enqueues, and replaces detections
  transactionally (DELETE + bulk INSERT) to avoid a torn read.

- **Image proxy** is the only task that can respond inline: it coordinates
  worker results over Redis pub/sub and falls back to synchronous processing
  when no queue is configured (useful for tests and minimal dev setups).

Activity events are emitted as best-effort notifications when jobs complete; the
durable record is always the database row, and clients re-fetch over HTTP on
reconnect.

---

## Data layer

**PostgreSQL via GORM.** All primary keys are UUIDs with `gen_random_uuid()`
database defaults and `BeforeCreate` hooks in Go. File sizes use `bigint` to
support files larger than 2 GB. Password hashes and internal session fields are
excluded from JSON serialization.

**Migrations via Goose.** SQL files are embedded in the binary and applied
automatically at startup. The pgvector extension is bootstrapped in the first
migration. Later migrations add per-job status columns, moments and share
links, collaborative library invites, the activity feed, and the 512-dimension
HNSW vector index used for face recognition. The HNSW index is created with
`CREATE INDEX CONCURRENTLY` inside a `NO TRANSACTION` migration so it does not
lock the table.

**Face embeddings.** The 512-dimension `face_detections.embedding` column is
a pgvector `vector(512)` type. It is written and queried via raw SQL with
explicit `::vector` casts rather than through GORM's type system.

---

## Extending the backend

**Adding a handler:** create a struct in `backend/internal/handlers/`, add a
`RegisterRoutes` method, construct it in `main.go`, and call `RegisterRoutes`
in the route registration block. Read auth context via the middleware helpers;
call services for business logic.

**Adding an async task:** add a task-type constant and a `ProcessTask` function
in the relevant service under `backend/internal/services/`. Register the handler
in the Asynq mux in `main.go`. Add the `<job>_status` / `<job>_version` columns
via a new Goose migration and track them on the affected GORM model.

**Adding a config field:** add the field to the `Config` struct in
`backend/internal/config/config.go` and read it from the environment with
`getEnv`. Pass it through to the service constructor in `main.go`.

:::caution
Schema changes go through Goose SQL migrations. Never use GORM's
`AutoMigrate` — it is explicitly disabled for foreign-key constraints and is
not used anywhere in the codebase.
:::
