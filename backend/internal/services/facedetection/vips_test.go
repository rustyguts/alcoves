package facedetection

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"path/filepath"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

func init() {
	vips.Startup(nil)
}

// makeTestJPEG builds a solid-colour JPEG of the given size.
func makeTestJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			// A gradient so pixels aren't all identical.
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

// TestDetectFaces_BadImage covers the image-load error branch before any
// inference is attempted (so no ONNX session is required).
func TestDetectFaces_BadImage(t *testing.T) {
	_, _, _, err := DetectFaces(nil, []byte("not-an-image"), 0.5)
	if err == nil {
		t.Fatal("expected error for invalid image data")
	}
}

// TestComputeEmbedding_BadImage covers the image-load error branch before any
// ONNX inference is attempted.
func TestComputeEmbedding_BadImage(t *testing.T) {
	face := DetectedFace{Box: BoundingBox{X: 0, Y: 0, Width: 10, Height: 10}}
	_, err := ComputeEmbedding(nil, []byte("not-an-image"), face)
	if err == nil {
		t.Fatal("expected error for invalid image data in ComputeEmbedding")
	}
}

// TestExportRGB_And_RawRGB exercise the raw pixel extraction helpers.
func TestExportRGB_And_RawRGB(t *testing.T) {
	data := makeTestJPEG(t, 64, 48)
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatalf("load image: %v", err)
	}
	defer img.Close()

	rgb, err := exportRGB(img)
	if err != nil {
		t.Fatalf("exportRGB: %v", err)
	}
	if len(rgb) != 64*48*3 {
		t.Errorf("exportRGB length = %d, want %d", len(rgb), 64*48*3)
	}
}

// TestPreprocessForDetection_Landscape resizes a wide image and returns a CHW tensor.
func TestPreprocessForDetection_Landscape(t *testing.T) {
	data := makeTestJPEG(t, 800, 400) // landscape
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatalf("load image: %v", err)
	}
	defer img.Close()

	tensor, scale, err := preprocessForDetection(img)
	if err != nil {
		t.Fatalf("preprocessForDetection: %v", err)
	}
	if len(tensor) != 3*detInputSize*detInputSize {
		t.Errorf("tensor length = %d, want %d", len(tensor), 3*detInputSize*detInputSize)
	}
	if scale <= 0 || scale > 1 {
		t.Errorf("scale = %v, want in (0,1]", scale)
	}
}

// TestPreprocessForDetection_Portrait resizes a tall image (the ratio>1 branch).
func TestPreprocessForDetection_Portrait(t *testing.T) {
	data := makeTestJPEG(t, 400, 800) // portrait
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatalf("load image: %v", err)
	}
	defer img.Close()

	tensor, scale, err := preprocessForDetection(img)
	if err != nil {
		t.Fatalf("preprocessForDetection: %v", err)
	}
	if len(tensor) != 3*detInputSize*detInputSize {
		t.Errorf("tensor length = %d, want %d", len(tensor), 3*detInputSize*detInputSize)
	}
	if scale <= 0 {
		t.Errorf("scale = %v, want > 0", scale)
	}
}

// TestAlignFace warps a face region to the canonical 112x112 aligned RGB buffer.
func TestAlignFace(t *testing.T) {
	data := makeTestJPEG(t, 200, 200)
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatalf("load image: %v", err)
	}
	defer img.Close()

	// Landmarks roughly arranged like a face in the 200x200 image.
	landmarks := [5][2]float64{
		{70, 80},   // left eye
		{130, 80},  // right eye
		{100, 110}, // nose
		{75, 140},  // left mouth
		{125, 140}, // right mouth
	}
	aligned, err := alignFace(img, landmarks)
	if err != nil {
		t.Fatalf("alignFace: %v", err)
	}
	if len(aligned) != arcFaceSize*arcFaceSize*3 {
		t.Errorf("aligned length = %d, want %d", len(aligned), arcFaceSize*arcFaceSize*3)
	}
}

// thumbHandler builds a TaskHandler backed by temp local storage.
func thumbHandler(t *testing.T) (*TaskHandler, *storage.Service) {
	t.Helper()
	root := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	svc := storage.NewService(driver)
	if err := svc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	cfg := NewFaceConfig(0.5, 0.4, 10, 3, "/models")
	return NewTaskHandler(nil, svc, cfg), svc
}

// TestGenerateFaceThumbnail crops, resizes and stores a WebP thumbnail.
func TestGenerateFaceThumbnail(t *testing.T) {
	h, svc := thumbHandler(t)
	data := makeTestJPEG(t, 400, 400)

	face := DetectedFace{
		Box:        BoundingBox{X: 100, Y: 100, Width: 120, Height: 120},
		Confidence: 0.9,
	}
	lib := "lib-thumb"
	detID := "det-1"
	if err := h.generateFaceThumbnail(data, face, lib, detID); err != nil {
		t.Fatalf("generateFaceThumbnail: %v", err)
	}

	// The thumbnail should be readable back from the cache.
	cacheKey := lib + "/faces/" + detID + ".webp"
	out, err := svc.ReadCacheBuffer(cacheKey)
	if err != nil {
		t.Fatalf("ReadCacheBuffer: %v", err)
	}
	thumb, err := vips.NewImageFromBuffer(out)
	if err != nil {
		t.Fatalf("decode thumbnail: %v", err)
	}
	defer thumb.Close()
	if thumb.Width() != thumbnailSize || thumb.Height() != thumbnailSize {
		t.Errorf("thumbnail size = %dx%d, want %dx%d", thumb.Width(), thumb.Height(), thumbnailSize, thumbnailSize)
	}
}

// TestGenerateFaceThumbnail_FaceAtEdge exercises the clamping branches near image edges.
func TestGenerateFaceThumbnail_FaceAtEdge(t *testing.T) {
	h, _ := thumbHandler(t)
	data := makeTestJPEG(t, 300, 300)

	// Face crammed into the bottom-right corner so the crop must clamp.
	face := DetectedFace{
		Box:        BoundingBox{X: 260, Y: 260, Width: 60, Height: 60},
		Confidence: 0.8,
	}
	if err := h.generateFaceThumbnail(data, face, "lib-edge", "det-edge"); err != nil {
		t.Fatalf("generateFaceThumbnail (edge): %v", err)
	}
}

// TestGenerateFaceThumbnail_BadImage returns an error for non-image bytes.
func TestGenerateFaceThumbnail_BadImage(t *testing.T) {
	h, _ := thumbHandler(t)
	face := DetectedFace{Box: BoundingBox{X: 0, Y: 0, Width: 10, Height: 10}}
	if err := h.generateFaceThumbnail([]byte("not-an-image"), face, "lib", "det"); err == nil {
		t.Fatal("expected error for non-image data")
	}
}
