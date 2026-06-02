# Database Schema & Migrations

This document describes the persistence layer of the Alcoves Go backend: how
schema changes are versioned and applied (Goose migrations embedded into the
binary), the GORM entity models that map to those tables, and the cross-cutting
patterns the schema relies on (per-job state machines, soft-delete, version-bump
reprocessing, and pgvector ANN search).

Alcoves stores everything in a single **PostgreSQL 18** database with the
**pgvector** extension. There is no separate ORM-driven schema authority — the
SQL migrations in `backend/migrations/` are the source of truth for DDL, and the
GORM models in `backend/internal/models/models.go` are a read/write view onto
those tables. GORM auto-migration is deliberately *not* used to create or alter
columns; `DisableForeignKeyConstraintWhenMigrating: true` is set so GORM never
touches constraints.

---

## Architecture

### Two layers, one source of truth

| Layer | Location | Responsibility |
|---|---|---|
| **Migrations (DDL)** | `backend/migrations/*.sql` | Authoritative schema: tables, columns, indexes, extensions, constraints |
| **Models (DML view)** | `backend/internal/models/models.go` | Go structs GORM uses to read/write rows; tags mirror — but do not define — the schema |

When you add a column you write a new Goose migration **and** add the matching
field to the GORM struct. The migration creates the column; the struct lets the
app read/write it. The two must be kept in lockstep by hand.

### Migrations run automatically on startup

There is no separate migration step in production. The API process applies all
pending migrations during boot, before any HTTP route is registered:

1. `config.Load()` validates env (`ALCOVES_DATABASE_URL`, `ALCOVES_SESSION_SECRET`, …)
2. `database.Connect(cfg.DatabaseURL)` opens the GORM pool (`MaxOpenConns=25`, `MaxIdleConns=5`, `logger.Warn`)
3. `database.RunMigrations(sqlDB)` applies every pending Goose migration **in order**, logging each with its duration
4. Services and handlers are constructed

In Kubernetes this means rolling out a new backend image automatically applies
schema migrations on the **api** pod — `kubectl rollout restart deploy/<name>-api`
is the upgrade trigger. The **worker** pod (`ALCOVES_MODE=worker`) shares the
same database but does not own migration timing.

**Related code:** `backend/cmd/server/main.go`, `backend/internal/database/database.go`,
`backend/internal/database/migrate.go`, `backend/internal/config/config.go`.

---

## The Goose migration system

### Embedding (`embed.go`)

All SQL files are compiled into the Go binary so the server never depends on the
host filesystem to migrate:

```go
// backend/migrations/embed.go
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
```

`migrations.FS` is an `embed.FS` containing every `*.sql` file. The database
package hands this filesystem to Goose's provider.

### Applying migrations (`migrate.go`)

`RunMigrations(db *sql.DB) error` builds a Goose provider over the embedded
filesystem and runs all pending `Up` migrations:

```go
provider, _ := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
_, err := provider.Up(ctx) // applies every pending migration in order
```

Goose tracks applied versions in its own bookkeeping table and applies anything
newer than the last recorded version.

### Migration file format

Every file uses Goose's directive comments:

```sql
-- +goose Up
CREATE TABLE ...;

-- +goose Down
DROP TABLE ...;
```

All Alcoves migrations are **plain SQL** (no Go-based migrations). Files are
numbered `00001`–`00019` and applied in numeric order.

#### `NO TRANSACTION` for concurrent index builds

Goose wraps each migration in a transaction by default. Migration `00019`
overrides this because `CREATE INDEX CONCURRENTLY` cannot run inside a
transaction block:

