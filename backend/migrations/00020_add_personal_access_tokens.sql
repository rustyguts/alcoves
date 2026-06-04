-- +goose Up
-- Personal access tokens are long-lived bearer credentials used by the MCP
-- server (and future integrations) to authenticate as a user without the
-- AES-GCM session cookie. Only a SHA-256 hash of the token is stored; the
-- plaintext is shown once at creation time.
CREATE TABLE IF NOT EXISTS personal_access_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_access_tokens_user_id_idx
    ON personal_access_tokens (user_id);

-- +goose Down
DROP TABLE IF EXISTS personal_access_tokens;
