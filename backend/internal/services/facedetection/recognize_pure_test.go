package facedetection

import (
	"math"
	"testing"
)

// TestClampInt exercises the integer clamp helper across all branches.
func TestClampInt(t *testing.T) {
	cases := []struct {
		name           string
		v, lo, hi, want int
	}{
		{"below low", -5, 0, 10, 0},
		{"above high", 20, 0, 10, 10},
		{"in range", 5, 0, 10, 5},
		{"at low bound", 0, 0, 10, 0},
		{"at high bound", 10, 0, 10, 10},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := clampInt(tc.v, tc.lo, tc.hi); got != tc.want {
				t.Errorf("clampInt(%d,%d,%d) = %d, want %d", tc.v, tc.lo, tc.hi, got, tc.want)
			}
		})
	}
}

// TestClampFloat exercises the float clamp helper across all branches.
func TestClampFloat(t *testing.T) {
	cases := []struct {
		name              string
		v, lo, hi, want float64
	}{
		{"below low", -1.5, 0, 255, 0},
		{"above high", 300, 0, 255, 255},
		{"in range", 128.0, 0, 255, 128.0},
		{"at low bound", 0, 0, 255, 0},
		{"at high bound", 255, 0, 255, 255},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := clampFloat(tc.v, tc.lo, tc.hi); got != tc.want {
				t.Errorf("clampFloat(%v,%v,%v) = %v, want %v", tc.v, tc.lo, tc.hi, got, tc.want)
			}
		})
	}
}

// TestL2Normalize_UnitLength checks that a vector is scaled to unit length.
func TestL2Normalize_UnitLength(t *testing.T) {
	v := []float32{3, 4} // length 5
	l2Normalize(v)
	var norm float64
	for _, x := range v {
		norm += float64(x) * float64(x)
	}
	norm = math.Sqrt(norm)
	if math.Abs(norm-1.0) > 1e-6 {
		t.Errorf("normalized vector length = %.6f, want 1.0", norm)
	}
	// Direction preserved: 3/5, 4/5
	if math.Abs(float64(v[0])-0.6) > 1e-6 || math.Abs(float64(v[1])-0.8) > 1e-6 {
		t.Errorf("normalized vector = %v, want [0.6 0.8]", v)
	}
}

// TestL2Normalize_ZeroVector ensures a zero vector is left untouched (no NaN).
func TestL2Normalize_ZeroVector(t *testing.T) {
	v := []float32{0, 0, 0}
	l2Normalize(v)
	for _, x := range v {
		if x != 0 {
			t.Errorf("zero vector should stay zero, got %v", v)
		}
	}
}

// TestPrepareRecognitionInput_Valid verifies normalization to [-1,1] CHW layout.
func TestPrepareRecognitionInput_Valid(t *testing.T) {
	pixels := arcFaceSize * arcFaceSize
	rgb := make([]byte, pixels*3)
	// Set a recognizable pattern: first pixel = (255, 0, 127)
	rgb[0] = 255
	rgb[1] = 0
	rgb[2] = 127

	tensor, err := prepareRecognitionInput(rgb)
	if err != nil {
		t.Fatalf("prepareRecognitionInput error: %v", err)
	}
	if len(tensor) != 3*pixels {
		t.Fatalf("tensor length = %d, want %d", len(tensor), 3*pixels)
	}
	// R channel at i=0: (255-127.5)/127.5 = 1.0
	if math.Abs(float64(tensor[0])-1.0) > 1e-5 {
		t.Errorf("R[0] = %v, want 1.0", tensor[0])
	}
	// G channel at offset pixels: (0-127.5)/127.5 = -1.0
	if math.Abs(float64(tensor[pixels])-(-1.0)) > 1e-5 {
		t.Errorf("G[0] = %v, want -1.0", tensor[pixels])
	}
	// B channel at offset 2*pixels: (127-127.5)/127.5 ≈ -0.00392
	if math.Abs(float64(tensor[2*pixels])-((127.0-127.5)/127.5)) > 1e-5 {
		t.Errorf("B[0] = %v, want ~-0.0039", tensor[2*pixels])
	}
}

// TestPrepareRecognitionInput_TooShort returns an error for insufficient data.
func TestPrepareRecognitionInput_TooShort(t *testing.T) {
	_, err := prepareRecognitionInput([]byte{1, 2, 3})
	if err == nil {
		t.Fatal("expected error for short RGB data, got nil")
	}
}

// TestEstimateSimilarityTransform_Identity: when src == dst, the transform should be identity.
func TestEstimateSimilarityTransform_Identity(t *testing.T) {
	pts := referenceLandmarks
	M := estimateSimilarityTransform(pts, pts)
	// a≈1, b≈0, tx≈0, ty≈0
	if math.Abs(M[0]-1.0) > 1e-6 {
		t.Errorf("a = %v, want ~1", M[0])
	}
	if math.Abs(M[1]) > 1e-6 {
		t.Errorf("b = %v, want ~0", M[1])
	}
	if math.Abs(M[2]) > 1e-4 {
		t.Errorf("tx = %v, want ~0", M[2])
	}
	if math.Abs(M[5]) > 1e-4 {
		t.Errorf("ty = %v, want ~0", M[5])
	}
	// Matrix structure: M[3] == -M[1], M[4] == M[0]
	if M[3] != -M[1] || M[4] != M[0] {
		t.Errorf("similarity structure broken: %v", M)
	}
}