```sql
-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY face_detections_embedding_hnsw_idx
  ON face_detections USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

Building the HNSW index concurrently avoids taking a long write lock on
`face_detections` while the index is constructed.

**Related code:** `backend/migrations/embed.go`, `backend/migrations/00019_*.sql`.

---

## Migration inventory (00001 – 00019)

The 19 migrations tell the story of how the schema grew, one feature at a time.

| # | Migration | What it adds |
|---|---|---|
| 00001 | Initial schema | `vector` extension + all core tables (see below) |
| 00002 | Object detection | `object_detections` table; `libraries.object_detection_enabled` |
| 00003 | Relax tag colors | Drops the `UNIQUE(library_id, color)` index on `tags`, replaces with plain index |
| 00004 | Folder owner | `folders.owner_id` + index |
| 00005 | Proxy progress | `files.proxy_progress`, `files.proxy_eta_seconds` |
| 00006 | Thumbnail link | `files.thumbnail_file_id` (sparse index) |
| 00007 | File hash | `files.hash` + partial index `WHERE hash IS NOT NULL` |
| 00008 | Sharing flag | `libraries.sharing_enabled NOT NULL DEFAULT false` |
| 00009 | Moments | `moments`, `moment_tags`, `moment_shares` |
| 00010 | Transcription | Transcription columns on `files` (status/progress/eta/error/version + text/vtt/model) |
| 00011 | Audio detection | Audio-detect columns on `files`; `audio_detections` table |
| 00012 | Highlight filters | `highlight_filters` table (`kind`/`pattern`/`min_score` schema) |
| 00013 | Expression refactor | Replaces `kind`/`pattern`/`min_score` with free-form `expression` + `proximity_seconds`; backfills data |
| 00014 | Library+hash index | Composite partial index `files(library_id, hash)` for per-library dedup |
| 00015 | Waveform | Waveform columns on `files` (incl. `waveform_peaks_per_second DEFAULT 50`) |
| 00016 | App settings | `app_settings` singleton (single-row JSONB) |
| 00017 | Invite overhaul | `library_invite_uses` junction; `library_invites.max_uses`; drops legacy invite columns |
| 00018 | Activity feed | `library_activities`, `user_notification_dismissals`; `users.notifications_cleared_before` |
| 00019 | HNSW index | `CREATE INDEX CONCURRENTLY` HNSW cosine index on `face_detections.embedding` |

### 00001 — Initial schema + pgvector

Bootstraps the whole core model. First it creates the pgvector extension
(`CREATE EXTENSION vector`), then the foundational tables:

- **`users`** — `email` (unique index), `password_hash` (nullable for
  OAuth-only accounts), `display_name`, `avatar_url`, `role` default `'member'`.
- **`libraries`** — `name`, `emoji`, `is_default`, `face_recognition_enabled`,
  `owner_id`.
- **`folders`** — self-referential `parent_folder_id` (nullable), `trashed_at`
  soft-delete, composite index `(library_id, trashed_at, parent_folder_id, name)`.
- **`files`** — `mime_type` (default `application/octet-stream`), `size` **BIGINT**,
  `duration`/`width`/`height`, `proxy_status`, `source_file_id` (derivative link),
  `original_created_at`, `trashed_at`. Indexes `(library_id, parent_folder_id,
  trashed_at, name)` and `owner_id`.
- **`tags`** + **`file_tags`** + **`folder_tags`** — tag rows and their unique
  junction tables.
- **`library_members`** — `role` default `'viewer'`, unique `(library_id, user_id)`.
- **`library_invites`** — original schema includes `invited_email`, `role`,
  `accepted_by_user_id`, `accepted_at` (later dropped in 00017).
- **`accounts`** — OAuth linkage, unique `(provider, provider_account_id)`.
- **`sessions`** — `session_token` unique, `user_agent`, `ip_address`, `expires_at`.
- **`people`** — face-recognition clusters: `name` (nullable),
  `cover_face_detection_id`, `face_count`.
- **`face_detections`** — bounding box integers, `confidence`, `quality_score`,
  and **`embedding vector(512)`** (pgvector). The HNSW index over this column
  comes later, in 00019.

### Selected later migrations worth calling out

- **00013 (expression refactor):** the highlight-filter schema started rigid
  (`kind` IN (`audio_label`,`keyword`) + `pattern` + `min_score`) and was
  refactored to a single free-form `expression` string plus `proximity_seconds`.
  The Up migration backfills: `keyword` rows become `word:<pattern>` and
  `audio_label` rows become `<pattern>:<score_pct>`, then the old columns are
  dropped.
- **00016 (app settings):** a deliberate single-row table —
  `id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1)` enforces singleton
  semantics, `settings JSONB NOT NULL DEFAULT '{}'::jsonb` holds the config,
  seeded with `{"registration_mode":"open"}` via `ON CONFLICT (id) DO NOTHING`.
- **00017 (invite overhaul):** introduces `library_invite_uses` with a UNIQUE
  `(invite_id, user_id)` constraint (one redemption per user per invite, makes
  re-acceptance idempotent), adds `max_uses INTEGER` (NULL = unlimited), and
  drops the per-invite single-acceptance columns. Existing acceptances are
  backfilled into the new junction table.
- **00018 (activity feed):** `library_activities` (the durable event log) with
  three indexes — `(library_id, created_at DESC, id DESC)` for the paginated
  feed, `(actor_id, library_id, created_at DESC)` for the global "exclude my own
  actions" feed, and `(subject_type, subject_id)` for per-resource history.
  Adds the sparse `user_notification_dismissals` table and the
  `users.notifications_cleared_before` watermark for O(1) "dismiss all".

**Related code:** `backend/migrations/00001_*.sql` … `backend/migrations/00019_*.sql`.

---

## GORM models

All entities live in `backend/internal/models/models.go`. Conventions:

- Every primary key is `uuid.UUID` with a `gen_random_uuid()` DB default; a
  `BeforeCreate` hook guarantees a non-nil UUID even when populated Go-side.
- Timestamps (`created_at`/`updated_at`) default to DB-side `now()`.
- `BaseModel` is an embeddable struct (`ID`, `CreatedAt`, `UpdatedAt`) used as a
  composition base.

### Identity & auth

**`User` → `users`**
`email` (unique), `password_hash` (nullable), `display_name`, `avatar_url`,
`role` (default `member`; `owner` for the instance owner),
`notifications_cleared_before` (nullable watermark). Two fields are JSON-omitted
with `json:"-"`: `PasswordHash` (never serialized in any API response) and
`NotificationsClearedBefore` (server-side notification filtering only).

**`Account` → `accounts`** — OAuth provider linkage, unique
`(provider, provider_account_id)`, belongs to `User`.

**`Session` → `sessions`** — DB-backed sessions: `session_token` (unique),
`user_agent`, `ip_address`, `expires_at`.

### Libraries, folders, files

**`Library` → `libraries`**
`name`, `emoji`, `is_default`, `owner_id`, plus the **three feature flags** that
gate whole pipelines:

- `face_recognition_enabled` — guards face-detection job enqueue
- `object_detection_enabled` — guards object-detection job enqueue
- `sharing_enabled` — required for moment share links to be created

Toggling a recognition/detection flag on fires a background goroutine that
enqueues the relevant job for all existing images.

**`Folder` → `folders`**
`parent_folder_id` (nullable — root folders have none), `owner_id` (nullable),
`trashed_at` soft-delete, M2M `Tags` via `folder_tags`. Composite index
`folders_library_trash_parent_name_idx` on
`(library_id, trashed_at, parent_folder_id, name)`.

**`File` → `files`** — the richest entity. Column groups:

| Group | Columns |
|---|---|
| Identity | `id`, `library_id`, `parent_folder_id`, `name`, `mime_type`, `size` (**bigint**), `owner_id` |
| Media metadata | `duration`, `width`, `height` |
| Video proxy | `proxy_status`, `proxy_progress`, `proxy_eta_seconds` |
| Transcription | `transcribe_status/progress/eta_seconds/error`, `transcribe_version`, `transcribed_version`, `transcript_text`, `transcript_vtt`, `transcript_model` |
| Audio detection | `audio_detect_status/progress/eta_seconds/error`, `audio_detect_version`, `audio_detected_version`, `audio_detect_model` |
| Waveform | `waveform_status/progress/error`, `waveform_version`, `waveformed_version`, `waveform_peaks_per_second` (default 50) |
| Relations | `thumbnail_file_id` (nullable), `source_file_id` (nullable — set on derivatives like proxies/thumbnails) |
| Metadata | `original_created_at`, `hash` (nullable text), `trashed_at` |

M2M `Tags` via `file_tags`. Composite index `files_library_parent_trash_name_idx`.
`size` is `bigint` (not `integer`) because PostgreSQL `integer` caps at ~2 GB.

### Tags

**`Tag` → `tags`** — unique `(library_id, name)` (`tags_library_name_idx`);
`color` indexed (non-unique since 00003).
**`FileTag` / `FolderTag`** — join tables with composite unique indexes to
prevent duplicate associations.

### Membership & invites

**`LibraryMember` → `library_members`** — unique `(library_id, user_id)`,
`role` default `viewer`.
**`LibraryInvite` → `library_invites`** — `token` (unique), `max_uses`
(nullable), `use_count`, `expires_at`, `revoked_at`; has-many `Uses`.
**`LibraryInviteUse` → `library_invite_uses`** — composite unique
`(invite_id, user_id)`: one redemption per user per invite.

### App settings

**`AppSettings` → `app_settings`** — single-row table (PK `id int`). The
`settings` column is **`jsonb`** holding the marshaled settings struct
(`registration_mode`, `whisper_model`, `whisper_language`, `audio_detect_model`);
`updated_by` is a nullable FK to `users`.

### Face / object detection

**`Person` → `people`** — `library_id`, optional `name`,
`cover_face_detection_id`, `face_count`; indexed on `(library_id, name)`.

**`FaceDetection` → `face_detections`** — bounding box
(`box_x/y/width/height`, `image_width/height`), `confidence`, `quality_score`,
nullable `person_id` (unassigned faces). **Note:** the
`embedding vector(512)` (pgvector) column is *not* a field on the GORM struct —
it is written and queried via raw SQL with a `$N::vector` cast, and the HNSW
index is added in migration 00019. GORM never touches the embedding.

**`ObjectDetection` → `object_detections`** — `label`, `confidence`, bounding
box, indexed by `(library_id, label)`. No embedding column.

### Moments, shares, audio events

**`Moment` → `moments`** — a named time range on a video:
`start_seconds`/`end_seconds` (`NUMERIC(12,3)`, `CHECK end_seconds > start_seconds`),
`name`, `description`, `created_by_id`, `trashed_at`, and the export
**version pair** `export_version` / `exported_version` (plus
`export_status/progress/eta_seconds`).

**`MomentTag` → `moment_tags`** — composite unique `(moment_id, tag_id)`.

**`MomentShare` → `moment_shares`** — `token` (unique, bearer token for the
public `/s/:token` page), `revoked_at`. Only meaningful when the parent
library's `sharing_enabled` is true.

**`AudioDetection` → `audio_detections`** — per-window AudioSet classification:
`label`, `class_index`, `score` (float32), `start_seconds`/`end_seconds`
(float32), `version`. FKs cascade-delete from `files` and `libraries`.

### Highlight filters & activity

**`HighlightFilter` → `highlight_filters`** — per-library rule:
`expression` (text), `proximity_seconds` (default 5), `color` (default
`#3B82F6`), nullable `created_by_id`.

