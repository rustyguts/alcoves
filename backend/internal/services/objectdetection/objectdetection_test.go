package objectdetection

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hibiken/asynq"
)

// --- config.go ---

func TestNewObjectConfig(t *testing.T) {
	c := NewObjectConfig(0.4, 0.5, 100, "/models")
	if c.MinScore != 0.4 {
		t.Errorf("MinScore = %v, want 0.4", c.MinScore)
	}
	if c.NMSThreshold != 0.5 {
		t.Errorf("NMSThreshold = %v, want 0.5", c.NMSThreshold)
	}
	if c.MaxDetections != 100 {
		t.Errorf("MaxDetections = %v, want 100", c.MaxDetections)
	}
	if c.ModelsPath != "/models" {
		t.Errorf("ModelsPath = %q, want /models", c.ModelsPath)
	}
}

func TestNewObjectConfig_ZeroValues(t *testing.T) {
	c := NewObjectConfig(0, 0, 0, "")
	if c == nil {
		t.Fatal("nil config")
	}
	if c.MinScore != 0 || c.NMSThreshold != 0 || c.MaxDetections != 0 || c.ModelsPath != "" {
		t.Errorf("expected all zero values, got %+v", *c)
	}
}

// --- labels.go ---

func TestCOCOLabels_KnownIndices(t *testing.T) {
	cases := map[int]string{
		0:  "person",
		2:  "car",
		15: "cat",
		16: "dog",
		79: "toothbrush",
	}
	for idx, want := range cases {
		if COCOLabels[idx] != want {
			t.Errorf("COCOLabels[%d] = %q, want %q", idx, COCOLabels[idx], want)
		}
	}
}

func TestCOCOLabels_Count(t *testing.T) {
	if len(COCOLabels) != 80 {
		t.Fatalf("COCOLabels length = %d, want 80", len(COCOLabels))
	}
	if len(COCOLabels) != numClasses {
		t.Fatalf("COCOLabels length %d != numClasses %d", len(COCOLabels), numClasses)
	}
	for i, l := range COCOLabels {
		if strings.TrimSpace(l) == "" {
			t.Errorf("COCOLabels[%d] is empty", i)
		}
	}
}

// --- detect.go: sigmoid ---

func TestSigmoid(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{0, 0.5},
		{100, 1.0},  // saturates to ~1
		{-100, 0.0}, // saturates to ~0
	}
	for _, c := range cases {
		got := sigmoid(c.in)
		if math.Abs(got-c.want) > 1e-6 {
			t.Errorf("sigmoid(%v) = %v, want ~%v", c.in, got, c.want)
		}
	}
	// monotonic increasing
	if sigmoid(-1) >= sigmoid(1) {
		t.Error("sigmoid not monotonic increasing")
	}
	// bounds
	if sigmoid(0.5) <= 0 || sigmoid(0.5) >= 1 {
		t.Errorf("sigmoid(0.5)=%v out of (0,1)", sigmoid(0.5))
	}
}

// --- detect.go: decodeYOLO26Output ---

// buildLogits creates a [numProposals*numClasses] slice where proposal `p`'s
// class `cls` is set to a high logit (10 -> sigmoid ~1) and everything else low.
func buildLogits(setters map[int]int) []float32 {
	logits := make([]float32, numProposals*numClasses)
	// default all to a strongly-negative logit so sigmoid ~0
	for i := range logits {
		logits[i] = -10
	}
	for proposal, cls := range setters {
		logits[proposal*numClasses+cls] = 10
	}
	return logits
}

func buildBoxes(setters map[int][4]float32) []float32 {
	boxes := make([]float32, numProposals*4)
	for proposal, b := range setters {
		boxes[proposal*4+0] = b[0]
		boxes[proposal*4+1] = b[1]
		boxes[proposal*4+2] = b[2]
		boxes[proposal*4+3] = b[3]
	}
	return boxes
}

func TestDecodeYOLO26Output_ShortInputReturnsNil(t *testing.T) {
	cfg := NewObjectConfig(0.5, 0.5, 100, "")
	if got := decodeYOLO26Output([]float32{1, 2, 3}, []float32{1, 2}, 640, 480, cfg); got != nil {
		t.Errorf("expected nil for short logits, got %v", got)
	}
	// logits long enough but boxes too short
	logits := make([]float32, numProposals*numClasses)
	if got := decodeYOLO26Output(logits, []float32{1}, 640, 480, cfg); got != nil {
		t.Errorf("expected nil for short boxes, got %v", got)
	}
}

