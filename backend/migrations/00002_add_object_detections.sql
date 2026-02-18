-- +goose Up

-- Per-library toggle for object detection
ALTER TABLE libraries ADD COLUMN IF NOT EXISTS object_detection_enabled BOOLEAN NOT NULL DEFAULT false;

-- Object detections (one row per detected object per image)
CREATE TABLE IF NOT EXISTS object_detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL,
    library_id UUID NOT NULL,
    label TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    box_x INTEGER NOT NULL,
    box_y INTEGER NOT NULL,
    box_width INTEGER NOT NULL,
    box_height INTEGER NOT NULL,
    image_width INTEGER NOT NULL,
    image_height INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS object_detections_file_id_idx ON object_detections (file_id);
CREATE INDEX IF NOT EXISTS object_detections_library_id_idx ON object_detections (library_id);
CREATE INDEX IF NOT EXISTS object_detections_label_idx ON object_detections (library_id, label);

-- +goose Down

DROP TABLE IF EXISTS object_detections;
ALTER TABLE libraries DROP COLUMN IF EXISTS object_detection_enabled;
