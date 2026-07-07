-- +goose Up
-- Live Documents: realtime collaborative markdown backed by Yjs CRDT.
--
-- A document is 1:1 with a text/markdown file (PK = file_id). The server never
-- interprets Yjs data: "snapshot" is a client-computed merged update
-- (Y.encodeStateAsUpdate) and document_updates is an append-only log of opaque
-- incremental updates with a dense per-document sequence. Updates with
-- seq <= snapshot_seq are folded into the snapshot and pruned on compaction;
-- the markdown text is materialized into the file blob at the same time so
-- downloads always return real content.

CREATE TABLE IF NOT EXISTS documents (
    file_id      UUID PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    library_id   UUID NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    last_seq     BIGINT NOT NULL DEFAULT 0,
    snapshot     BYTEA,
    snapshot_seq BIGINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_library_idx ON documents (library_id);

CREATE TABLE IF NOT EXISTS document_updates (
    file_id    UUID   NOT NULL REFERENCES documents(file_id) ON DELETE CASCADE,
    seq        BIGINT NOT NULL,
    data       BYTEA  NOT NULL,
    author_id  UUID   REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, seq)
);

-- +goose Down
DROP TABLE IF EXISTS document_updates;
DROP TABLE IF EXISTS documents;
