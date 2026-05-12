-- +goose Up

-- Canonical activity log. One row per notable event in a library.
-- Per-user notification state lives in user_notification_dismissals;
-- the bell view is derived (this table + dismissals + users.notifications_cleared_before).
-- See plan: /home/rusty/.claude/plans/design-a-detailed-and-dazzling-pillow.md
CREATE TABLE IF NOT EXISTS library_activities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id   UUID NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id   UUID,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-library feed pagination: ORDER BY created_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS library_activities_library_created_idx
    ON library_activities (library_id, created_at DESC, id DESC);

-- "All recent activity in libraries I belong to, excluding my own" — the global feed.
CREATE INDEX IF NOT EXISTS library_activities_actor_created_idx
    ON library_activities (actor_id, library_id, created_at DESC);

-- "Show me everything that happened to this file/folder/moment."
CREATE INDEX IF NOT EXISTS library_activities_subject_idx
    ON library_activities (subject_type, subject_id);

-- Per-user, per-activity dismissal. Sparse: only rows for activities the user
-- explicitly clicked "dismiss" on. /dismiss-all uses the watermark column
-- on users (below) instead of bulk-inserting rows.
CREATE TABLE IF NOT EXISTS user_notification_dismissals (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_id  UUID NOT NULL REFERENCES library_activities(id) ON DELETE CASCADE,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, activity_id)
);

-- "Dismiss everything older than now" watermark. Cheap O(1) write,
-- works around having to insert thousands of dismissal rows per click.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notifications_cleared_before TIMESTAMPTZ;

-- +goose Down

ALTER TABLE users DROP COLUMN IF EXISTS notifications_cleared_before;
DROP TABLE IF EXISTS user_notification_dismissals;
DROP INDEX IF EXISTS library_activities_subject_idx;
DROP INDEX IF EXISTS library_activities_actor_created_idx;
DROP INDEX IF EXISTS library_activities_library_created_idx;
DROP TABLE IF EXISTS library_activities;
