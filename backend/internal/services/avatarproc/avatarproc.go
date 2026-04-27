// Package avatarproc normalizes user-uploaded avatars to a consistent WebP
// representation. Inputs may be PNG, JPEG, GIF, BMP, TIFF, or WebP; output
// is always a square WebP capped at MaxAvatarSize pixels per side.
package avatarproc

import (
	"errors"
	"fmt"

	"github.com/davidbyttow/govips/v2/vips"
)

const (
	// MaxAvatarSize bounds avatar resolution. Larger inputs are downscaled to
	// fit. Avatars render at <=64px in the UI today, so 512 leaves headroom
	// for retina without bloating storage.
	MaxAvatarSize = 512

	// WebpQuality is the libvips Q setting for the WebP encoder. 85 is the
	// govips/cwebp default sweet spot for photographic content.
	WebpQuality = 85

	// MaxInputBytes is the hard ceiling on accepted upload size. Anything
	// larger is almost certainly not an avatar; reject before decoding so a
	// hostile upload can't pin libvips memory.
	MaxInputBytes = 8 * 1024 * 1024
)

// ErrEmptyInput is returned when the caller passes a zero-length buffer.
var ErrEmptyInput = errors.New("avatarproc: empty input")

// ErrInputTooLarge is returned when the input exceeds MaxInputBytes.
var ErrInputTooLarge = errors.New("avatarproc: input too large")

// ErrInvalidImage is returned when libvips can't decode the input as an image.
var ErrInvalidImage = errors.New("avatarproc: input is not a decodable image")

// Process accepts arbitrary image bytes and returns a normalized WebP buffer
// suitable for storage as a user avatar. The returned buffer is always WebP
// regardless of the input format.
//
// Steps:
//  1. Validate non-empty + within size cap.
//  2. Decode via libvips (rejects non-image input).
//  3. Apply EXIF auto-rotate so portrait phone uploads aren't sideways.
//  4. Center-crop to a square so avatar circles render evenly.
//  5. Downscale to MaxAvatarSize when larger; never upscale.
//  6. Encode as WebP (quality WebpQuality, lossy — avatars don't need lossless).
func Process(input []byte) ([]byte, error) {
	if len(input) == 0 {
		return nil, ErrEmptyInput
	}
	if len(input) > MaxInputBytes {
		return nil, ErrInputTooLarge
	}

	img, err := vips.NewImageFromBuffer(input)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidImage, err)
	}
	defer img.Close()

	if err := img.AutoRotate(); err != nil {
		return nil, fmt.Errorf("avatarproc: auto-rotate failed: %w", err)
	}

	w, h := img.Width(), img.Height()
	if w <= 0 || h <= 0 {
		return nil, ErrInvalidImage
	}

	side := min(w, h)
	cropX := (w - side) / 2
	cropY := (h - side) / 2
	if err := img.ExtractArea(cropX, cropY, side, side); err != nil {
		return nil, fmt.Errorf("avatarproc: crop failed: %w", err)
	}

	// Only downscale; upscaling a tiny avatar wouldn't add detail.
	if side > MaxAvatarSize {
		scale := float64(MaxAvatarSize) / float64(side)
		if err := img.Resize(scale, vips.KernelLanczos3); err != nil {
			return nil, fmt.Errorf("avatarproc: resize failed: %w", err)
		}
	}

	params := vips.NewWebpExportParams()
	params.Quality = WebpQuality
	out, _, err := img.ExportWebp(params)
	if err != nil {
		return nil, fmt.Errorf("avatarproc: webp export failed: %w", err)
	}
	return out, nil
}
