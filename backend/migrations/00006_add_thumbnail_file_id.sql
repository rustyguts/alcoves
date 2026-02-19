-- +goose Up

ALTER TABLE files
ADD COLUMN IF NOT EXISTS thumbnail_file_id UUID;

CREATE INDEX IF NOT EXISTS files_thumbnail_file_id_idx ON files (thumbnail_file_id);

-- +goose Down

DROP INDEX IF EXISTS files_thumbnail_file_id_idx;

ALTER TABLE files
DROP COLUMN IF EXISTS thumbnail_file_id;
