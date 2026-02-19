-- +goose Up

ALTER TABLE files
ADD COLUMN IF NOT EXISTS proxy_progress INTEGER;

ALTER TABLE files
ADD COLUMN IF NOT EXISTS proxy_eta_seconds INTEGER;

-- +goose Down

ALTER TABLE files
DROP COLUMN IF EXISTS proxy_eta_seconds;

ALTER TABLE files
DROP COLUMN IF EXISTS proxy_progress;
