-- +goose NO TRANSACTION
--
-- This migration builds its indexes CONCURRENTLY (see 00019), which cannot run
-- inside a transaction. The ADD COLUMN statements are metadata-only on PG11+
-- (constant defaults don't rewrite the table), so running them outside a
-- transaction is safe; every statement is idempotent (IF [NOT] EXISTS) so a
-- re-run after a mid-migration failure is harmless.

-- +goose Up

-- Async EXIF / media-metadata extraction job-tracking columns (mirrors the
-- waveform_* version/status pattern), plus the extracted data the Timeline and
-- Map views read.
ALTER TABLE files ADD COLUMN IF NOT EXISTS metadata_status TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS metadata_error TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS metadata_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS metadata_extracted_version INTEGER;
-- Failure counter consulted by the maintenance backfill scan: a file that fails
-- extraction 3 times is dropped from the scan so it is never re-queued forever.
ALTER TABLE files ADD COLUMN IF NOT EXISTS metadata_attempts INTEGER NOT NULL DEFAULT 0;

-- Extracted metadata. captured_at is the stored, coalesced effective capture
-- date (EXIF DateTimeOriginal -> original_created_at -> created_at), indexed for
-- the Timeline keyset sort.
ALTER TABLE files ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE files ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION;
ALTER TABLE files ADD COLUMN IF NOT EXISTS gps_lon DOUBLE PRECISION;
ALTER TABLE files ADD COLUMN IF NOT EXISTS camera_make TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS camera_model TEXT;

-- Timeline keyset pagination: ORDER BY effective capture date DESC, id DESC.
-- The indexed expression is the *exact* COALESCE the query orders and keysets
-- on — a bare captured_at index would not match, forcing a full Seq Scan + Sort
-- on every page. With this the planner satisfies the sort straight from the
-- index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS files_library_captured_at_idx
    ON files (library_id, (COALESCE(captured_at, original_created_at, created_at)) DESC, id DESC)
    WHERE trashed_at IS NULL AND source_file_id IS NULL;

-- Map: only geotagged live files; small + highly selective partial index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS files_library_gps_idx
    ON files (library_id)
    WHERE gps_lat IS NOT NULL AND gps_lon IS NOT NULL
      AND trashed_at IS NULL AND source_file_id IS NULL;

-- Maintenance backfill scan: live, non-derived files not yet extracted. The
-- scan is global (no library filter) and pages newest-first, so the index leads
-- with created_at DESC to satisfy the ORDER BY ... LIMIT directly; the partial
-- predicate keeps it tiny as the backlog drains.
CREATE INDEX CONCURRENTLY IF NOT EXISTS files_metadata_pending_idx
    ON files (created_at DESC)
    WHERE metadata_extracted_version IS NULL
      AND trashed_at IS NULL AND source_file_id IS NULL;

-- +goose Down

DROP INDEX CONCURRENTLY IF EXISTS files_metadata_pending_idx;
DROP INDEX CONCURRENTLY IF EXISTS files_library_gps_idx;
DROP INDEX CONCURRENTLY IF EXISTS files_library_captured_at_idx;

ALTER TABLE files DROP COLUMN IF EXISTS camera_model;
ALTER TABLE files DROP COLUMN IF EXISTS camera_make;
ALTER TABLE files DROP COLUMN IF EXISTS gps_lon;
ALTER TABLE files DROP COLUMN IF EXISTS gps_lat;
ALTER TABLE files DROP COLUMN IF EXISTS captured_at;
ALTER TABLE files DROP COLUMN IF EXISTS metadata_attempts;
ALTER TABLE files DROP COLUMN IF EXISTS metadata_extracted_version;
ALTER TABLE files DROP COLUMN IF EXISTS metadata_version;
ALTER TABLE files DROP COLUMN IF EXISTS metadata_error;
ALTER TABLE files DROP COLUMN IF EXISTS metadata_status;