func TestDecodeYOLO26Output_SingleDetection(t *testing.T) {
	cfg := NewObjectConfig(0.5, 0.5, 100, "")
	// proposal 0 -> class 16 ("dog"); centered box covering full image
	logits := buildLogits(map[int]int{0: 16})
	boxes := buildBoxes(map[int][4]float32{
		0: {0.5, 0.5, 1.0, 1.0}, // cx,cy,w,h -> x1=0,y1=0,bw=W,bh=H
	})
	origW, origH := 800, 600
	dets := decodeYOLO26Output(logits, boxes, origW, origH, cfg)
	if len(dets) != 1 {
		t.Fatalf("expected 1 detection, got %d", len(dets))
	}
	d := dets[0]
	if d.ClassID != 16 || d.Label != "dog" {
		t.Errorf("class/label = %d/%q, want 16/dog", d.ClassID, d.Label)
	}
	if d.Confidence < 0.99 {
		t.Errorf("confidence = %v, want ~1", d.Confidence)
	}
	if d.BoxX != 0 || d.BoxY != 0 {
		t.Errorf("box origin = (%v,%v), want (0,0)", d.BoxX, d.BoxY)
	}
	if math.Abs(d.BoxWidth-float64(origW)) > 1e-6 || math.Abs(d.BoxHeight-float64(origH)) > 1e-6 {
		t.Errorf("box size = (%v,%v), want (%d,%d)", d.BoxWidth, d.BoxHeight, origW, origH)
	}
}

func TestDecodeYOLO26Output_ClampsNegativeOrigin(t *testing.T) {
	cfg := NewObjectConfig(0.5, 0.5, 100, "")
	logits := buildLogits(map[int]int{0: 0})
	// box centered at (0,0) with full width/height -> x1 and y1 negative -> clamped to 0
	boxes := buildBoxes(map[int][4]float32{
		0: {0.0, 0.0, 1.0, 1.0},
	})
	dets := decodeYOLO26Output(logits, boxes, 640, 480, cfg)
	if len(dets) != 1 {
		t.Fatalf("expected 1 detection, got %d", len(dets))
	}
	if dets[0].BoxX != 0 || dets[0].BoxY != 0 {
		t.Errorf("expected clamped origin (0,0), got (%v,%v)", dets[0].BoxX, dets[0].BoxY)
	}
}

func TestDecodeYOLO26Output_BelowThresholdFiltered(t *testing.T) {
	// MinScore very high -> nothing passes (all sigmoid(-10) ~ 0)
	cfg := NewObjectConfig(0.99, 0.5, 100, "")
	logits := make([]float32, numProposals*numClasses) // all 0 -> sigmoid 0.5
	boxes := make([]float32, numProposals*4)
	dets := decodeYOLO26Output(logits, boxes, 640, 480, cfg)
	if len(dets) != 0 {
		t.Fatalf("expected 0 detections below threshold, got %d", len(dets))
	}
}

func TestDecodeYOLO26Output_SortedByConfidenceAndCapped(t *testing.T) {
	cfg := NewObjectConfig(0.5, 0.5, 2, "") // cap at 2
	// Three proposals with descending logit magnitudes -> descending confidence.
	logits := make([]float32, numProposals*numClasses)
	for i := range logits {
		logits[i] = -10
	}
	// proposal 0 class 0 logit 1 (sigmoid ~0.73)
	logits[0*numClasses+0] = 1
	// proposal 1 class 1 logit 3 (sigmoid ~0.95)
	logits[1*numClasses+1] = 3
	// proposal 2 class 2 logit 5 (sigmoid ~0.99)
	logits[2*numClasses+2] = 5
	boxes := make([]float32, numProposals*4)
	for i := 0; i < 3; i++ {
		boxes[i*4+0] = 0.5
		boxes[i*4+1] = 0.5
		boxes[i*4+2] = 0.2
		boxes[i*4+3] = 0.2
	}
	dets := decodeYOLO26Output(logits, boxes, 640, 480, cfg)
	if len(dets) != 2 {
		t.Fatalf("expected capped to 2 detections, got %d", len(dets))
	}
	// highest confidence first
	if dets[0].Confidence < dets[1].Confidence {
		t.Errorf("not sorted descending: %v then %v", dets[0].Confidence, dets[1].Confidence)
	}
	// top two should be class 2 then class 1
	if dets[0].ClassID != 2 || dets[1].ClassID != 1 {
		t.Errorf("top classes = %d,%d, want 2,1", dets[0].ClassID, dets[1].ClassID)
	}
}

