-- +goose Up
CREATE TABLE IF NOT EXISTS app_settings (
    id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id)
);

INSERT INTO app_settings (id, settings)
VALUES (1, '{"registration_mode":"open"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS app_settings;
