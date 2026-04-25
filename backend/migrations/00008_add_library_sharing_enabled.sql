-- +goose Up
ALTER TABLE libraries ADD COLUMN IF NOT EXISTS sharing_enabled BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE libraries DROP COLUMN IF EXISTS sharing_enabled;
