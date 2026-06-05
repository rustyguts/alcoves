-- +goose NO TRANSACTION
--
-- This migration builds its indexes CONCURRENTLY (mirrors 00021/00022), which
-- cannot run inside a transaction. Every statement is idempotent (IF [NOT]
-- EXISTS) so a re-run after a mid-migration failure is harmless.
--
-- These partial indexes back the job reaper's per-spec scan
-- (internal/services/jobreaper). That loop runs every few minutes on every
-- worker/all node and selects rows whose job status is still non-terminal:
--
--   SELECT id FROM <table>
--   WHERE <status_col> IN ('queued','processing')
--     AND trashed_at IS NULL
--     AND updated_at < NOW() - grace
--   ORDER BY updated_at ASC
--   LIMIT n
--
-- Without an index this degrades into a sequential scan of files/moments as the
-- tables grow. A partial index whose predicate matches the non-terminal status
-- filter stays tiny (only in-flight rows are indexed — typically a handful — and
-- a row drops out the moment it reaches a terminal state) and its updated_at key
-- satisfies the ORDER BY ... LIMIT directly. One index per reaped status column.

-- +goose Up

CREATE INDEX CONCURRENTLY IF NOT EXISTS files_transcribe_reap_idx
    ON files (updated_at)
    WHERE transcribe_status IN ('queued', 'processing')
      AND trashed_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS files_proxy_reap_idx
    ON files (updated_at)
    WHERE proxy_status IN ('queued', 'processing')
      AND trashed_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS files_audio_detect_reap_idx
    ON files (updated_at)
    WHERE audio_detect_status IN ('queued', 'processing')
      AND trashed_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS files_waveform_reap_idx
    ON files (updated_at)
    WHERE waveform_status IN ('queued', 'processing')
      AND trashed_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS moments_export_reap_idx
    ON moments (updated_at)
    WHERE export_status IN ('queued', 'processing')
      AND trashed_at IS NULL;

-- +goose Down

DROP INDEX CONCURRENTLY IF EXISTS moments_export_reap_idx;
DROP INDEX CONCURRENTLY IF EXISTS files_waveform_reap_idx;
DROP INDEX CONCURRENTLY IF EXISTS files_audio_detect_reap_idx;
DROP INDEX CONCURRENTLY IF EXISTS files_proxy_reap_idx;
DROP INDEX CONCURRENTLY IF EXISTS files_transcribe_reap_idx;
