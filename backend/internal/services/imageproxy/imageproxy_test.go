package imageproxy

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
)

func init() {
	vips.Startup(nil)
}

// makeTestJPEG creates a minimal JPEG image with the given dimensions.
func makeTestJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	// Fill with a solid colour so compression artefacts are predictable.
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 100, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatalf("Failed to encode test JPEG: %v", err)
	}
	return buf.Bytes()
}

// makeTestPNG creates a minimal PNG image with the given dimensions.
func makeTestPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 100, G: 200, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("Failed to encode test PNG: %v", err)
	}
	return buf.Bytes()
}

// readDimensions loads output bytes into vips to check the resulting width/height.
func readDimensions(t *testing.T, data []byte) (int, int) {
	t.Helper()
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatalf("Failed to read output image: %v", err)
	}
	defer img.Close()
	return img.Width(), img.Height()
}

// isProgressiveJPEG returns true if the data contains a SOF2 marker (0xFF 0xC2)
// which indicates progressive/interlaced JPEG encoding. Baseline JPEGs use
// SOF0 (0xFF 0xC0) instead.
func isProgressiveJPEG(data []byte) bool {
	for i := 0; i < len(data)-1; i++ {
		if data[i] == 0xFF && data[i+1] == 0xC2 {
			return true
		}
	}
	return false
}

// countSOSMarkers counts the number of SOS (Start of Scan, 0xFF 0xDA) markers
// in a JPEG. Progressive JPEGs have multiple SOS markers (one per scan pass).
func countSOSMarkers(data []byte) int {
	count := 0
	for i := 0; i < len(data)-1; i++ {
		if data[i] == 0xFF && data[i+1] == 0xDA {
			count++
		}
	}
	return count
}

// ---------------------------------------------------------------------------
// VipsProcessor integration tests
// ---------------------------------------------------------------------------

func TestVipsTransform_ResizeWidth(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 1000, 800)

	out, mime, err := proc.Transform(src, TransformOptions{Width: 500})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}
	if mime != "image/jpeg" {
		t.Errorf("Expected mime image/jpeg, got %s", mime)
	}

	w, h := readDimensions(t, out)
	if w != 500 {
		t.Errorf("Expected width 500, got %d", w)
	}
	// Aspect ratio preserved: 800 * (500/1000) = 400
	if h != 400 {
		t.Errorf("Expected height 400, got %d", h)
	}
}

func TestVipsTransform_ResizeHeight(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 1000, 800)

	out, _, err := proc.Transform(src, TransformOptions{Height: 400})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}

	w, h := readDimensions(t, out)
	if h != 400 {
		t.Errorf("Expected height 400, got %d", h)
	}
	// Aspect ratio: 1000 * (400/800) = 500
	if w != 500 {
		t.Errorf("Expected width 500, got %d", w)
	}
}

func TestVipsTransform_ResizeBothDimensions_FitInside(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 2000, 1000)

	// Request 800x800 box — the image is 2:1, so width constrains first.
	out, _, err := proc.Transform(src, TransformOptions{Width: 800, Height: 800})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}

	w, h := readDimensions(t, out)
	if w != 800 {
		t.Errorf("Expected width 800, got %d", w)
	}
	// 1000 * (800/2000) = 400
	if h != 400 {
		t.Errorf("Expected height 400, got %d", h)
	}
}

func TestVipsTransform_NoUpscale(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 200, 150)

	// Request larger than original — should not upscale.
	out, _, err := proc.Transform(src, TransformOptions{Width: 1000, Height: 1000})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}

	w, h := readDimensions(t, out)
	if w != 200 {
		t.Errorf("Expected width 200 (no upscale), got %d", w)
	}
	if h != 150 {
		t.Errorf("Expected height 150 (no upscale), got %d", h)
	}
}

func TestVipsTransform_FormatWebp(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 100, 100)

	out, mime, err := proc.Transform(src, TransformOptions{Format: "webp", Quality: 80})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}
	if mime != "image/webp" {
		t.Errorf("Expected mime image/webp, got %s", mime)
	}
	// WebP files start with "RIFF"
	if len(out) < 4 || string(out[:4]) != "RIFF" {
		t.Error("Output does not appear to be a valid WebP file")
	}
}

func TestVipsTransform_FormatPng(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 100, 100)

	out, mime, err := proc.Transform(src, TransformOptions{Format: "png"})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}
	if mime != "image/png" {
		t.Errorf("Expected mime image/png, got %s", mime)
	}
	// PNG magic bytes
	if len(out) < 8 || string(out[1:4]) != "PNG" {
		t.Error("Output does not appear to be a valid PNG file")
	}
}

func TestVipsTransform_FormatAvif(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 100, 100)

	out, mime, err := proc.Transform(src, TransformOptions{Format: "avif", Quality: 60})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}
	if mime != "image/avif" {
		t.Errorf("Expected mime image/avif, got %s", mime)
	}
	if len(out) == 0 {
		t.Error("Expected non-empty AVIF output")
	}
}

