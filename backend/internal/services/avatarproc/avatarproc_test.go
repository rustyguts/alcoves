package avatarproc

import (
	"bytes"
	"errors"
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

// makePNG returns a solid-color PNG of the requested dimensions.
func makePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 64, G: 192, B: 64, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func makeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 50, B: 100, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

// dims decodes via vips and returns width, height.
func dims(t *testing.T, data []byte) (int, int) {
	t.Helper()
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	defer img.Close()
	return img.Width(), img.Height()
}

// hasWebpMagic returns true if the buffer starts with `RIFF....WEBP`.
func hasWebpMagic(b []byte) bool {
	return len(b) > 12 && bytes.Equal(b[0:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP"))
}

func TestProcess_ConvertsPngToWebp(t *testing.T) {
	out, err := Process(makePNG(t, 200, 200))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if !hasWebpMagic(out) {
		t.Fatalf("output is not WebP (first 16 bytes: %x)", out[:16])
	}
	w, h := dims(t, out)
	if w != 200 || h != 200 {
		t.Errorf("expected 200x200, got %dx%d", w, h)
	}
}

func TestProcess_ConvertsJpegToWebp(t *testing.T) {
	out, err := Process(makeJPEG(t, 300, 300))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if !hasWebpMagic(out) {
		t.Fatalf("output is not WebP")
	}
}

func TestProcess_DownscalesOversizedInput(t *testing.T) {
	// 1024x1024 is larger than MaxAvatarSize (512), should be capped.
	out, err := Process(makePNG(t, 1024, 1024))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	w, h := dims(t, out)
	if w != MaxAvatarSize || h != MaxAvatarSize {
		t.Errorf("expected %dx%d, got %dx%d", MaxAvatarSize, MaxAvatarSize, w, h)
	}
}

func TestProcess_CenterCropsRectangleToSquare(t *testing.T) {
	// Wide rectangle: 400x200 should crop to 200x200 (the smaller side).
	out, err := Process(makePNG(t, 400, 200))
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

func TestProcess_DoesNotUpscaleSmallInput(t *testing.T) {
	out, err := Process(makePNG(t, 64, 64))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	w, h := dims(t, out)
	if w != 64 || h != 64 {
		t.Errorf("expected 64x64, got %dx%d", w, h)
	}
}

func TestProcess_RejectsEmptyInput(t *testing.T) {
	_, err := Process(nil)
	if !errors.Is(err, ErrEmptyInput) {
		t.Errorf("expected ErrEmptyInput, got %v", err)
	}
	_, err = Process([]byte{})
	if !errors.Is(err, ErrEmptyInput) {
		t.Errorf("expected ErrEmptyInput, got %v", err)
	}
}

func TestProcess_RejectsOversizedInput(t *testing.T) {
	junk := make([]byte, MaxInputBytes+1)
	_, err := Process(junk)
	if !errors.Is(err, ErrInputTooLarge) {
		t.Errorf("expected ErrInputTooLarge, got %v", err)
	}
}

func TestProcess_RejectsNonImage(t *testing.T) {
	_, err := Process([]byte("definitely not an image, just plain text"))
	if !errors.Is(err, ErrInvalidImage) {
		t.Errorf("expected ErrInvalidImage, got %v", err)
	}
}

func TestProcess_OutputSmallerThanLargePngInput(t *testing.T) {
	// Sanity check: a 1024x1024 PNG should compress meaningfully as 512x512 WebP.
	in := makePNG(t, 1024, 1024)
	out, err := Process(in)
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if len(out) >= len(in) {
		t.Errorf("expected WebP smaller than 1024x1024 PNG: in=%d out=%d", len(in), len(out))
	}
}
