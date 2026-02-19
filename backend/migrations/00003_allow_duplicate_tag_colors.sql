-- +goose Up
DROP INDEX IF EXISTS tags_library_color_idx;
CREATE INDEX IF NOT EXISTS tags_library_color_idx ON tags (library_id, color);

-- +goose Down
DROP INDEX IF EXISTS tags_library_color_idx;
CREATE UNIQUE INDEX IF NOT EXISTS tags_library_color_idx ON tags (library_id, color);
