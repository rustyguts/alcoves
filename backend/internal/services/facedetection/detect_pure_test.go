package facedetection

import (
	"math"
	"testing"
)

// TestDecodeStride_NoFacesBelowThreshold returns no faces when all scores are below minScore.
func TestDecodeStride_NoFacesBelowThreshold(t *testing.T) {
	stride := 32
	inputSize := detInputSize
	grid := inputSize / stride
	total := grid * grid * numAnchorsPerCell

	scores := make([]float32, total)
	for i := range scores {
		scores[i] = 0.1 // all low
	}
	bboxes := make([]float32, total*4)
	kps := make([]float32, total*10)

	faces := decodeStride(scores, bboxes, kps, stride, inputSize, 0.5)
	if len(faces) != 0 {
		t.Errorf("expected 0 faces below threshold, got %d", len(faces))
	}
}

// TestDecodeStride_DecodesBox decodes a single face above threshold and checks geometry.
func TestDecodeStride_DecodesBox(t *testing.T) {
	stride := 32
	inputSize := detInputSize
	grid := inputSize / stride
	total := grid * grid * numAnchorsPerCell

	scores := make([]float32, total)
	bboxes := make([]float32, total*4)
	kps := make([]float32, total*10)

	// Activate anchor index 0 (grid cell (0,0), anchor 0). Center = (0,0).
	scores[0] = 0.9
	// distances: left=1, top=1, right=2, bottom=2 (in stride units)
	bboxes[0] = 1
	bboxes[1] = 1
	bboxes[2] = 2
	bboxes[3] = 2
	// landmark offsets all zero -> landmarks at center (0,0)

	faces := decodeStride(scores, bboxes, kps, stride, inputSize, 0.5)
	if len(faces) != 1 {
		t.Fatalf("expected 1 face, got %d", len(faces))
	}
	f := faces[0]
	// x1 = 0 - 1*32 = -32, y1 = -32, x2 = 0 + 2*32 = 64, y2 = 64
	if f.Box.X != -32 || f.Box.Y != -32 {
		t.Errorf("box origin = (%v,%v), want (-32,-32)", f.Box.X, f.Box.Y)
	}
	if f.Box.Width != 96 || f.Box.Height != 96 {
		t.Errorf("box size = (%v,%v), want (96,96)", f.Box.Width, f.Box.Height)
	}
	if math.Abs(f.Confidence-0.9) > 1e-6 {
		t.Errorf("confidence = %v, want 0.9", f.Confidence)
	}
}

// TestDecodeStride_LandmarkOffsets verifies landmarks are decoded with the stride scaling.
func TestDecodeStride_LandmarkOffsets(t *testing.T) {
	stride := 8
	inputSize := detInputSize
	grid := inputSize / stride
	total := grid * grid * numAnchorsPerCell

	scores := make([]float32, total)
	bboxes := make([]float32, total*4)
	kps := make([]float32, total*10)

	// Use anchor index 2 -> that is grid cell (0,1) anchor 0. cx = 1*8 = 8, cy = 0.
	idx := 2
	scores[idx] = 0.8
	bboxes[idx*4+0] = 0.5
	bboxes[idx*4+1] = 0.5
	bboxes[idx*4+2] = 0.5
	bboxes[idx*4+3] = 0.5
	// Set first landmark offset to (1, 2) -> landmark at (cx + 1*8, cy + 2*8) = (16, 16)
	kps[idx*10+0] = 1
	kps[idx*10+1] = 2

	faces := decodeStride(scores, bboxes, kps, stride, inputSize, 0.5)
	if len(faces) != 1 {
		t.Fatalf("expected 1 face, got %d", len(faces))
	}
	lm := faces[0].Landmarks[0]
	if math.Abs(lm[0]-16) > 1e-6 || math.Abs(lm[1]-16) > 1e-6 {
		t.Errorf("landmark[0] = (%v,%v), want (16,16)", lm[0], lm[1])
	}
}

// TestDecodeStride_TruncatedScores stops gracefully when scores are shorter than anchors.
func TestDecodeStride_TruncatedScores(t *testing.T) {
	stride := 32
	inputSize := detInputSize
	// Provide far fewer scores than anchors -> loop should break without panic.
	scores := []float32{0.9, 0.9}
	bboxes := make([]float32, 8)
	kps := make([]float32, 20)
	faces := decodeStride(scores, bboxes, kps, stride, inputSize, 0.5)
	// At most 2 faces (limited by scores length); should not panic.
	if len(faces) > 2 {
		t.Errorf("expected at most 2 faces, got %d", len(faces))
	}
}

// TestDecodeStride_TruncatedBBox skips when bbox data runs out.
func TestDecodeStride_TruncatedBBox(t *testing.T) {
	stride := 32
	inputSize := detInputSize
	grid := inputSize / stride
	total := grid * grid * numAnchorsPerCell

	scores := make([]float32, total)
	scores[0] = 0.9
	scores[1] = 0.9
	// bbox only has room for the first anchor's 4 floats.
	bboxes := make([]float32, 4)
	kps := make([]float32, total*10)

	faces := decodeStride(scores, bboxes, kps, stride, inputSize, 0.5)
	// Anchor 0 decodes; anchor 1's bIdx=4, bIdx+3=7 >= len(4) -> skipped.
	if len(faces) != 1 {
		t.Errorf("expected 1 face (second skipped on bbox bounds), got %d", len(faces))
	}
}

