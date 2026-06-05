-- +goose Up

-- imageproxy.VariantsVersion bumped 1 → 2 (timeline variant resized 240×240 q70
-- → 384×384 q80 for crisper HiDPI grid thumbnails). Reset the warmed marker so
-- the hourly pre-warm scan regenerates every live image's variant set against
-- the new registry. NULL = "never warmed" = the pending state the scan selects.
UPDATE files SET image_proxy_warmed_version = NULL WHERE trashed_at IS NULL;

-- +goose Down

-- No-op: re-warming is idempotent and the column is advisory. Leaving the reset
-- in place on rollback simply lets the (older) code re-warm against its own
-- registry, which is harmless.
SELECT 1;