**`LibraryActivity` → `library_activities`** — canonical activity log:
`library_id`, `actor_id` (nullable for system events), `action`,
`subject_type`, `subject_id`, `metadata jsonb`. Subject names are snapshotted
into metadata so the feed survives renames/deletes.

**`UserNotificationDismissal` → `user_notification_dismissals`** — composite PK
`(user_id, activity_id)`; a sparse per-item dismissal table. Bulk "dismiss all"
uses the `User.NotificationsClearedBefore` watermark instead of inserting one
row per activity.

**Related code:** `backend/internal/models/models.go`.

---

## Cross-cutting schema patterns

These patterns repeat across the schema and are worth internalizing.

### Per-job state-machine columns

Every async media job stamps its progress directly onto the `files` row using a
consistent column family:

```
<job>_status        TEXT     -- queued | processing | ready | not_needed | failed
<job>_progress      INTEGER  -- 0..100
<job>_eta_seconds   INTEGER  -- estimated time remaining (nullable)
<job>_error         TEXT     -- failure detail (nullable)
<job>_version       INTEGER  -- bumped to request a (re)run
<job>ed_version     INTEGER  -- set to <job>_version on success
```

Job prefixes: `proxy` (00005), `transcribe` (00010), `audio_detect` (00011),
`waveform` (00015). The frontend (`shared/types/api.ts`) mirrors these as
`proxyStatus/proxyProgress/…`, etc., and a generic polling composable
(`useAsyncJobStatus`) watches the `*_status` field.

