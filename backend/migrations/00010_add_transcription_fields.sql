-- +goose Up

ALTER TABLE files ADD COLUMN IF NOT EXISTS transcribe_status TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcribe_progress INTEGER;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcribe_eta_seconds INTEGER;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcribe_error TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcribe_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcribed_version INTEGER;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcript_text TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcript_vtt TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS transcript_model TEXT;

-- +goose Down

ALTER TABLE files DROP COLUMN IF EXISTS transcript_model;
ALTER TABLE files DROP COLUMN IF EXISTS transcript_vtt;
ALTER TABLE files DROP COLUMN IF EXISTS transcript_text;
ALTER TABLE files DROP COLUMN IF EXISTS transcribed_version;
ALTER TABLE files DROP COLUMN IF EXISTS transcribe_version;
ALTER TABLE files DROP COLUMN IF EXISTS transcribe_error;
ALTER TABLE files DROP COLUMN IF EXISTS transcribe_eta_seconds;
ALTER TABLE files DROP COLUMN IF EXISTS transcribe_progress;
ALTER TABLE files DROP COLUMN IF EXISTS transcribe_status;
