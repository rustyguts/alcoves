package seed

import (
	"bytes"
	"embed"
	"fmt"
	"image"
	// Register the JPEG decoder so image.DecodeConfig can read seed photo dimensions.
	_ "image/jpeg"
	"path"
)

// assetsFS holds the small synthetic media files copied into storage by the
// seeder. They are labeled gradients / short tone videos — not real photos — so
// every view (grid, video player, people, map, timeline) renders representative
// content in local dev without shipping real images. Regenerate with
// assets/generate.sh. Embedding keeps `go test ./internal/seed/...` and the
// docker image identical (no external paths to mount).
//
//go:embed assets/images/*.jpg assets/videos/*.mp4 assets/audio/*.mp3 assets/thumbs/*.webp assets/faces/*.webp assets/docs/*.md
var assetsFS embed.FS

// asset reads an embedded asset by its path relative to the assets directory,
// e.g. "images/beach-sunset.jpg".
func asset(rel string) ([]byte, error) {
	data, err := assetsFS.ReadFile(path.Join("assets", rel))
	if err != nil {
		return nil, fmt.Errorf("seed asset %q: %w", rel, err)
	}
	return data, nil
}

// mustAsset is asset() for call sites that treat a missing embedded file as a
// programming error (the manifest and the embedded tree are committed together).
func mustAsset(rel string) []byte {
	data, err := asset(rel)
	if err != nil {
		panic(err)
	}
	return data
}

// imageDims returns the pixel dimensions of an embedded JPEG asset.
func imageDims(data []byte) (w, h int, err error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0, fmt.Errorf("decode image config: %w", err)
	}
	return cfg.Width, cfg.Height, nil
}