// TestEstimateSimilarityTransform_Scale: scaling src by 2 should give a≈0.5 mapping back.
func TestEstimateSimilarityTransform_Scale(t *testing.T) {
	var src [5][2]float64
	for i := range referenceLandmarks {
		src[i][0] = referenceLandmarks[i][0] * 2
		src[i][1] = referenceLandmarks[i][1] * 2
	}
	M := estimateSimilarityTransform(src, referenceLandmarks)
	// scale should be ~0.5 (a = scale*cos(0))
	if math.Abs(M[0]-0.5) > 1e-3 {
		t.Errorf("scale a = %v, want ~0.5", M[0])
	}
}

// TestEstimateSimilarityTransform_Translation: translating src should produce a pure translation.
func TestEstimateSimilarityTransform_Translation(t *testing.T) {
	var src [5][2]float64
	for i := range referenceLandmarks {
		src[i][0] = referenceLandmarks[i][0] + 10
		src[i][1] = referenceLandmarks[i][1] - 5
	}
	M := estimateSimilarityTransform(src, referenceLandmarks)
	// a≈1, b≈0
	if math.Abs(M[0]-1.0) > 1e-6 {
		t.Errorf("a = %v, want ~1", M[0])
	}
	// Applying transform to src[0] should yield ref[0]
	gotX := M[0]*src[0][0] + M[1]*src[0][1] + M[2]
	gotY := M[3]*src[0][0] + M[4]*src[0][1] + M[5]
	if math.Abs(gotX-referenceLandmarks[0][0]) > 1e-3 || math.Abs(gotY-referenceLandmarks[0][1]) > 1e-3 {
		t.Errorf("transform of src[0] = (%v,%v), want (%v,%v)", gotX, gotY, referenceLandmarks[0][0], referenceLandmarks[0][1])
	}
}

// TestInvertAffine_RoundTrip: M followed by inv(M) should map a point back to itself.
func TestInvertAffine_RoundTrip(t *testing.T) {
	M := [6]float64{2, 1, 5, -1, 2, -3} // a=2,b=1
	inv := invertAffine(M)

	// Apply M to a point, then inv, expect original.
	px, py := 3.0, 7.0
	mx := M[0]*px + M[1]*py + M[2]
	my := M[3]*px + M[4]*py + M[5]
	rx := inv[0]*mx + inv[1]*my + inv[2]
	ry := inv[3]*mx + inv[4]*my + inv[5]

	if math.Abs(rx-px) > 1e-9 || math.Abs(ry-py) > 1e-9 {
		t.Errorf("round trip = (%v,%v), want (%v,%v)", rx, ry, px, py)
	}
}

// TestInvertAffine_Singular: a zero-scale transform returns identity fallback.
func TestInvertAffine_Singular(t *testing.T) {
	M := [6]float64{0, 0, 5, 0, 0, 5} // a=0,b=0 -> det=0
	inv := invertAffine(M)
	want := [6]float64{1, 0, 0, 0, 1, 0}
	if inv != want {
		t.Errorf("singular invertAffine = %v, want identity %v", inv, want)
	}
}

// TestBilinearSample_ExactPixel returns the pixel value when sampling at an integer coordinate.
func TestBilinearSample_ExactPixel(t *testing.T) {
	// 2x2 RGB image
	w, h := 2, 2
	rgb := []byte{
		10, 20, 30, /* (0,0) */ 40, 50, 60, /* (1,0) */
		70, 80, 90, /* (0,1) */ 100, 110, 120, /* (1,1) */
	}
	r, g, b := bilinearSample(rgb, w, h, 0, 0)
	if r != 10 || g != 20 || b != 30 {
		t.Errorf("sample(0,0) = (%d,%d,%d), want (10,20,30)", r, g, b)
	}
	r, g, b = bilinearSample(rgb, w, h, 1, 1)
	if r != 100 || g != 110 || b != 120 {
		t.Errorf("sample(1,1) = (%d,%d,%d), want (100,110,120)", r, g, b)
	}
}

// TestBilinearSample_Midpoint averages the four neighbors at the center.
func TestBilinearSample_Midpoint(t *testing.T) {
	w, h := 2, 2
	rgb := []byte{
		0, 0, 0,
		100, 100, 100,
		100, 100, 100,
		200, 200, 200,
	}
	r, g, b := bilinearSample(rgb, w, h, 0.5, 0.5)
	// average of 0,100,100,200 = 100
	if r != 100 || g != 100 || b != 100 {
		t.Errorf("midpoint sample = (%d,%d,%d), want (100,100,100)", r, g, b)
	}
}

// TestBilinearSample_OutOfBounds clamps coordinates to image edges.
func TestBilinearSample_OutOfBounds(t *testing.T) {
	w, h := 2, 2
	rgb := []byte{
		10, 20, 30,
		40, 50, 60,
		70, 80, 90,
		100, 110, 120,
	}
	// Negative coords clamp to (0,0)
	r, g, b := bilinearSample(rgb, w, h, -5, -5)
	if r != 10 || g != 20 || b != 30 {
		t.Errorf("out-of-bounds low = (%d,%d,%d), want (10,20,30)", r, g, b)
	}
	// Large coords clamp to (1,1)
	r, g, b = bilinearSample(rgb, w, h, 50, 50)
	if r != 100 || g != 110 || b != 120 {
		t.Errorf("out-of-bounds high = (%d,%d,%d), want (100,110,120)", r, g, b)
	}
}
