-- +goose Up

ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_detect_status TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_detect_progress INTEGER;
ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_detect_eta_seconds INTEGER;
ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_detect_error TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_detect_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_detected_version INTEGER;
ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_detect_model TEXT;

CREATE TABLE IF NOT EXISTS audio_detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    library_id UUID NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    class_index INTEGER NOT NULL,
    score REAL NOT NULL,
    start_seconds REAL NOT NULL,
    end_seconds REAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audio_detections_file_id_idx ON audio_detections(file_id);
CREATE INDEX IF NOT EXISTS audio_detections_library_id_idx ON audio_detections(library_id);
CREATE INDEX IF NOT EXISTS audio_detections_file_start_idx ON audio_detections(file_id, start_seconds);

-- +goose Down

DROP INDEX IF EXISTS audio_detections_file_start_idx;
DROP INDEX IF EXISTS audio_detections_library_id_idx;
DROP INDEX IF EXISTS audio_detections_file_id_idx;
DROP TABLE IF EXISTS audio_detections;

ALTER TABLE files DROP COLUMN IF EXISTS audio_detect_model;
ALTER TABLE files DROP COLUMN IF EXISTS audio_detected_version;
ALTER TABLE files DROP COLUMN IF EXISTS audio_detect_version;
ALTER TABLE files DROP COLUMN IF EXISTS audio_detect_error;
ALTER TABLE files DROP COLUMN IF EXISTS audio_detect_eta_seconds;
ALTER TABLE files DROP COLUMN IF EXISTS audio_detect_progress;
ALTER TABLE files DROP COLUMN IF EXISTS audio_detect_status;
