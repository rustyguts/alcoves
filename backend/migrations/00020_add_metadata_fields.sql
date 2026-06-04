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

-- Timeline keyset pagination: ORDER BY captured_at DESC, id DESC over live,
-- non-derived files.
CREATE INDEX IF NOT EXISTS files_library_captured_at_idx
    ON files (library_id, captured_at DESC, id DESC)
    WHERE trashed_at IS NULL AND source_file_id IS NULL;

-- Map: only geotagged live files; small + highly selective partial index.
CREATE INDEX IF NOT EXISTS files_library_gps_idx
    ON files (library_id)
    WHERE gps_lat IS NOT NULL AND gps_lon IS NOT NULL
      AND trashed_at IS NULL AND source_file_id IS NULL;

-- Maintenance backfill scan: live, non-derived files not yet extracted.
CREATE INDEX IF NOT EXISTS files_metadata_pending_idx
    ON files (library_id)
    WHERE metadata_extracted_version IS NULL
      AND trashed_at IS NULL AND source_file_id IS NULL;

-- +goose Down

DROP INDEX IF EXISTS files_metadata_pending_idx;
DROP INDEX IF EXISTS files_library_gps_idx;
DROP INDEX IF EXISTS files_library_captured_at_idx;

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
