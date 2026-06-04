package objectdetection

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
)

func init() {
	vips.Startup(nil)
}

// makeTestPNG returns a solid-color RGB PNG of the requested dimensions.
func makeTestPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func TestExportRawRGB_ProducesThreeBytesPerPixel(t *testing.T) {
	img, err := vips.NewImageFromBuffer(makeTestPNG(t, 8, 6))
	if err != nil {
		t.Fatalf("load image: %v", err)
	}
	defer img.Close()

	w, h := img.Width(), img.Height()
	raw, err := exportRawRGB(img)
	if err != nil {
		t.Fatalf("exportRawRGB: %v", err)
	}
	if len(raw) != w*h*3 {
		t.Fatalf("raw RGB len = %d, want %d", len(raw), w*h*3)
	}
}

func TestExportRawRGB_FlattensAlpha(t *testing.T) {
	// RGBA PNG (4 bands) — exportRawRGB must flatten to 3 bands.
	img, err := vips.NewImageFromBuffer(makeTestPNG(t, 4, 4))
	if err != nil {
		t.Fatalf("load image: %v", err)
	}
	defer img.Close()
	raw, err := exportRawRGB(img)
	if err != nil {
		t.Fatalf("exportRawRGB: %v", err)
	}
	if len(raw) != 4*4*3 {
		t.Errorf("len = %d, want 48", len(raw))
	}
}

func TestPreprocessForDetection_TensorShapeAndRange(t *testing.T) {
	img, err := vips.NewImageFromBuffer(makeTestPNG(t, 100, 50))
	if err != nil {
		t.Fatalf("load image: %v", err)
	}
	defer img.Close()

	tensor, err := preprocessForDetection(img)
	if err != nil {
		t.Fatalf("preprocessForDetection: %v", err)
	}
	wantLen := 3 * inputSize * inputSize
	if len(tensor) != wantLen {
		t.Fatalf("tensor len = %d, want %d", len(tensor), wantLen)
	}
	// All values must be normalized into [0, 1].
	for i, v := range tensor {
		if v < 0 || v > 1 {
			t.Fatalf("tensor[%d] = %v out of [0,1]", i, v)
		}
	}
}
