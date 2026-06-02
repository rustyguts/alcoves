# Admin Panel & Async Job Queue

Alcoves ships a single owner-only administrative surface that combines instance
statistics, user management, registration controls, inference-model selection,
and a real-time dashboard for the background job queue. This document covers the
entire admin feature: the backend handlers, the settings service, the async job
control plane, and the frontend pages and components that render it.

---

## What it does (user-facing)

The very first account created on an Alcoves instance becomes the **owner**
(bootstrap rule in the auth handler — `role = "owner"` when zero users exist; all
subsequent users are `member`). Only the owner sees the **Admin** entry in the
dashboard sidebar, and only the owner can reach `/admin` or `/admin/jobs`.

From `/admin` the owner can:

- **See instance stats** — total users, libraries, non-trashed files, non-trashed
  folders, and total storage used (sum of all file sizes).
- **Control registration** — switch the instance between `open`, `invite_only`,
  and `closed` self-registration.
- **Pick inference models** — choose the Whisper transcription model and language,
  and the audio-event-detection (AudioSet tagger) model. The UI shows each model's
  disk size, peak RAM, accuracy (WER for Whisper, mAP for audio taggers), and
  license so the owner can trade quality against resource cost.
- **Manage users** — list every account and promote/demote each between `owner`
  and `member` (the owner's own row is locked in the UI to prevent self-lockout).
- **Backfill content hashes** — kick off a background job that SHA-256-hashes any
  files that were uploaded before content-addressed hashing existed.
- **Watch the job queue** — an embedded real-time panel streams every Asynq queue's
  active/waiting/failed/delayed counts and lets the owner retry, remove, or purge
  jobs.

A dedicated full-screen version of the queue dashboard lives at `/admin/jobs`.

The page footer shows the running build version (commit SHA linked to GitHub, a
"dirty" badge, and the build timestamp) from `GET /api/version`.

---

## How it works

### Access control: the owner gate

Every `/api/admin/**` route is protected by `requireOwnerMiddleware`
(`backend/internal/handlers/admin.go`). The middleware looks up
`users.role` for the authenticated user and returns **403** if it is not
`"owner"`. It is exported as `RequireOwnerMiddleware()` so the same guard instance
can be shared with the jobs handler:

```go
ownerMW := adminHandler.RequireOwnerMiddleware()
// passed into AdminJobsHandler so /api/admin/jobs/** is gated identically
```

> Historical note: an earlier revision registered the job-queue routes on a
> separate `/admin` group **without** the owner middleware (top-10 plan item #6).
> That gap has been closed — both `AdminHandler` and `AdminJobsHandler` now sit
> behind the same `ownerMW`.

On the frontend the gate is enforced in `app/middleware/auth.global.ts`. The
middleware defines `ownerRoutes = ["/admin", "/admin/jobs"]`; if the route matches
and `user.value?.role !== "owner"`, it redirects to `/`. The sidebar in
`app/layouts/dashboard.vue` only renders the Admin nav item when
`user.value?.role === "owner"`. These are convenience guards only — the real
enforcement is the server-side `requireOwnerMiddleware`.

### `AdminHandler` — stats, users, settings, hashes

**File:** `backend/internal/handlers/admin.go`
**Struct:** `AdminHandler{ db, hashSvc, settingsSvc }`
**Routes registered on `/api/admin`:**

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/stats` | Counts `users`, `libraries`, non-trashed `files`, non-trashed `folders`, and `SUM(files.size)`. Returns `AdminStats`. |
| GET | `/users` | Lists every user (id, email, displayName, avatarUrl, role, timestamps). |
| PATCH | `/users/:userId` | Updates a user's `role`; only `"owner"` or `"member"` are accepted. |
| POST | `/backfill-hashes` | Calls `hashSvc.EnqueueUnhashedFiles()`, returns `{"queuedCount": n}`. |
| GET | `/settings` | Reads `AppSettings` via the settings service. |
| PATCH | `/settings` | Validates ML fields, then writes through the settings service (see below). |

**Settings validation in `UpdateSettings`** — before delegating to
`settingsSvc.Update`, the handler validates any ML fields against their
service-owned allow-lists:

- `whisper_model` → `transcribe.IsValidWhisperModel`
- `whisper_language` → `transcribe.IsValidWhisperLanguage`
- `audio_detect_model` → `audiodetection.IsValidModelID`

This keeps the allow-list logic next to the inference services and out of the
settings package. The settings service itself only validates
`registration_mode`.

The backfill path threads through the `filehash` service:
`EnqueueUnhashedFiles` runs
`SELECT id, library_id FROM files WHERE hash IS NULL AND trashed_at IS NULL`
and enqueues a `file:hash` Asynq task per row (best-effort; per-file errors are
logged and skipped).

### Settings service

**Files:** `backend/internal/services/settings/settings.go`, `settings_test.go`
**Table:** `app_settings` (migration `00016_app_settings.sql`)

The `app_settings` table is a deliberate **single-row** table:
`id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1)` with a `settings JSONB` payload
plus `updated_at` and `updated_by UUID`. It is seeded on migration with
`{"registration_mode":"open"}` (idempotent via `ON CONFLICT (id) DO NOTHING`).

The `Settings` struct stored in the JSONB column:

```go
type Settings struct {
    RegistrationMode string // "open" | "closed" | "invite_only"
    WhisperModel     string // e.g. "large-v3"
    WhisperLanguage  string // e.g. "auto"
    AudioDetectModel string // e.g. "efficientat_mn10"
}
```

Defaults: `RegistrationOpen`, `WhisperModel="large-v3"`,
`WhisperLanguage="auto"`, `AudioDetectModel="efficientat_mn10"`.

Service design notes:

- **`NewService(db)`** calls `reload()` at startup, and **seeds defaults if the
  `id=1` row is missing** — this guards tests that use GORM `AutoMigrate` without
  running the Goose seed.
- **`Get()`** returns a cached copy under an `sync.RWMutex` read lock — settings
  are read on every registration and every transcription/audio-detect job, so the
  cache avoids a DB hit on the hot path.
- **`Update(patch, updatedBy)`** does a **partial merge**: only non-empty patch
  fields overwrite the current settings, so a PATCH that only sets
  `whisper_model` leaves `registration_mode` untouched. It validates
  `RegistrationMode` (if set), writes the merged JSON to the single row, then calls
  `reload()` to refresh the cache.
- **ML allow-list validation is delegated upward** to the admin handler. The
  settings package intentionally imports no ML service packages.

The settings service is also consumed by the transcription and audio-detection
workers (so the admin's runtime model choice overrides the boot-time env-var
default) and by the public registration-mode endpoint below.

### `AdminJobsHandler` — the Asynq control plane

**File:** `backend/internal/handlers/admin_jobs.go`
**Struct:** `AdminJobsHandler{ inspector *asynq.Inspector, ownerMW }`
**Routes registered on `/api/admin`** (all behind the same `ownerMW`):

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/jobs/stats` | Per-queue counts: `{active, completed, failed, waiting, delayed}` across all Asynq queues. |
| GET | `/jobs/:queueName` | Paginates tasks across states (active, pending, scheduled, retry, archived, completed — up to 200 each). Task payloads are JSON-decoded into `map[string]interface{}`. |
| POST | `/jobs/:queueName/purge` | Bulk-deletes pending, scheduled, retry, archived, and completed tasks for the queue. |
| POST | `/jobs/:queueName/:jobId` | `ControlJob`: action `retry` → `inspector.RunTask`; action `remove` → `inspector.DeleteTask`. |
| GET | `/jobs/stream` | Server-Sent Events: emits a `{queues, jobs}` snapshot every 2 seconds until the client disconnects. |

The per-job payload shape returned by the list/stream endpoints is `jobSnapshot`:
`id, queueName, name, data, progress, attemptsMade, failedReason, timestamp,
processedOn, finishedOn, state`.

**Graceful nil-inspector handling:** the Asynq inspector is only constructed when
Redis/Dragonfly is reachable. When `inspector == nil`, `Stats` returns empty
results and every mutating endpoint (purge, retry/remove) returns **503** rather
than panicking. The SSE stream uses a `time.NewTicker(2s)` heartbeat and exits
cleanly on client disconnect.

The underlying queues come from the Asynq worker mux wired in
`backend/cmd/server/main.go` (concurrency 8, priorities `imageproxy` 10 >>
`default` 1). Task types the dashboard surfaces:

| Task type | Producer service |
|-----------|------------------|
| `image:proxy` | `imageproxy` |
| `face:detect` | `facedetection` |
| `object:detect` | `objectdetection` |
| `video:proxy` / `video:thumbnail` | `videoproxy` |
| `file:hash` | `filehash` |
| `moment:export` | `momentexport` |
| `file:transcribe` | `transcribe` |
| `file:audio-detect` | `audiodetection` |
| `file:waveform` | `waveform` |

### Public registration-mode endpoint

`GET /api/_meta/registration-mode` is registered inline in `main.go` and is
**public** (allowlisted in the auth middleware under `/api/_meta/**`). It returns
`{ "mode": "<registration_mode>" }` straight from the settings cache. The
registration page (`app/pages/register.vue`) calls it via `api.meta` so the
sign-up form can show/hide itself for `open` / `invite_only` / `closed` modes
without requiring an authenticated session.

---

## Frontend

### `pages/admin/index.vue` — the admin dashboard

Route `/admin`, `layout: "dashboard"`, owner-gated by `auth.global.ts`.

Data fetched on load:

- `GET /api/admin/stats` → `AdminStats`
- `GET /api/admin/users` → `AdminUser[]`
- `GET /api/admin/settings` → `AppSettings`
- `GET /api/version` → `VersionInfo`

Sections:

1. **Stats grid** — five KPI cards: files, storage (formatted size), libraries,
   users, folders.
2. **Registration mode** — a radio group (`open` / `invite_only` / `closed`). On
   change it PATCHes `/api/admin/settings { registration_mode }` and **rolls back
   the radio to its previous value if the request fails.**
3. **Inference models panel** — three selectors, each using the same
   draft + optimistic-update-with-rollback pattern:
   - **Whisper model** (9 options: `tiny` → `large-v3`, the quantized
     `large-v3-q5_0` / turbo quants, and `distil-large-v3.5-q5`) — shows disk MB,
     peak RAM, WER clean/other, and a language warning for English-only models.
     PATCHes `{ whisper_model }`.
   - **Whisper language** (12 languages + `auto`). PATCHes `{ whisper_language }`.
   - **Audio tagger** (7 models: EfficientAT mn04/mn10/mn40, CED tiny/small/base,
     PANNs CNN14) — shows disk MB, peak RAM, mAP, and license. PATCHes
     `{ audio_detect_model }`.
4. **Users table** — a `UTable` with displayName / role / createdAt / updatedAt
   columns and an inline `USelect` (owner/member) per row →
   `PATCH /api/admin/users/:id { role }` with rollback. **The current user's own
   row select is disabled** to prevent self-demotion lockout.
5. **Embedded `<AdminJobsPanel embedded />`** — the queue dashboard inline.
6. **Version footer** — commit SHA linked to GitHub, dirty badge, build timestamp.

### `pages/admin/jobs.vue` — full-screen queue dashboard

Route `/admin/jobs`, owner-gated. A thin wrapper: a back link to `/admin` and
`<AdminJobsPanel />` rendered in full mode (no `embedded` prop).

### `components/admin/AdminJobsPanel.vue`

The real-time background-job dashboard, used both embedded (in `/admin`) and
standalone (in `/admin/jobs`).

- **Live data via SSE:** on mount it opens an `EventSource` to
  `GET /api/admin/jobs/stream` **with credentials** and parses each message as
  `{ queues: QueueStat[], jobs: JobEntry[] }`. It disconnects on unmount. No
  frontend auth check is performed — access control is entirely server-side via
  the owner gate.
- **Interfaces:**
  - `QueueStat { name, waiting, active, completed, failed, delayed }`
  - `JobEntry { id, queueName, name, data, progress, attemptsMade, failedReason,
    timestamp, processedOn, finishedOn, state }`
- **UI:** stat tiles (active / waiting / failed / delayed totals), a per-queue
  table with a **Purge** button, and a job list sorted by state priority
  (active > waiting > delayed > failed). Filters by status and by queue. Each job
  row expands to show `failedReason`, payload, and timestamps. Failed jobs expose
  **Retry** and **Remove** buttons.
- **Mutating actions** go through the typed `api.admin` client:
  - `api.admin.controlJob(queueName, jobId, { action: "retry" })`
  - `api.admin.controlJob(queueName, jobId, { action: "remove" })`
  - `api.admin.purgeQueue(queueName)`
- **Cosmetics:** queue-name heuristic strips `{}` and turns `-` into spaces; an
  icon heuristic maps `face → i-lucide-scan-face`, `video → i-lucide-video`,
  `thumbnail → i-lucide-image`, else `i-lucide-layers`.

> Note: the SSE stream is intentionally **not** wrapped in the `api.admin` client
> (`app/api/index.ts` documents it as an explicit exclusion) — `EventSource` is
> used directly because it is a streaming connection, not a one-shot fetch.

### Relevant types (`shared/types/api.ts`)

```ts
AdminStats   = { users, libraries, files, folders, totalSize }
AdminUser    = { id, email, displayName, avatarUrl, role: "owner"|"member", createdAt, updatedAt }
AppSettings  = { registration_mode: RegistrationMode, whisper_model?, whisper_language?, audio_detect_model? }
RegistrationMode = "open" | "closed" | "invite_only"
```

---

## Related code

**Backend**

- `backend/internal/handlers/admin.go` — `AdminHandler`, `requireOwnerMiddleware` /
  `RequireOwnerMiddleware`, stats / users / settings / backfill-hashes.
- `backend/internal/handlers/admin_jobs.go` — `AdminJobsHandler`, Asynq inspector
  routes, SSE stream, nil-inspector handling.
- `backend/internal/services/settings/settings.go` — single-row `app_settings`
  cache, RWMutex, partial-merge `Update`, seed-on-missing.
- `backend/internal/services/filehash/` — `EnqueueUnhashedFiles` (the
  backfill-hashes target) and the `file:hash` task.
- `backend/internal/services/transcribe/whisper_models.go` —
  `IsValidWhisperModel`, `IsValidWhisperLanguage`, the 9-model registry.
- `backend/internal/services/audiodetection/registry.go` — `IsValidModelID`,
  the 7-model registry (`DefaultModelID = "efficientat_mn10"`).
- `backend/cmd/server/main.go` — wires `AdminHandler` + `AdminJobsHandler` under
  `/api/admin`, the Asynq worker mux, and the public
  `GET /api/_meta/registration-mode` route.
- `backend/migrations/00016_app_settings.sql` — `app_settings` table.

**Frontend**

- `frontend/app/pages/admin/index.vue` — stats grid, registration radio,
  inference-models panel, users table, embedded jobs panel, version footer.
- `frontend/app/pages/admin/jobs.vue` — standalone jobs page.
- `frontend/app/components/admin/AdminJobsPanel.vue` — SSE dashboard.
- `frontend/app/middleware/auth.global.ts` — `ownerRoutes` gate.
- `frontend/app/layouts/dashboard.vue` — owner-only Admin nav item.
- `frontend/app/api/index.ts` — `api.admin` (controlJob, purgeQueue,
  getSettings, updateSettings, etc.) and `api.meta.registrationMode`.
- `frontend/shared/types/api.ts` — `AdminStats`, `AdminUser`, `AppSettings`,
  `RegistrationMode`.
