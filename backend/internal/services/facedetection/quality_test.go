package facedetection

import (
	"math"
	"testing"
)

func TestComputeFaceQuality_HighQualityFace(t *testing.T) {
	// Simulates a large, high-confidence, well-aligned face
	face := DetectedFace{
		Box: BoundingBox{X: 100, Y: 100, Width: 200, Height: 200},
		Landmarks: [5][2]float64{
			{150, 170}, // left eye
			{250, 170}, // right eye (level)
			{200, 220}, // nose (centered)
			{160, 260}, // left mouth
			{240, 260}, // right mouth (level)
		},
		Confidence: 0.99,
	}

	quality := ComputeFaceQuality(face, 800, 600)
	if quality < 0.7 {
		t.Errorf("Expected high quality (>0.7), got %.3f", quality)
	}
	if quality > 1.0 {
		t.Errorf("Quality should not exceed 1.0, got %.3f", quality)
	}
}

func TestComputeFaceQuality_LowQualityFace(t *testing.T) {
	// Simulates a tiny, low-confidence, rotated face
	face := DetectedFace{
		Box: BoundingBox{X: 10, Y: 10, Width: 20, Height: 30},
		Landmarks: [5][2]float64{
			{15, 20},  // left eye
			{25, 30},  // right eye (tilted)
			{22, 28},  // nose (off-center)
			{14, 35},  // left mouth
			{26, 38},  // right mouth (tilted)
		},
		Confidence: 0.3,
	}

	quality := ComputeFaceQuality(face, 1920, 1080)
	if quality > 0.5 {
		t.Errorf("Expected low quality (<0.5), got %.3f", quality)
	}
	if quality < 0 {
		t.Errorf("Quality should not be negative, got %.3f", quality)
	}
}

func TestComputeAspectScore(t *testing.T) {
	// Perfect square
	score := computeAspectScore(BoundingBox{Width: 100, Height: 100})
	if math.Abs(score-1.0) > 0.001 {
		t.Errorf("Expected 1.0 for square, got %.3f", score)
	}

	// 2:1 ratio
	score = computeAspectScore(BoundingBox{Width: 200, Height: 100})
	if math.Abs(score-0.5) > 0.001 {
		t.Errorf("Expected 0.5 for 2:1 ratio, got %.3f", score)
	}

	// 1:2 ratio
	score = computeAspectScore(BoundingBox{Width: 100, Height: 200})
	if math.Abs(score-0.5) > 0.001 {
		t.Errorf("Expected 0.5 for 1:2 ratio, got %.3f", score)
	}
}

func TestSigmoid(t *testing.T) {
	if math.Abs(sigmoid(0)-0.5) > 0.001 {
		t.Errorf("sigmoid(0) should be 0.5, got %.3f", sigmoid(0))
	}
	if sigmoid(10) < 0.999 {
		t.Errorf("sigmoid(10) should be ~1.0, got %.3f", sigmoid(10))
	}
	if sigmoid(-10) > 0.001 {
		t.Errorf("sigmoid(-10) should be ~0.0, got %.3f", sigmoid(-10))
	}
}

func TestNMS(t *testing.T) {
	faces := []DetectedFace{
		{Box: BoundingBox{X: 0, Y: 0, Width: 100, Height: 100}, Confidence: 0.9},
		{Box: BoundingBox{X: 10, Y: 10, Width: 100, Height: 100}, Confidence: 0.8}, // overlaps with first
		{Box: BoundingBox{X: 500, Y: 500, Width: 100, Height: 100}, Confidence: 0.7}, // no overlap
	}

	result := nms(faces, 0.4)
	if len(result) != 2 {
		t.Errorf("Expected 2 faces after NMS, got %d", len(result))
	}
	if result[0].Confidence != 0.9 {
		t.Errorf("Expected first face confidence 0.9, got %.1f", result[0].Confidence)
	}
	if result[1].Confidence != 0.7 {
		t.Errorf("Expected second face confidence 0.7, got %.1f", result[1].Confidence)
	}
}

func TestIOU(t *testing.T) {
	// Identical boxes
	a := BoundingBox{X: 0, Y: 0, Width: 100, Height: 100}
	iouVal := iou(a, a)
	if math.Abs(iouVal-1.0) > 0.001 {
		t.Errorf("IOU of identical boxes should be 1.0, got %.3f", iouVal)
	}

	// No overlap
	b := BoundingBox{X: 200, Y: 200, Width: 100, Height: 100}
	iouVal = iou(a, b)
	if iouVal != 0 {
		t.Errorf("IOU of non-overlapping boxes should be 0, got %.3f", iouVal)
	}

	// 50% overlap
	c := BoundingBox{X: 50, Y: 0, Width: 100, Height: 100}
	iouVal = iou(a, c)
	expected := 5000.0 / (10000 + 10000 - 5000)
	if math.Abs(iouVal-expected) > 0.01 {
		t.Errorf("Expected IOU ~%.3f, got %.3f", expected, iouVal)
	}
}

func TestEmbeddingToString(t *testing.T) {
	emb := []float32{0.1, -0.2, 0.3}
	s := embeddingToString(emb)
	if s[0] != '[' || s[len(s)-1] != ']' {
		t.Errorf("Expected bracketed string, got %s", s)
	}
}
