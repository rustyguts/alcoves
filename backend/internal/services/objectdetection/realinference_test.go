package objectdetection

import (
	"fmt"
	"strings"
	"testing"

	ort "github.com/yalue/onnxruntime_go"

	"github.com/alcoves/alcoves-backend/internal/testsupport"
	"github.com/alcoves/alcoves-backend/internal/testsupport/onnxtest"
)

// Real YOLO26x inference against committed sample images. These tests load the
// actual ONNX model and run end-to-end detection, asserting both semantic
// results (the expected COCO label is found) and structural invariants. They
// skip cleanly when the ONNX Runtime or model weights are unavailable (e.g. CI
// without a matching runtime, or an offline box).
//
// See internal/testsupport/testdata/README.md for fixture provenance/licenses.

func init() { onnxtest.SetupLib() }

func loadYOLOOrSkip(t *testing.T) *ort.DynamicAdvancedSession {
	t.Helper()
	models := testsupport.ModelsCacheDir()
	sess, err := LoadDetectionSession(models)
	if err != nil {
		t.Skipf("object detection model/runtime unavailable: %v", err)
	}
	t.Cleanup(func() { sess.Destroy() })
	return sess
}

func summarizeDetections(dets []Detection) string {
	parts := make([]string, 0, len(dets))
	for i, d := range dets {
		if i >= 6 {
			parts = append(parts, "...")
			break
		}
		parts = append(parts, fmt.Sprintf("%s=%.2f", d.Label, d.Confidence))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// TestRealObjectDetection_ExpectedLabels confirms the model finds the right
// COCO class in each real sample image.
func TestRealObjectDetection_ExpectedLabels(t *testing.T) {
	sess := loadYOLOOrSkip(t)
	cfg := NewObjectConfig(0.25, 0.45, 100, "")

	cases := []struct {
		fixture string
		label   string
		minConf float64
	}{
		{"images/face_a.jpg", "person", 0.6},
		{"images/dog.jpg", "dog", 0.4},
		{"images/bicycle.jpg", "bicycle", 0.6},
	}

	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			img := testsupport.FixtureBytes(t, tc.fixture)
			dets, w, h, err := DetectObjects(sess, img, cfg)
			if err != nil {
				t.Fatalf("DetectObjects(%s): %v", tc.fixture, err)
			}
			if w <= 0 || h <= 0 {
				t.Fatalf("bad image dims %dx%d", w, h)
			}
			var best float64
			found := false
			for _, d := range dets {
				if d.Label == tc.label {
					found = true
					if d.Confidence > best {
						best = d.Confidence
					}
				}
			}
			if !found {
				t.Fatalf("expected label %q in %s; got %s", tc.label, tc.fixture, summarizeDetections(dets))
			}
			if best < tc.minConf {
				t.Fatalf("label %q confidence %.3f < %.3f in %s", tc.label, best, tc.minConf, tc.fixture)
			}
			t.Logf("%s: %q @ %.3f (%d total: %s)", tc.fixture, tc.label, best, len(dets), summarizeDetections(dets))
		})
	}
}

