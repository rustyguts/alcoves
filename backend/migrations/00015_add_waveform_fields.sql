-- +goose Up
ALTER TABLE files ADD COLUMN waveform_status TEXT;
ALTER TABLE files ADD COLUMN waveform_progress INTEGER;
ALTER TABLE files ADD COLUMN waveform_error TEXT;
ALTER TABLE files ADD COLUMN waveform_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN waveformed_version INTEGER;
ALTER TABLE files ADD COLUMN waveform_peaks_per_second INTEGER NOT NULL DEFAULT 50;

-- +goose Down
ALTER TABLE files DROP COLUMN IF EXISTS waveform_status;
ALTER TABLE files DROP COLUMN IF EXISTS waveform_progress;
ALTER TABLE files DROP COLUMN IF EXISTS waveform_error;
ALTER TABLE files DROP COLUMN IF EXISTS waveform_version;
ALTER TABLE files DROP COLUMN IF EXISTS waveformed_version;
ALTER TABLE files DROP COLUMN IF EXISTS waveform_peaks_per_second;