### Version-bump reprocessing

The `<job>_version` / `<job>ed_version` integer pair is the optimistic-concurrency
mechanism for reprocessing:

- To request a rerun, the handler increments `<job>_version`.
- The worker captures `<job>_version` at job start and writes
  `<job>ed_version = captured` on success.
- If a *newer* run starts (or a file is replaced) mid-encode, the in-flight
  worker re-reads the row, sees the version changed, and **discards its output
  silently** rather than overwriting fresher work.

The same pattern drives moment export (`export_version` / `exported_version` on
`moments`): editing a moment's time range bumps the version, and stale clip
encodes self-discard. Versioned cache keys
(`{lib}/moments/{moment}/v{version}.mp4`) mean old exports are never overwritten
until a new encode finishes.

### Soft-delete + trash-aware indexes

`trashed_at TIMESTAMPTZ` (nullable) on `files`, `folders`, and `moments` is the
soft-delete marker. Permanent deletion is a separate "purge" operation. To keep
trash-filtered browsing fast, the composite indexes include `trashed_at`:

- `folders(library_id, trashed_at, parent_folder_id, name)`
- `files(library_id, parent_folder_id, trashed_at, name)`
- `files(library_id, hash) WHERE hash IS NOT NULL AND trashed_at IS NULL` (00014)

