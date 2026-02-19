-- +goose Up

ALTER TABLE folders
ADD COLUMN IF NOT EXISTS owner_id UUID;

CREATE INDEX IF NOT EXISTS folders_owner_id_idx ON folders (owner_id);

-- +goose Down

DROP INDEX IF EXISTS folders_owner_id_idx;

ALTER TABLE folders
DROP COLUMN IF EXISTS owner_id;