// TestNMS_Empty handles an empty input slice.
func TestNMS_Empty(t *testing.T) {
	if got := nms(nil, 0.4); len(got) != 0 {
		t.Errorf("nms(nil) = %v, want empty", got)
	}
}

// TestNMS_AllKept keeps all faces when none overlap.
func TestNMS_AllKept(t *testing.T) {
	faces := []DetectedFace{
		{Box: BoundingBox{X: 0, Y: 0, Width: 10, Height: 10}, Confidence: 0.9},
		{Box: BoundingBox{X: 100, Y: 100, Width: 10, Height: 10}, Confidence: 0.8},
		{Box: BoundingBox{X: 200, Y: 200, Width: 10, Height: 10}, Confidence: 0.7},
	}
	got := nms(faces, 0.4)
	if len(got) != 3 {
		t.Errorf("expected 3 faces kept, got %d", len(got))
	}
}

// TestIOU_PartialOverlapZeroArea returns 0 for degenerate boxes that touch but don't overlap.
func TestIOU_Adjacent(t *testing.T) {
	a := BoundingBox{X: 0, Y: 0, Width: 100, Height: 100}
	b := BoundingBox{X: 100, Y: 0, Width: 100, Height: 100} // shares an edge only
	if got := iou(a, b); got != 0 {
		t.Errorf("iou of adjacent boxes = %v, want 0", got)
	}
}

// TestIOU_Containment computes IOU when one box fully contains another.
func TestIOU_Containment(t *testing.T) {
	outer := BoundingBox{X: 0, Y: 0, Width: 100, Height: 100}
	inner := BoundingBox{X: 25, Y: 25, Width: 50, Height: 50}
	// intersection = 2500, union = 10000 + 2500 - 2500 = 10000
	want := 2500.0 / 10000.0
	if got := iou(outer, inner); math.Abs(got-want) > 1e-9 {
		t.Errorf("iou containment = %v, want %v", got, want)
	}
}

// TestComputeSizeScore_ZeroImage returns 0 when image area is zero.
func TestComputeSizeScore_ZeroImage(t *testing.T) {
	if got := computeSizeScore(BoundingBox{Width: 10, Height: 10}, 0, 0); got != 0 {
		t.Errorf("computeSizeScore with zero image = %v, want 0", got)
	}
}

// TestComputeSizeScore_LargeFace gives a high score for a face filling much of the image.
func TestComputeSizeScore_LargeFace(t *testing.T) {
	// face area = 90000, image area = 100000 -> ratio 0.9, well above 0.02 center
	got := computeSizeScore(BoundingBox{Width: 300, Height: 300}, 1000, 100)
	if got < 0.99 {
		t.Errorf("large face size score = %v, want ~1", got)
	}
}

// TestComputeAspectScore_ZeroDims returns 0 for a box with a zero dimension.
func TestComputeAspectScore_ZeroDims(t *testing.T) {
	if got := computeAspectScore(BoundingBox{Width: 0, Height: 100}); got != 0 {
		t.Errorf("aspect score with zero width = %v, want 0", got)
	}
	if got := computeAspectScore(BoundingBox{Width: 100, Height: 0}); got != 0 {
		t.Errorf("aspect score with zero height = %v, want 0", got)
	}
}

// TestComputeLandmarkScore_DegenerateEyes returns the neutral 0.5 when eyes coincide.
func TestComputeLandmarkScore_DegenerateEyes(t *testing.T) {
	face := DetectedFace{
		Landmarks: [5][2]float64{
			{50, 50}, {50, 50}, // eyes at same point -> eyeDist < 1
			{50, 60},
			{45, 70}, {55, 70},
		},
	}
	if got := computeLandmarkScore(face); got != 0.5 {
		t.Errorf("degenerate eyes landmark score = %v, want 0.5", got)
	}
}

// TestComputeLandmarkScore_DegenerateMouth uses the two-component fallback when mouth corners coincide.
func TestComputeLandmarkScore_DegenerateMouth(t *testing.T) {
	face := DetectedFace{
		Landmarks: [5][2]float64{
			{40, 50}, {60, 50}, // level eyes, eyeDist = 20
			{50, 60},           // nose centered
			{50, 70}, {50, 70}, // mouth corners coincide -> mouthDist < 1
		},
	}
	got := computeLandmarkScore(face)
	// With perfect eyes/nose, the two-component average should be ~1.0
	if got < 0.99 {
		t.Errorf("degenerate mouth landmark score = %v, want ~1 (eye+nose avg)", got)
	}
}

// TestComputeLandmarkScore_PerfectFace gives a near-perfect score for an ideal frontal face.
func TestComputeLandmarkScore_PerfectFace(t *testing.T) {
	face := DetectedFace{
		Landmarks: [5][2]float64{
			{40, 50}, {60, 50}, // level eyes
			{50, 60},           // centered nose
			{42, 72}, {58, 72}, // level mouth
		},
	}
	got := computeLandmarkScore(face)
	if got < 0.99 {
		t.Errorf("perfect face landmark score = %v, want ~1", got)
	}
}