func TestDecodeYOLO26Output_LabelMappingForAllClasses(t *testing.T) {
	cfg := NewObjectConfig(0.5, 0.5, numClasses, "")
	logits := make([]float32, numProposals*numClasses)
	for i := range logits {
		logits[i] = -10
	}
	// Assign first numClasses proposals to each distinct class.
	boxes := make([]float32, numProposals*4)
	for c := 0; c < numClasses; c++ {
		logits[c*numClasses+c] = 10
		boxes[c*4+0] = 0.5
		boxes[c*4+1] = 0.5
		boxes[c*4+2] = 0.1
		boxes[c*4+3] = 0.1
	}
	dets := decodeYOLO26Output(logits, boxes, 640, 480, cfg)
	if len(dets) != numClasses {
		t.Fatalf("expected %d detections, got %d", numClasses, len(dets))
	}
	// Every detection's label must match the COCO table for its class id.
	for _, d := range dets {
		if d.ClassID < 0 || d.ClassID >= len(COCOLabels) {
			t.Fatalf("class id out of range: %d", d.ClassID)
		}
		if d.Label != COCOLabels[d.ClassID] {
			t.Errorf("class %d label = %q, want %q", d.ClassID, d.Label, COCOLabels[d.ClassID])
		}
	}
}

// --- worker.go: NewObjectDetectTask + payload ---

func TestNewObjectDetectTask(t *testing.T) {
	task, err := NewObjectDetectTask("lib-1", "file-1")
	if err != nil {
		t.Fatalf("NewObjectDetectTask: %v", err)
	}
	if task.Type() != TaskTypeObjectDetect {
		t.Errorf("type = %q, want %q", task.Type(), TaskTypeObjectDetect)
	}
	var p ObjectDetectPayload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p.LibraryID != "lib-1" || p.FileID != "file-1" {
		t.Errorf("payload = %+v, want lib-1/file-1", p)
	}
}

func TestObjectDetectPayload_JSONFieldNames(t *testing.T) {
	b, err := json.Marshal(ObjectDetectPayload{FileID: "F", LibraryID: "L"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"fileId":"F"`, `"libraryId":"L"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("payload JSON %s missing %s", b, want)
		}
	}
}

func TestProcessTask_RejectsInvalidPayload(t *testing.T) {
	h := &TaskHandler{}
	bad := asynq.NewTask(TaskTypeObjectDetect, []byte("not json"))
	if err := h.ProcessTask(nil, bad); err == nil {
		t.Fatal("expected error for invalid payload, got nil")
	}
}

func TestNewTaskHandler_FieldsWired(t *testing.T) {
	cfg := NewObjectConfig(0.3, 0.5, 50, "/m")
	h := NewTaskHandler(nil, nil, cfg)
	if h == nil {
		t.Fatal("nil handler")
	}
	if h.config != cfg {
		t.Error("config not wired into handler")
	}
}

// --- service.go ---

func TestNewService_FieldsWired(t *testing.T) {
	cfg := NewObjectConfig(0.3, 0.5, 50, "/m")
	svc := NewService(nil, nil, nil, cfg)
	if svc == nil {
		t.Fatal("nil service")
	}
	if svc.config != cfg {
		t.Error("config not wired into service")
	}
}

func TestService_NewTaskHandler(t *testing.T) {
	cfg := NewObjectConfig(0.3, 0.5, 50, "/m")
	svc := NewService(nil, nil, nil, cfg)
	h := svc.NewTaskHandler()
	if h == nil {
		t.Fatal("nil handler from service")
	}
	if h.config != cfg {
		t.Error("handler config mismatch")
	}
}

// --- models.go: EnsureModelsDownloaded ---

func TestEnsureModelsDownloaded_AlreadyPresent(t *testing.T) {
	dir := t.TempDir()
	// Pre-create a large-enough model file so download is skipped.
	dest := filepath.Join(dir, objectModelFile)
	big := make([]byte, minModelSize+10)
	if err := os.WriteFile(dest, big, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := EnsureModelsDownloaded(dir); err != nil {
		t.Fatalf("EnsureModelsDownloaded with existing file: %v", err)
	}
}

// The once-guarded ONNX runtime initializer moved to
// internal/services/onnxinit; its idempotence/concurrency tests live there.
