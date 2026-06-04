package facedetection

import (
	"math"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
	ort "github.com/yalue/onnxruntime_go"

	"github.com/alcoves/alcoves-backend/internal/testsupport"
	"github.com/alcoves/alcoves-backend/internal/testsupport/onnxtest"
)

// Real SCRFD detection + ArcFace recognition against committed AI-generated
// face images (no real people). These tests load the actual ONNX models and
// run end-to-end detection, alignment, embedding, and quality scoring,
// asserting real properties of the pipeline: faces are found, embeddings are
// unit-length and 512-dim, the same face matches itself across a re-encode, and
// two different people are far apart in embedding space.
//
// They skip cleanly when the ONNX Runtime or model weights are unavailable.
// See internal/testsupport/testdata/README.md for fixture provenance.

func init() { onnxtest.SetupLib() }

func loadFaceSessionsOrSkip(t *testing.T) (det, rec *ort.DynamicAdvancedSession) {
	t.Helper()
	models := testsupport.ModelsCacheDir()
	d, err := LoadDetectionSession(models)
	if err != nil {
		t.Skipf("face detection model/runtime unavailable: %v", err)
	}
	t.Cleanup(func() { d.Destroy() })
	r, err := LoadRecognitionSession(models)
	if err != nil {
		t.Skipf("face recognition model/runtime unavailable: %v", err)
	}
	t.Cleanup(func() { r.Destroy() })
	return d, r
}

func cosineSim(a, b []float32) float64 {
	if len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

// reencodeJPEG decodes and re-encodes an image at a different size, producing a
// genuinely distinct JPEG of the same content (to test embedding robustness to
// resize/recompression).
func reencodeJPEG(t *testing.T, data []byte, targetWidth int) []byte {
	t.Helper()
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatalf("decode for reencode: %v", err)
	}
	defer img.Close()
	if err := img.Thumbnail(targetWidth, targetWidth, vips.InterestingNone); err != nil {
		t.Fatalf("thumbnail: %v", err)
	}
	out, _, err := img.ExportJpeg(&vips.JpegExportParams{Quality: 70})
	if err != nil {
		t.Fatalf("export jpeg: %v", err)
	}
	return out
}

// detectBest runs detection and returns the highest-confidence face.
func detectBest(t *testing.T, det *ort.DynamicAdvancedSession, data []byte, minScore float64) (DetectedFace, int, int) {
	t.Helper()
	faces, w, h, err := DetectFaces(det, data, minScore)
	if err != nil {
		t.Fatalf("DetectFaces: %v", err)
	}
	if len(faces) == 0 {
		t.Fatalf("expected at least one face, got none")
	}
	best := faces[0]
	for _, f := range faces[1:] {
		if f.Confidence > best.Confidence {
			best = f
		}
	}
	return best, w, h
}

// TestRealFaceDetection_FindsFace confirms a face is detected with a sane,
// in-bounds bounding box.
func TestRealFaceDetection_FindsFace(t *testing.T) {
	det, _ := loadFaceSessionsOrSkip(t)
	for _, fixture := range []string{"images/face_a.jpg", "images/face_b.jpg"} {
		data := testsupport.FixtureBytes(t, fixture)
		face, w, h := detectBest(t, det, data, 0.5)
		if face.Confidence < 0.5 {
			t.Fatalf("%s: best face confidence %.3f < 0.5", fixture, face.Confidence)
		}
		b := face.Box
		if b.Width <= 0 || b.Height <= 0 {
			t.Fatalf("%s: degenerate box %+v", fixture, b)
		}
		if b.X < 0 || b.Y < 0 || b.X+b.Width > float64(w)+1 || b.Y+b.Height > float64(h)+1 {
			t.Fatalf("%s: box %+v outside image %dx%d", fixture, b, w, h)
		}
		t.Logf("%s: face conf=%.3f box=(%.0f,%.0f,%.0f,%.0f)", fixture, face.Confidence, b.X, b.Y, b.Width, b.Height)
	}
}

// TestRealFaceEmbedding_NormalizedDim confirms embeddings are 512-dim and
// L2-normalized to unit length.
func TestRealFaceEmbedding_NormalizedDim(t *testing.T) {
	det, rec := loadFaceSessionsOrSkip(t)
	data := testsupport.FixtureBytes(t, "images/face_a.jpg")
	face, _, _ := detectBest(t, det, data, 0.5)

	emb, err := ComputeEmbedding(rec, data, face)
	if err != nil {
		t.Fatalf("ComputeEmbedding: %v", err)
	}
	if len(emb) != 512 {
		t.Fatalf("embedding dim %d, want 512", len(emb))
	}
	var norm float64
	for _, v := range emb {
		norm += float64(v) * float64(v)
	}
	norm = math.Sqrt(norm)
	if math.Abs(norm-1.0) > 1e-3 {
		t.Fatalf("embedding L2 norm %.5f, want 1.0", norm)
	}
}

