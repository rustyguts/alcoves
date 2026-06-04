---
title: "Database schema & migrations"
description: "How Alcoves models its data in PostgreSQL: Goose migrations, GORM entities, pgvector/HNSW face embeddings, and cross-cutting schema patterns."
---

Alcoves persists everything in a single **PostgreSQL** database extended with **pgvector**. Schema changes are versioned as plain-SQL Goose migrations compiled directly into the Go binary, and GORM structs provide the Go-side read/write view onto those tables. This page explains the migration system, the entity model, and the patterns that repeat across the schema.

## Two layers, one source of truth

| Layer | What it does |
|---|---|
| **SQL migrations** (`backend/migrations/`) | The authoritative DDL: creates tables, columns, indexes, and extensions in numbered order |
| **GORM models** (`backend/internal/models/`) | Go structs that map to those tables; they mirror the schema but never alter it |

GORM's `AutoMigrate` and foreign-key auto-management are both disabled. All structural changes go through migrations. When you add a column you write a new migration *and* add the matching field to the GORM struct — the two must be kept in sync by hand.

## Migrations

### Embedded in the binary

All SQL files are compiled into the Go server binary using `//go:embed`. The server never reads migration files from the filesystem at runtime, which means the same binary can be deployed to any host without shipping extra files alongside it.

### Applied automatically on startup

There is no separate migration step in production. Every time the API process starts it:

1. Opens a connection pool to `ALCOVES_DATABASE_URL`
2. Hands the embedded SQL filesystem to a Goose provider
3. Applies every pending migration in numeric order, logging each with its duration
4. Then registers HTTP routes and begins serving

In a Kubernetes deployment this means rolling out a new image automatically migrates the schema. The worker pod (`ALCOVES_MODE=worker`) shares the database but does not drive migration timing — only the API pod does.

:::tip
Locally, migrations run every time you start the server with `go run cmd/server/main.go`. You do not need to run a separate command.
:::

### Migration format

Every file uses Goose's directive comments:

```sql
-- +goose Up
CREATE TABLE example (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

-- +goose Down
DROP TABLE example;
```

All migrations are plain SQL. They are numbered `00001`–`00019` and applied strictly in order. Goose tracks applied versions in its own bookkeeping table and skips anything already recorded.

#### Non-transactional migrations

Goose wraps each migration in a transaction by default. Migration `00019` opts out because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block:

