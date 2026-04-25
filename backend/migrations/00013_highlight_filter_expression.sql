-- +goose Up

ALTER TABLE highlight_filters ADD COLUMN IF NOT EXISTS expression TEXT;
ALTER TABLE highlight_filters ADD COLUMN IF NOT EXISTS proximity_seconds INTEGER NOT NULL DEFAULT 5;

UPDATE highlight_filters
SET expression = COALESCE(
  expression,
  CASE
    WHEN kind = 'keyword' THEN 'word:' || pattern
    WHEN kind = 'audio_label' THEN
      CASE WHEN min_score > 0 THEN pattern || ':' || (min_score * 100)::int::text
           ELSE pattern
      END
    ELSE pattern
  END
)
WHERE expression IS NULL;

UPDATE highlight_filters SET expression = '' WHERE expression IS NULL;
ALTER TABLE highlight_filters ALTER COLUMN expression SET NOT NULL;

ALTER TABLE highlight_filters DROP CONSTRAINT IF EXISTS highlight_filters_kind_check;
ALTER TABLE highlight_filters DROP COLUMN IF EXISTS kind;
ALTER TABLE highlight_filters DROP COLUMN IF EXISTS pattern;
ALTER TABLE highlight_filters DROP COLUMN IF EXISTS min_score;

-- +goose Down

ALTER TABLE highlight_filters ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'audio_label';
ALTER TABLE highlight_filters ADD COLUMN IF NOT EXISTS pattern TEXT NOT NULL DEFAULT '';
ALTER TABLE highlight_filters ADD COLUMN IF NOT EXISTS min_score REAL NOT NULL DEFAULT 0.2;
ALTER TABLE highlight_filters ADD CONSTRAINT highlight_filters_kind_check CHECK (kind IN ('audio_label','keyword'));

ALTER TABLE highlight_filters DROP COLUMN IF EXISTS proximity_seconds;
ALTER TABLE highlight_filters DROP COLUMN IF EXISTS expression;