// TestRealFaceEmbedding_SamePersonHighSimilarity confirms the same face matches
// itself across a resize/recompress (cosine ~1), proving the embedding is
// robust to encoding rather than keyed to pixel-exact input.
func TestRealFaceEmbedding_SamePersonHighSimilarity(t *testing.T) {
	det, rec := loadFaceSessionsOrSkip(t)
	orig := testsupport.FixtureBytes(t, "images/face_a.jpg")
	variant := reencodeJPEG(t, orig, 360)

	f1, _, _ := detectBest(t, det, orig, 0.5)
	e1, err := ComputeEmbedding(rec, orig, f1)
	if err != nil {
		t.Fatalf("ComputeEmbedding(orig): %v", err)
	}
	f2, _, _ := detectBest(t, det, variant, 0.5)
	e2, err := ComputeEmbedding(rec, variant, f2)
	if err != nil {
		t.Fatalf("ComputeEmbedding(variant): %v", err)
	}
	sim := cosineSim(e1, e2)
	if sim < 0.85 {
		t.Fatalf("same-person cosine similarity %.4f < 0.85", sim)
	}
	t.Logf("same person (orig vs re-encoded): cosine=%.4f", sim)
}

// TestRealFaceEmbedding_DifferentPersonsLowSimilarity confirms two different
// people are far apart in embedding space.
func TestRealFaceEmbedding_DifferentPersonsLowSimilarity(t *testing.T) {
	det, rec := loadFaceSessionsOrSkip(t)
	a := testsupport.FixtureBytes(t, "images/face_a.jpg")
	b := testsupport.FixtureBytes(t, "images/face_b.jpg")

	fa, _, _ := detectBest(t, det, a, 0.5)
	ea, err := ComputeEmbedding(rec, a, fa)
	if err != nil {
		t.Fatalf("ComputeEmbedding(a): %v", err)
	}
	fb, _, _ := detectBest(t, det, b, 0.5)
	eb, err := ComputeEmbedding(rec, b, fb)
	if err != nil {
		t.Fatalf("ComputeEmbedding(b): %v", err)
	}
	sim := cosineSim(ea, eb)
	if sim > 0.5 {
		t.Fatalf("different-persons cosine similarity %.4f > 0.5 (not discriminative)", sim)
	}
	// Sanity: the same-person similarity must exceed cross-person similarity.
	selfSim := cosineSim(ea, ea)
	if selfSim <= sim {
		t.Fatalf("self-similarity %.4f not greater than cross %.4f", selfSim, sim)
	}
	t.Logf("different persons: cosine=%.4f", sim)
}

// TestRealFaceQuality_Range confirms quality scores are in [0,1] and that a
// well-framed frontal face scores reasonably high.
func TestRealFaceQuality_Range(t *testing.T) {
	det, _ := loadFaceSessionsOrSkip(t)
	data := testsupport.FixtureBytes(t, "images/face_a.jpg")
	face, w, h := detectBest(t, det, data, 0.5)
	q := ComputeFaceQuality(face, w, h)
	if q < 0 || q > 1 {
		t.Fatalf("quality %.4f outside [0,1]", q)
	}
	if q < 0.5 {
		t.Fatalf("well-framed frontal face scored low quality %.4f", q)
	}
}

// TestRealFaceDetection_MinScoreGating confirms a near-1.0 threshold suppresses
// detections that a low threshold finds.
func TestRealFaceDetection_MinScoreGating(t *testing.T) {
	det, _ := loadFaceSessionsOrSkip(t)
	data := testsupport.FixtureBytes(t, "images/face_a.jpg")

	low, _, _, err := DetectFaces(det, data, 0.3)
	if err != nil {
		t.Fatalf("DetectFaces(low): %v", err)
	}
	high, _, _, err := DetectFaces(det, data, 0.999)
	if err != nil {
		t.Fatalf("DetectFaces(high): %v", err)
	}
	if len(low) == 0 {
		t.Fatal("expected detections at low threshold")
	}
	if len(high) > len(low) {
		t.Fatalf("high threshold produced more faces (%d) than low (%d)", len(high), len(low))
	}
	for _, f := range high {
		if f.Confidence < 0.999 {
			t.Fatalf("face below threshold leaked: %.4f", f.Confidence)
		}
	}
}
