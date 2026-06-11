-- +goose Up
-- OAuth 2.1 authorization-server tables for MCP connections. When
-- ALCOVES_MCP_OAUTH_ENABLED is set, Alcoves acts as both an OAuth 2.1
-- Authorization Server and Resource Server for /api/mcp, so remote MCP clients
-- (e.g. Claude's custom connector) can authenticate via a browser consent flow.
--
-- Clients self-register via Dynamic Client Registration (RFC 7591). Codes and
-- tokens follow the personal_access_tokens pattern: only a SHA-256 hash is
-- stored; the plaintext is never persisted. Access tokens are audience-bound to
-- the MCP resource and accepted only at /api/mcp.

CREATE TABLE IF NOT EXISTS oauth_clients (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                  TEXT NOT NULL UNIQUE,
    client_name                TEXT NOT NULL,
    redirect_uris              JSONB NOT NULL DEFAULT '[]'::jsonb,
    grant_types                JSONB NOT NULL DEFAULT '[]'::jsonb,
    scope                      TEXT NOT NULL DEFAULT '',
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
    registration_via           TEXT NOT NULL DEFAULT 'dcr',
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash             TEXT NOT NULL UNIQUE,
    client_id             TEXT NOT NULL,
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri          TEXT NOT NULL,
    code_challenge        TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL DEFAULT 'S256',
    scope                 TEXT NOT NULL DEFAULT '',
    resource              TEXT NOT NULL DEFAULT '',
    expires_at            TIMESTAMPTZ NOT NULL,
    consumed_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_authorization_codes_user_id_idx
    ON oauth_authorization_codes (user_id);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash   TEXT NOT NULL UNIQUE,
    client_id    TEXT NOT NULL,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope        TEXT NOT NULL DEFAULT '',
    expires_at   TIMESTAMPTZ NOT NULL,
    rotated_from UUID,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_user_id_idx
    ON oauth_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_client_id_idx
    ON oauth_refresh_tokens (client_id);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash       TEXT NOT NULL UNIQUE,
    client_id        TEXT NOT NULL,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope            TEXT NOT NULL DEFAULT '',
    resource         TEXT NOT NULL DEFAULT '',
    expires_at       TIMESTAMPTZ NOT NULL,
    last_used_at     TIMESTAMPTZ,
    refresh_token_id UUID REFERENCES oauth_refresh_tokens(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_id_idx
    ON oauth_access_tokens (user_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_client_id_idx
    ON oauth_access_tokens (client_id);

-- +goose Down
DROP TABLE IF EXISTS oauth_access_tokens;
DROP TABLE IF EXISTS oauth_refresh_tokens;
DROP TABLE IF EXISTS oauth_authorization_codes;
DROP TABLE IF EXISTS oauth_clients;