```sql
-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY face_detections_embedding_hnsw_idx
  ON face_detections USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

Building the HNSW index concurrently avoids holding a long write lock on `face_detections` while the index is constructed.

### Migration inventory

| # | What it adds |
|---|---|
| 00001 | `vector` extension + all core tables (users, libraries, folders, files, tags, members, invites, sessions, people, face\_detections) |
| 00002 | `object_detections` table; per-library object detection flag |
| 00003 | Relaxes tag color uniqueness from per-library unique to plain index |
| 00004 | `folders.owner_id` |
| 00005 | Video proxy progress columns (`proxy_progress`, `proxy_eta_seconds`) |
| 00006 | `files.thumbnail_file_id` (sparse index) |
| 00007 | `files.hash` + partial index for deduplication |
| 00008 | `libraries.sharing_enabled` flag (required for moment share links) |
| 00009 | `moments`, `moment_tags`, `moment_shares` |
| 00010 | Transcription job columns on `files` |
| 00011 | Audio detection job columns on `files`; `audio_detections` table |
| 00012 | `highlight_filters` table (initial rigid schema) |
| 00013 | Refactors highlight filters to free-form `expression` + `proximity_seconds`; backfills existing rows |
| 00014 | Composite partial index `files(library_id, hash)` for per-library dedup |
| 00015 | Waveform job columns on `files` |
| 00016 | `app_settings` singleton table (JSONB, single-row enforced by `CHECK (id = 1)`) |
| 00017 | Invite overhaul: `library_invite_uses` junction, `max_uses`, drops legacy single-acceptance columns |
| 00018 | `library_activities` event log; `user_notification_dismissals`; `users.notifications_cleared_before` watermark |
| 00019 | HNSW cosine index on `face_detections.embedding` (non-transactional) |

A few of these are worth a closer look:

**00013 — expression refactor.** The highlight-filter schema started rigid (`kind` + `pattern` + `min_score`) and was refactored to a single free-form `expression` string with an optional `proximity_seconds` window. The migration backfills existing rows: `keyword` filters become `word:<pattern>` and `audio_label` filters become `<pattern>:<score_pct>`, then the old columns are dropped in the same migration.

**00016 — app settings singleton.** The `id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1)` constraint enforces that there can only ever be one row. The `settings JSONB` column holds the marshaled admin configuration and is seeded with `{"registration_mode":"open"}` on first insert.

**00017 — invite overhaul.** Introduces `library_invite_uses` with a `UNIQUE (invite_id, user_id)` constraint so each user can redeem a given invite at most once (making re-acceptance idempotent). Adds `max_uses INTEGER` (NULL = unlimited). Existing acceptances are backfilled into the new junction table.

**00018 — activity feed.** `library_activities` carries three indexes tuned for different access patterns: paginated library feed, global "exclude my own actions" feed, and per-resource history. The `user_notification_dismissals` table handles per-item dismissals; bulk "dismiss all" uses the `notifications_cleared_before` watermark on the `users` row instead of inserting one dismissal row per activity.

## Entity model

### Conventions

- Every primary key is a `UUID` generated by `gen_random_uuid()`. A `BeforeCreate` hook on each model ensures a non-nil UUID is set even when GORM populates it Go-side before the insert.
- `created_at` and `updated_at` default to `now()` on the database side.

### Identity and auth

**`users`** — `email` (unique), `password_hash` (nullable for OAuth-only accounts), `display_name`, `avatar_url`, `role` (default `member`; `owner` for the instance owner), `notifications_cleared_before` watermark. `password_hash` is never included in API responses.

**`accounts`** — OAuth provider linkage, unique per `(provider, provider_account_id)`.

**`sessions`** — database-backed sessions with `session_token`, `user_agent`, `ip_address`, and `expires_at`.

### Libraries, folders, and files

**`libraries`** — `name`, `emoji`, `is_default`, `owner_id`, and three feature flags that gate entire processing pipelines:

- `face_recognition_enabled` — enables face detection and clustering jobs
- `object_detection_enabled` — enables COCO object detection jobs
- `sharing_enabled` — required for moment share links to be created

Toggling either recognition flag on triggers a background sweep that enqueues the relevant job for all existing images in the library.

**`folders`** — self-referential `parent_folder_id` (NULL for root folders), soft-delete via `trashed_at`, M2M tags. Composite index on `(library_id, trashed_at, parent_folder_id, name)`.

**`files`** — the richest entity in the schema. Its columns are grouped by concern:

| Group | Columns |
|---|---|
| Identity | `library_id`, `parent_folder_id`, `name`, `mime_type`, `size` (bigint), `owner_id` |
| Media metadata | `duration`, `width`, `height` |
| Relations | `thumbnail_file_id` (nullable), `source_file_id` (nullable — set on derivatives such as proxies and thumbnails) |
| Video proxy job | `proxy_status`, `proxy_progress`, `proxy_eta_seconds` |
| Transcription job | `transcribe_status/progress/eta_seconds/error/version`, `transcribed_version`, `transcript_text`, `transcript_vtt`, `transcript_model` |
| Audio detection job | `audio_detect_status/progress/eta_seconds/error/version`, `audio_detected_version`, `audio_detect_model` |
| Waveform job | `waveform_status/progress/error/version`, `waveformed_version`, `waveform_peaks_per_second` |
| Content addressing | `hash` (nullable hex SHA-256) |
| Soft delete | `original_created_at`, `trashed_at` |

:::note
`size` is stored as `BIGINT`. PostgreSQL's `INTEGER` type caps at roughly 2 GB, which is far too small for media files.
:::

### Tags

**`tags`** — unique per `(library_id, name)`.

**`file_tags`** / **`folder_tags`** — junction tables with composite unique indexes to prevent duplicate associations.

### Membership and invites

**`library_members`** — unique per `(library_id, user_id)`, `role` defaults to `viewer`.

**`library_invites`** — `token` (unique bearer token), `max_uses` (NULL = unlimited), `use_count`, `expires_at`, `revoked_at`.

**`library_invite_uses`** — one row per `(invite_id, user_id)` redemption. The unique constraint makes re-acceptance idempotent.

### Face and object detection

**`people`** — face recognition clusters: optional `name`, `cover_face_detection_id`, `face_count`. Indexed by `(library_id, name)`.

**`face_detections`** — bounding box integers, `confidence`, `quality_score`, nullable `person_id`. The `embedding vector(512)` column stores ArcFace R50 output. This column is intentionally not mapped in the GORM struct — all reads and writes go through raw SQL with a `::vector` cast, keeping GORM from interfering with the pgvector type. The HNSW index is added in migration 00019.

**`object_detections`** — `label`, `confidence`, bounding box. Indexed by `(library_id, label)`.

### Moments and shares

**`moments`** — a named clip on a video: `start_seconds`/`end_seconds` (stored as `NUMERIC(12,3)`, with a `CHECK end_seconds > start_seconds` constraint), `name`, `description`, `created_by_id`, `trashed_at`. Also carries the export version pair and job progress columns.

**`moment_tags`** — composite unique `(moment_id, tag_id)`.

**`moment_shares`** — a public share token (`unique`) and `revoked_at`. Only meaningful when the parent library's `sharing_enabled` flag is true.

### Audio detections and highlight filters

**`audio_detections`** — per-window AudioSet classification: `label`, `class_index`, `score`, `start_seconds`/`end_seconds`, `version`. Cascade-deletes from both `files` and `libraries`.

**`highlight_filters`** — per-library rules that drive the video editor's highlight detection: `expression` (free-form text), `proximity_seconds` (default 5), `color` (default `#3B82F6`).

