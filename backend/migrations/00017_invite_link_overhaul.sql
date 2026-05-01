-- +goose Up

-- Track per-user redemption history. Replaces the single accepted_by_user_id
-- column. UNIQUE(invite_id, user_id) makes re-accept idempotent.
CREATE TABLE IF NOT EXISTS library_invite_uses (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_id UUID NOT NULL REFERENCES library_invites(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT library_invite_uses_invite_user_idx UNIQUE (invite_id, user_id)
);

CREATE INDEX IF NOT EXISTS library_invite_uses_invite_idx ON library_invite_uses(invite_id);

-- Backfill: any invite that was already accepted gets a usage row.
INSERT INTO library_invite_uses (invite_id, user_id, used_at)
SELECT id, accepted_by_user_id, COALESCE(accepted_at, now())
FROM library_invites
WHERE accepted_by_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Add max_uses (NULL = unlimited)
ALTER TABLE library_invites ADD COLUMN IF NOT EXISTS max_uses INTEGER;

-- Drop columns the new model no longer uses.
ALTER TABLE library_invites DROP COLUMN IF EXISTS invited_email;
ALTER TABLE library_invites DROP COLUMN IF EXISTS role;
ALTER TABLE library_invites DROP COLUMN IF EXISTS accepted_by_user_id;
ALTER TABLE library_invites DROP COLUMN IF EXISTS accepted_at;

-- +goose Down

ALTER TABLE library_invites ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE library_invites ADD COLUMN IF NOT EXISTS accepted_by_user_id UUID;
ALTER TABLE library_invites ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer';
ALTER TABLE library_invites ADD COLUMN IF NOT EXISTS invited_email TEXT;

ALTER TABLE library_invites DROP COLUMN IF EXISTS max_uses;

DROP INDEX IF EXISTS library_invite_uses_invite_idx;
DROP TABLE IF EXISTS library_invite_uses;
