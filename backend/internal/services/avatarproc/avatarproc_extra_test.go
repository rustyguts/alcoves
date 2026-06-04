package avatarproc

import (
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
)

// TestProcess_TallPortraitCropsToSquare exercises the crop path on a portrait
// (height > width) input, complementing the existing wide-rectangle test.
func TestProcess_TallPortraitCropsToSquare(t *testing.T) {
	out, err := Process(makePNG(t, 200, 400))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	w, h := dims(t, out)
	if w != h {
		t.Errorf("expected square output, got %dx%d", w, h)
	}
	if w != 200 {
		t.Errorf("expected 200x200, got %dx%d", w, h)
	}
}

// TestProcess_WebpInputRoundTrips verifies a WebP input is accepted and
// re-encoded as WebP (the output is always WebP regardless of input format).
func TestProcess_WebpInputRoundTrips(t *testing.T) {
	// Build a WebP source via vips from a PNG.
	img, err := vips.NewImageFromBuffer(makePNG(t, 300, 300))
	if err != nil {
		t.Fatalf("decode png: %v", err)
	}
	webpIn, _, err := img.ExportWebp(vips.NewWebpExportParams())
	img.Close()
	if err != nil {
		t.Fatalf("export webp: %v", err)
	}

	out, err := Process(webpIn)
	if err != nil {
		t.Fatalf("Process(webp): %v", err)
	}
	if !hasWebpMagic(out) {
		t.Fatal("output is not WebP")
	}
	w, h := dims(t, out)
	if w != 300 || h != 300 {
		t.Errorf("expected 300x300, got %dx%d", w, h)
	}
}

// TestProcess_OversizedRectangleCropsThenDownscales exercises both the crop
// AND the downscale branches together: a 1000x1500 input crops to 1000x1000
// then downscales to MaxAvatarSize.
func TestProcess_OversizedRectangleCropsThenDownscales(t *testing.T) {
	out, err := Process(makePNG(t, 1000, 1500))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	w, h := dims(t, out)
	if w != MaxAvatarSize || h != MaxAvatarSize {
		t.Errorf("expected %dx%d, got %dx%d", MaxAvatarSize, MaxAvatarSize, w, h)
	}
}
