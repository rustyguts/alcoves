-- +goose Up

CREATE TABLE IF NOT EXISTS highlight_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('audio_label','keyword')),
    pattern TEXT NOT NULL,
    min_score REAL NOT NULL DEFAULT 0.2,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS highlight_filters_library_idx ON highlight_filters(library_id);

-- +goose Down

DROP INDEX IF EXISTS highlight_filters_library_idx;
DROP TABLE IF EXISTS highlight_filters;
