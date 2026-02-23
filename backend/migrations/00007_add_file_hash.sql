-- +goose Up
ALTER TABLE files ADD COLUMN IF NOT EXISTS hash TEXT;
CREATE INDEX IF NOT EXISTS files_hash_idx ON files (hash) WHERE hash IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS files_hash_idx;
ALTER TABLE files DROP COLUMN IF EXISTS hash;