Derivative files (proxies, thumbnails) are identified by a non-null
`source_file_id` and are excluded from listings, dedup, and trash views.

### Content addressing & dedup

`files.hash` (hex SHA-256, computed by the `file:hash` async job) backs
duplicate detection. Migration 00007 adds the partial index on non-null hashes;
00014 adds the per-library composite. Dedup queries deliberately exclude trashed
and derivative files.

### pgvector + HNSW for face recognition

`face_detections.embedding` is a `vector(512)` (ArcFace R50 output). Migration
00019 builds an **HNSW** index with `vector_cosine_ops` (`m = 16`,
`ef_construction = 64`) for approximate nearest-neighbor cosine search. Face
clustering queries set `SET LOCAL hnsw.ef_search = 40` inside a transaction and
use the `<=>` cosine-distance operator. Because the embedding is not modeled in
GORM, all of this is raw SQL.

### bigint for file sizes

`files.size` is `BIGINT`. PostgreSQL `integer` tops out around 2 GB, which is far
too small for media files — this is a deliberate, load-bearing choice.

---

## How to add a column or table

1. Create the next-numbered file in `backend/migrations/`, e.g.
   `00020_add_something.sql`, with `-- +goose Up` / `-- +goose Down` sections.
   Use `-- +goose NO TRANSACTION` only if you need `CREATE INDEX CONCURRENTLY`
   (or other non-transactional DDL).
2. Add the matching field(s) to the relevant struct in
   `backend/internal/models/models.go`. For columns GORM should never write
   (like `embedding`), keep them out of the struct and use raw SQL.
3. If the change is an async job, follow the `<job>_status/progress/eta_seconds/
   error/version` + `<job>ed_version` convention and mirror the fields in
   `frontend/shared/types/api.ts`.
4. Migrations apply automatically on the next api-pod startup — no separate
   command. Locally, the same happens when you start the server.

For test isolation, integration tests connect to
`postgres://postgres:postgres@localhost:5455/alcoves_test` and `t.Skip` if the
DB is unavailable. Some test suites use GORM `AutoMigrate` for convenience; the
`settings` service seeds the singleton row defensively to cover that case.

---

## Related code

- `backend/migrations/embed.go` — `//go:embed *.sql` → `migrations.FS`
- `backend/migrations/00001_*.sql` … `00019_*.sql` — all schema DDL
- `backend/internal/database/migrate.go` — `RunMigrations`, `goose.NewProvider(...).Up`
- `backend/internal/database/database.go` — `Connect`, pool config, FK-constraint disable
- `backend/internal/models/models.go` — all GORM entities + UUID hooks
- `backend/cmd/server/main.go` — startup sequence (connect → migrate → serve)
- `backend/internal/config/config.go` — `ALCOVES_DATABASE_URL` and related env
- `frontend/shared/types/api.ts` — frontend mirror of the file/job/activity shapes
