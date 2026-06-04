-- +goose NO TRANSACTION
--
-- This migration builds its index CONCURRENTLY (mirrors 00021), which cannot run
-- inside a transaction. The ADD COLUMN statements are metadata-only on PG11+
-- (constant defaults don't rewrite the table), so running them outside a
-- transaction is safe; every statement is idempotent (IF [NOT] EXISTS) so a
-- re-run after a mid-migration failure is harmless.

-- +goose Up

-- Image-proxy variant pre-warm job-tracking columns (mirrors the metadata_*
-- status/attempts pattern). The hourly maintenance loop reads these to decide
-- which images still need their cache variants generated, and to drop a
-- permanently-broken file after 3 strikes.
ALTER TABLE files ADD COLUMN IF NOT EXISTS image_proxy_status TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS image_proxy_error TEXT;
-- Failure counter consulted by the maintenance scan: a file whose variants fail
-- to generate 3 times (e.g. a corrupted image) is dropped from the scan so it
-- is never re-queued forever.
ALTER TABLE files ADD COLUMN IF NOT EXISTS image_proxy_attempts INTEGER NOT NULL DEFAULT 0;
-- The imageproxy.VariantsVersion this row was last fully warmed at. NULL = never
-- warmed (the pending state the scan selects on). Bumping VariantsVersion in code
-- and resetting this column to NULL re-warms every file against the new set.
ALTER TABLE files ADD COLUMN IF NOT EXISTS image_proxy_warmed_version INTEGER;

-- Maintenance pre-warm scan: live image files not yet warmed. The scan is global
-- (no library filter) and pages newest-first, so the index leads with created_at
-- DESC to satisfy the ORDER BY ... LIMIT directly; the partial predicate keeps it
-- tiny as the backlog drains. Unlike the metadata scan we do NOT exclude
-- source_file_id IS NOT NULL — derived video-thumbnail images are themselves
-- shown in the grid/search/timeline and need their variants warmed too.
CREATE INDEX CONCURRENTLY IF NOT EXISTS files_image_proxy_pending_idx
    ON files (created_at DESC)
    WHERE image_proxy_warmed_version IS NULL
      AND trashed_at IS NULL;

-- +goose Down

DROP INDEX CONCURRENTLY IF EXISTS files_image_proxy_pending_idx;

ALTER TABLE files DROP COLUMN IF EXISTS image_proxy_warmed_version;
ALTER TABLE files DROP COLUMN IF EXISTS image_proxy_attempts;
ALTER TABLE files DROP COLUMN IF EXISTS image_proxy_error;
ALTER TABLE files DROP COLUMN IF EXISTS image_proxy_status;