func TestVipsTransform_FormatJpeg(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestPNG(t, 100, 100)

	out, mime, err := proc.Transform(src, TransformOptions{Format: "jpeg", Quality: 90})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}
	if mime != "image/jpeg" {
		t.Errorf("Expected mime image/jpeg, got %s", mime)
	}
	// JPEG starts with 0xFF 0xD8
	if len(out) < 2 || out[0] != 0xFF || out[1] != 0xD8 {
		t.Error("Output does not appear to be a valid JPEG file")
	}
}

func TestVipsTransform_JpegIsProgressive(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 400, 300)

	out, _, err := proc.Transform(src, TransformOptions{Format: "jpeg", Quality: 80})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}

	if !isProgressiveJPEG(out) {
		t.Error("Expected progressive JPEG (SOF2 marker), got baseline (SOF0)")
	}

	// Progressive JPEGs have multiple SOS markers (one per scan pass).
	sosCount := countSOSMarkers(out)
	if sosCount < 2 {
		t.Errorf("Expected multiple SOS markers for progressive JPEG, got %d", sosCount)
	}
}

func TestVipsTransform_JpegDefaultQuality80(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 400, 300)

	// Quality 0 triggers default (80). Compare output to explicit quality=80.
	defaultQ, _, err := proc.Transform(src, TransformOptions{Format: "jpeg"})
	if err != nil {
		t.Fatalf("Transform (default quality) failed: %v", err)
	}

	explicitQ, _, err := proc.Transform(src, TransformOptions{Format: "jpeg", Quality: 80})
	if err != nil {
		t.Fatalf("Transform (explicit q80) failed: %v", err)
	}

	// Byte-for-byte identical when same quality is used.
	if !bytes.Equal(defaultQ, explicitQ) {
		t.Errorf("Expected default quality output (%d bytes) to match explicit q80 output (%d bytes)",
			len(defaultQ), len(explicitQ))
	}
}

func TestVipsTransform_QualityAffectsOutputSize(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 500, 500)

	highQ, _, err := proc.Transform(src, TransformOptions{Quality: 95, Format: "jpeg"})
	if err != nil {
		t.Fatalf("Transform (high quality) failed: %v", err)
	}

	lowQ, _, err := proc.Transform(src, TransformOptions{Quality: 10, Format: "jpeg"})
	if err != nil {
		t.Fatalf("Transform (low quality) failed: %v", err)
	}

	if len(lowQ) >= len(highQ) {
		t.Errorf("Expected low quality (%d bytes) to be smaller than high quality (%d bytes)", len(lowQ), len(highQ))
	}
}

func TestVipsTransform_DefaultQuality(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 200, 200)

	// Quality 0 should use default (80), not produce an error.
	_, mime, err := proc.Transform(src, TransformOptions{Format: "webp"})
	if err != nil {
		t.Fatalf("Transform failed with default quality: %v", err)
	}
	if mime != "image/webp" {
		t.Errorf("Expected mime image/webp, got %s", mime)
	}
}

func TestVipsTransform_DefaultFormat(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 200, 200)

	// Empty format should default to JPEG.
	out, mime, err := proc.Transform(src, TransformOptions{Width: 100})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}
	if mime != "image/jpeg" {
		t.Errorf("Expected default mime image/jpeg, got %s", mime)
	}
	if len(out) < 2 || out[0] != 0xFF || out[1] != 0xD8 {
		t.Error("Output does not appear to be a valid JPEG file")
	}
}

func TestVipsTransform_ResizeAndConvert(t *testing.T) {
	proc := NewVipsProcessor()
	src := makeTestJPEG(t, 1200, 900)

	out, mime, err := proc.Transform(src, TransformOptions{
		Width:   600,
		Height:  450,
		Quality: 70,
		Format:  "webp",
	})
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}

	if mime != "image/webp" {
		t.Errorf("Expected mime image/webp, got %s", mime)
	}

	w, h := readDimensions(t, out)
	if w != 600 {
		t.Errorf("Expected width 600, got %d", w)
	}
	if h != 450 {
		t.Errorf("Expected height 450, got %d", h)
	}
}

func TestVipsTransform_InvalidInput(t *testing.T) {
	proc := NewVipsProcessor()

	_, _, err := proc.Transform([]byte("not an image"), TransformOptions{Width: 100})
	if err == nil {
		t.Error("Expected error for invalid image data")
	}
}

// ---------------------------------------------------------------------------
// NeedsTransform tests
// ---------------------------------------------------------------------------

func TestNeedsTransform(t *testing.T) {
	tests := []struct {
		name     string
		opts     TransformOptions
		expected bool
	}{
		{"empty", TransformOptions{}, false},
		{"default format only", TransformOptions{Format: "jpeg"}, false},
		{"width", TransformOptions{Width: 100}, true},
		{"height", TransformOptions{Height: 100}, true},
		{"quality", TransformOptions{Quality: 80}, true},
		{"webp", TransformOptions{Format: "webp"}, true},
		{"all set", TransformOptions{Width: 640, Height: 480, Quality: 75, Format: "webp"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NeedsTransform(tt.opts); got != tt.expected {
				t.Errorf("NeedsTransform(%+v) = %v, want %v", tt.opts, got, tt.expected)
			}
		})
	}
}
