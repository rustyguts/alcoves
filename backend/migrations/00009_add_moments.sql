-- +goose Up
CREATE TABLE IF NOT EXISTS moments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL,
    library_id UUID NOT NULL,
    created_by_id UUID NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    start_seconds NUMERIC(12,3) NOT NULL,
    end_seconds NUMERIC(12,3) NOT NULL,
    export_status TEXT,
    export_progress INTEGER,
    export_eta_seconds INTEGER,
    export_version INTEGER NOT NULL DEFAULT 1,
    exported_version INTEGER,
    trashed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT moments_range_chk CHECK (end_seconds > start_seconds)
);
CREATE INDEX IF NOT EXISTS moments_file_idx    ON moments (file_id, trashed_at, start_seconds);
CREATE INDEX IF NOT EXISTS moments_library_idx ON moments (library_id, trashed_at);

CREATE TABLE IF NOT EXISTS moment_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moment_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS moment_tags_moment_tag_idx ON moment_tags (moment_id, tag_id);
CREATE INDEX IF NOT EXISTS moment_tags_tag_idx ON moment_tags (tag_id);

CREATE TABLE IF NOT EXISTS moment_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moment_id UUID NOT NULL,
    library_id UUID NOT NULL,
    created_by_id UUID NOT NULL,
    token TEXT NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS moment_shares_token_idx  ON moment_shares (token);
CREATE INDEX IF NOT EXISTS moment_shares_moment_idx ON moment_shares (moment_id);

-- +goose Down
DROP TABLE IF EXISTS moment_shares;
DROP TABLE IF EXISTS moment_tags;
DROP TABLE IF EXISTS moments;
