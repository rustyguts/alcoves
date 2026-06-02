-- +goose NO TRANSACTION

-- +goose Up

-- HNSW index for cosine ANN lookups on face embeddings.
-- CONCURRENTLY avoids a full table lock on existing production data.
-- m=16 / ef_construction=64 are standard balanced defaults for 512-dim face embeddings.
CREATE INDEX CONCURRENTLY IF NOT EXISTS face_detections_embedding_hnsw_idx
    ON face_detections
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- +goose Down

DROP INDEX IF EXISTS face_detections_embedding_hnsw_idx;