// TestRealObjectDetection_Invariants validates structural properties of every
// detection across all fixtures.
func TestRealObjectDetection_Invariants(t *testing.T) {
	sess := loadYOLOOrSkip(t)
	cfg := NewObjectConfig(0.25, 0.45, 100, "")

	for _, fixture := range []string{"images/face_a.jpg", "images/face_b.jpg", "images/dog.jpg", "images/bicycle.jpg"} {
		img := testsupport.FixtureBytes(t, fixture)
		dets, w, h, err := DetectObjects(sess, img, cfg)
		if err != nil {
			t.Fatalf("DetectObjects(%s): %v", fixture, err)
		}
		for i, d := range dets {
			if d.Confidence < cfg.MinScore || d.Confidence > 1.0 {
				t.Fatalf("%s det[%d] confidence %.4f outside (%.2f,1]", fixture, i, d.Confidence, cfg.MinScore)
			}
			if d.ClassID < 0 || d.ClassID >= len(COCOLabels) {
				t.Fatalf("%s det[%d] classID %d out of range", fixture, i, d.ClassID)
			}
			if d.Label != COCOLabels[d.ClassID] {
				t.Fatalf("%s det[%d] label %q != COCOLabels[%d]=%q", fixture, i, d.Label, d.ClassID, COCOLabels[d.ClassID])
			}
			if d.BoxX < 0 || d.BoxY < 0 || d.BoxWidth <= 0 || d.BoxHeight <= 0 {
				t.Fatalf("%s det[%d] degenerate box (%.1f,%.1f,%.1f,%.1f)", fixture, i, d.BoxX, d.BoxY, d.BoxWidth, d.BoxHeight)
			}
			if d.BoxX >= float64(w) || d.BoxY >= float64(h) {
				t.Fatalf("%s det[%d] box origin (%.1f,%.1f) outside %dx%d", fixture, i, d.BoxX, d.BoxY, w, h)
			}
		}
		// Detections are returned sorted by descending confidence.
		for i := 1; i < len(dets); i++ {
			if dets[i].Confidence > dets[i-1].Confidence {
				t.Fatalf("%s detections not sorted: [%d]=%.3f > [%d]=%.3f", fixture, i, dets[i].Confidence, i-1, dets[i-1].Confidence)
			}
		}
	}
}

// TestRealObjectDetection_MaxDetectionsCap confirms the MaxDetections cap.
func TestRealObjectDetection_MaxDetectionsCap(t *testing.T) {
	sess := loadYOLOOrSkip(t)
	img := testsupport.FixtureBytes(t, "images/bicycle.jpg")

	full, _, _, err := DetectObjects(sess, img, NewObjectConfig(0.25, 0.45, 100, ""))
	if err != nil {
		t.Fatalf("DetectObjects: %v", err)
	}
	if len(full) < 2 {
		t.Skipf("bicycle fixture yielded %d detections; need >=2 to test the cap", len(full))
	}
	capped, _, _, err := DetectObjects(sess, img, NewObjectConfig(0.25, 0.45, 1, ""))
	if err != nil {
		t.Fatalf("DetectObjects(capped): %v", err)
	}
	if len(capped) != 1 {
		t.Fatalf("MaxDetections=1 yielded %d detections", len(capped))
	}
}

// TestRealObjectDetection_MinScoreFilter confirms a higher MinScore yields
// fewer detections.
func TestRealObjectDetection_MinScoreFilter(t *testing.T) {
	sess := loadYOLOOrSkip(t)
	img := testsupport.FixtureBytes(t, "images/bicycle.jpg")

	low, _, _, err := DetectObjects(sess, img, NewObjectConfig(0.20, 0.45, 100, ""))
	if err != nil {
		t.Fatalf("DetectObjects(low): %v", err)
	}
	high, _, _, err := DetectObjects(sess, img, NewObjectConfig(0.95, 0.45, 100, ""))
	if err != nil {
		t.Fatalf("DetectObjects(high): %v", err)
	}
	if len(high) > len(low) {
		t.Fatalf("higher MinScore produced more detections: high=%d low=%d", len(high), len(low))
	}
	for _, d := range high {
		if d.Confidence < 0.95 {
			t.Fatalf("detection below MinScore leaked through: %.3f", d.Confidence)
		}
	}
}

// TestRealObjectDetection_BlankImage confirms a featureless image yields no
// high-confidence detections (the model isn't hallucinating objects).
func TestRealObjectDetection_BlankImage(t *testing.T) {
	sess := loadYOLOOrSkip(t)
	blank := makeTestPNG(t, 640, 640)
	dets, _, _, err := DetectObjects(sess, blank, NewObjectConfig(0.25, 0.45, 100, ""))
	if err != nil {
		t.Fatalf("DetectObjects(blank): %v", err)
	}
	for _, d := range dets {
		if d.Confidence > 0.6 {
			t.Fatalf("blank image produced a high-confidence detection: %s=%.3f", d.Label, d.Confidence)
		}
	}
}