### Activity and notifications

**`library_activities`** — the durable event log: `actor_id` (nullable for system events), `action`, `subject_type`, `subject_id`, `metadata jsonb`. Subject names are snapshotted into `metadata` so the activity feed survives renames and deletes.

**`user_notification_dismissals`** — composite primary key `(user_id, activity_id)` for per-item dismissals.

## Cross-cutting schema patterns

### Per-job state machine

Every async media processing job stamps its progress directly onto the `files` row using a consistent column family:

```
<job>_status        TEXT     -- queued | processing | ready | not_needed | failed
<job>_progress      INTEGER  -- 0..100
<job>_eta_seconds   INTEGER  -- estimated seconds remaining (nullable)
<job>_error         TEXT     -- failure detail (nullable)
<job>_version       INTEGER  -- incremented to request a rerun
<job>ed_version     INTEGER  -- set to <job>_version on success
```

Jobs using this pattern: `proxy` (video transcoding), `transcribe` (speech transcription), `audio_detect` (AudioSet tagging), `waveform` (audio waveform generation). The frontend mirrors these columns as camelCase in its API type definitions and uses a generic polling composable to watch the `*_status` field.

### Version-bump reprocessing

The `<job>_version` / `<job>ed_version` integer pair is the optimistic-concurrency mechanism for reprocessing:

- **Request a rerun:** increment `<job>_version`.
- **On success:** the worker writes `<job>ed_version = captured_version`.
- **Stale workers self-discard:** if a newer run starts mid-encode (or the file is replaced), the in-flight worker re-reads the row, sees the version changed, and discards its output rather than overwriting fresher work.

The same pattern governs moment export (`export_version` / `exported_version` on `moments`): editing a moment's time range bumps the version, and stale in-progress encodes discard themselves. Versioned storage keys (e.g. `moments/{id}/v{version}.mp4`) ensure an old export is never overwritten until a new encode completes.

### Soft delete and trash-aware indexes

`trashed_at TIMESTAMPTZ` (nullable) on `files`, `folders`, and `moments` is the soft-delete marker. Setting it moves an item to trash; a separate purge operation performs permanent deletion.

The composite indexes on `files` and `folders` include `trashed_at` so the database can satisfy trash-filtered browse queries efficiently:

- `folders(library_id, trashed_at, parent_folder_id, name)`
- `files(library_id, parent_folder_id, trashed_at, name)`
- `files(library_id, hash) WHERE hash IS NOT NULL AND trashed_at IS NULL` — partial index for dedup, excludes trashed items

Derivative files (proxies, thumbnails) carry a non-null `source_file_id` and are excluded from browse listings, dedup, and trash views.

### Content addressing and dedup

`files.hash` holds a hex SHA-256 computed by an async job. Migration 00007 adds the partial index on non-null hashes; 00014 adds the per-library composite. Dedup queries exclude trashed and derivative files.

### pgvector and HNSW for face recognition

`face_detections.embedding` is a `vector(512)` column holding ArcFace R50 face embeddings. Migration 00019 builds an HNSW index with `vector_cosine_ops` (`m = 16`, `ef_construction = 64`) for approximate nearest-neighbor cosine search.

Clustering queries set `SET LOCAL hnsw.ef_search = 40` inside a transaction and use the `<=>` cosine-distance operator. Because the embedding column is not mapped in the GORM struct, all face-embedding reads and writes are raw SQL.

## Adding a column or table

1. Create the next-numbered SQL file in `backend/migrations/`, e.g. `00020_add_something.sql`. Use `-- +goose Up` and `-- +goose Down` sections. Add `-- +goose NO TRANSACTION` only if you need `CREATE INDEX CONCURRENTLY` or other DDL that cannot run inside a transaction.

2. Add the matching field(s) to the relevant struct in `backend/internal/models/models.go`. If GORM should never touch a column (like `embedding`), keep it out of the struct and use raw SQL.

3. If the change introduces an async job, follow the `<job>_status/progress/eta_seconds/error/version` + `<job>ed_version` convention and mirror the fields in the frontend's shared API types.

4. Migrations apply automatically on the next server startup — locally and in Kubernetes alike. No separate command is needed.

:::caution
Never use GORM's `AutoMigrate` on production tables. The GORM connection has `DisableForeignKeyConstraintWhenMigrating: true` set deliberately — GORM should not own schema changes.
:::

## Testing

Integration tests connect to a separate test database at `postgres://postgres:postgres@localhost:5455/alcoves_test` and skip if the database is unavailable. Per-package schema isolation is handled by a test-support helper that creates a fresh schema for each package's test run, so packages cannot interfere with each other.

See [Getting started](/getting-started/quickstart/) for how to run the full stack locally, and [Configuration](/getting-started/configuration/) for the `ALCOVES_DATABASE_URL` and related environment variables.
