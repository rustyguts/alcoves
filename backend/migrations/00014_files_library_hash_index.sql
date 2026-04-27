-- +goose Up
CREATE INDEX IF NOT EXISTS files_library_hash_idx
  ON files (library_id, hash)
  WHERE hash IS NOT NULL AND trashed_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS files_library_hash_idx;
