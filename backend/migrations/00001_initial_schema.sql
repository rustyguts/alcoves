-- +goose Up

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Libraries
CREATE TABLE IF NOT EXISTS libraries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    emoji TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    face_recognition_enabled BOOLEAN NOT NULL DEFAULT false,
    owner_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Folders
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL,
    parent_folder_id UUID,
    name TEXT NOT NULL,
    trashed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folders_library_trash_parent_name_idx
    ON folders (library_id, trashed_at, parent_folder_id, name);

-- Files
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL,
    parent_folder_id UUID,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size BIGINT NOT NULL DEFAULT 0,
    owner_id UUID,
    duration INTEGER,
    width INTEGER,
    height INTEGER,
    proxy_status TEXT,
    source_file_id UUID,
    original_created_at TIMESTAMPTZ,
    trashed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_library_parent_trash_name_idx
    ON files (library_id, parent_folder_id, trashed_at, name);
CREATE INDEX IF NOT EXISTS files_owner_id_idx ON files (owner_id);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_library_name_idx ON tags (library_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS tags_library_color_idx ON tags (library_id, color);

-- File-Tag junction
CREATE TABLE IF NOT EXISTS file_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS file_tags_file_tag_idx ON file_tags (file_id, tag_id);

-- Folder-Tag junction
CREATE TABLE IF NOT EXISTS folder_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS folder_tags_folder_tag_idx ON folder_tags (folder_id, tag_id);

-- Library members
CREATE TABLE IF NOT EXISTS library_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS library_members_library_user_idx
    ON library_members (library_id, user_id);

-- Library invites
CREATE TABLE IF NOT EXISTS library_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL,
    invited_by_user_id UUID NOT NULL,
    invited_email TEXT,
    role TEXT NOT NULL DEFAULT 'viewer',
    token TEXT NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 0,
    accepted_by_user_id UUID,
    accepted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_invites_token ON library_invites (token);
CREATE INDEX IF NOT EXISTS library_invites_library_idx ON library_invites (library_id);
CREATE INDEX IF NOT EXISTS library_invites_inviter_idx ON library_invites (invited_by_user_id);
CREATE INDEX IF NOT EXISTS library_invites_email_idx ON library_invites (invited_email);

-- Accounts (OAuth linkage)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_idx
    ON accounts (provider, provider_account_id);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    session_token TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions (session_token);

-- People (face recognition clusters)
CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL,
    name TEXT,
    cover_face_detection_id UUID,
    face_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_library_id_idx ON people (library_id);
CREATE INDEX IF NOT EXISTS people_library_name_idx ON people (library_id, name);

-- Face detections
CREATE TABLE IF NOT EXISTS face_detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL,
    library_id UUID NOT NULL,
    person_id UUID,
    box_x INTEGER NOT NULL,
    box_y INTEGER NOT NULL,
    box_width INTEGER NOT NULL,
    box_height INTEGER NOT NULL,
    image_width INTEGER NOT NULL,
    image_height INTEGER NOT NULL,
    confidence INTEGER NOT NULL,
    quality_score INTEGER,
    embedding vector(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS face_detections_file_id_idx ON face_detections (file_id);
CREATE INDEX IF NOT EXISTS face_detections_library_id_idx ON face_detections (library_id);
CREATE INDEX IF NOT EXISTS face_detections_person_id_idx ON face_detections (person_id);

-- +goose Down

DROP TABLE IF EXISTS face_detections;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS library_invites;
DROP TABLE IF EXISTS library_members;
DROP TABLE IF EXISTS folder_tags;
DROP TABLE IF EXISTS file_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS libraries;
DROP TABLE IF EXISTS users;
DROP EXTENSION IF EXISTS vector;
