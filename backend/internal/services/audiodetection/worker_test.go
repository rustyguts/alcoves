package audiodetection

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/queues"
)

func TestNewTask_TypeAndPayload(t *testing.T) {
	task, err := newTask(Payload{LibraryID: "lib-1", FileID: "file-1"})
	if err != nil {
		t.Fatalf("newTask: %v", err)
	}
	if task.Type() != TaskTypeAudioDetect {
		t.Fatalf("task type: got %q want %q", task.Type(), TaskTypeAudioDetect)
	}
	var p Payload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.LibraryID != "lib-1" || p.FileID != "file-1" {
		t.Fatalf("payload: got %+v", p)
	}
}

func TestPayloadJSONFieldNames(t *testing.T) {
	b, err := json.Marshal(Payload{LibraryID: "L", FileID: "F"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"libraryId":"L"`, `"fileId":"F"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("payload JSON %s missing %s", b, want)
		}
	}
}

func TestProcessTask_RejectsInvalidPayload(t *testing.T) {
	h := &TaskHandler{}
	bad := asynq.NewTask(TaskTypeAudioDetect, []byte("not json"))
	if err := h.ProcessTask(context.Background(), bad); err == nil {
		t.Fatal("expected error for invalid payload, got nil")
	}
}

func TestEnqueueDetect_DedupsConcurrentRequests(t *testing.T) {
	// Reproduces the houston bug: a duplicate enqueue (double-clicked
	// "detect" button or two pods racing) MUST NOT spawn a second worker
	// pass that competes with the first on audio_detect_progress
	// updates and races the final DELETE+INSERT transaction.
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()

	svc := &Service{asynqClient: client}

	if err := svc.EnqueueDetect("lib-1", "file-1"); err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	if err := svc.EnqueueDetect("lib-1", "file-1"); err != nil {
		t.Fatalf("duplicate enqueue should be swallowed, got: %v", err)
	}
	// Different file is independent — must enqueue.
	if err := svc.EnqueueDetect("lib-1", "file-2"); err != nil {
		t.Fatalf("different file enqueue: %v", err)
	}

	// Sanity: bare client without dedup option would surface
	// ErrDuplicateTask. Confirm the underlying option is what gates this,
	// not some other code path that silently accepts everything. The raw
	// enqueue must target the same queue the service uses, since asynq keys
	// its uniqueness lock by queue + type + payload.
	task, _ := newTask(Payload{LibraryID: "lib-1", FileID: "file-1"})
	_, err := client.Enqueue(task, asynq.Queue(queues.AudioDetection), asynq.Unique(enqueueUniqueWindow))
	if !errors.Is(err, asynq.ErrDuplicateTask) {
		t.Fatalf("expected asynq.ErrDuplicateTask from raw client, got: %v", err)
	}
}

// writePCMFloat32 writes a slice of float32 values as little-endian raw PCM to
// a temp file and returns the path.
func writePCMFloat32(t *testing.T, samples []float32) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "audio.f32le")
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create pcm: %v", err)
	}
	defer f.Close()
	for _, s := range samples {
		if err := binary.Write(f, binary.LittleEndian, s); err != nil {
			t.Fatalf("write sample: %v", err)
		}
	}
	return path
}

// TestDecodePCMBytes_NumericIdentity asserts that decodePCMBytes produces the
// same float32 values as the original readFloat32PCM bulk approach, verifying
// the streaming window decode is numerically correct.
func TestDecodePCMBytes_NumericIdentity(t *testing.T) {
	want := []float32{0.0, 0.5, -0.5, 1.0, -1.0, 0.25, 0.75, -0.75}
	path := writePCMFloat32(t, want)

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read pcm: %v", err)
	}

	got := make([]float32, len(want))
	decodePCMBytes(data, got)

	for i, g := range got {
		if math.Abs(float64(g-want[i])) > 1e-7 {
			t.Errorf("got[%d]=%v want %v", i, g, want[i])
		}
	}
}

// TestDecodePCMBytes_ZeroPadsPartialWindow verifies that when the raw byte
// slice is shorter than len(dst)*4 the remaining dst elements are zeroed.
func TestDecodePCMBytes_ZeroPadsPartialWindow(t *testing.T) {
	// Write 3 samples; window buffer holds 5.
	samples := []float32{0.1, 0.2, 0.3}
	path := writePCMFloat32(t, samples)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read pcm: %v", err)
	}

	dst := make([]float32, 5)
	decodePCMBytes(data, dst)

	for i, s := range samples {
		if math.Abs(float64(dst[i]-s)) > 1e-7 {
			t.Errorf("dst[%d]=%v want %v", i, dst[i], s)
		}
	}
	for i := len(samples); i < len(dst); i++ {
		if dst[i] != 0 {
			t.Errorf("padding dst[%d]=%v want 0", i, dst[i])
		}
	}
}

// TestGetSession_ConcurrentLoadIsSafe verifies that getSession is safe to call
// concurrently from multiple goroutines and that a failed load is not cached
// (so a transient failure does not poison the worker forever). We use a
// non-existent model path so LoadSession returns an error fast (no ONNX model
// on the CI runner).
func TestGetSession_ConcurrentLoadIsSafe(t *testing.T) {
	// Reset package-level state so this test is independent.
	sessionMu.Lock()
	cachedSession = nil
	cachedKey = ""
	sessionMu.Unlock()

	const bogusPath = "/nonexistent/model.onnx"
	const n = 5

	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = getSession(bogusPath, 32000)
		}()
	}
	wg.Wait()

	// All calls must return an error (model does not exist) and must NOT be
	// cached — a failed load must be retryable.
	for i, e := range errs {
		if e == nil {
			t.Errorf("call %d: expected error for nonexistent model, got nil", i)
		}
	}
	sessionMu.Lock()
	cached := cachedSession
	sessionMu.Unlock()
	if cached != nil {
		t.Errorf("failed load must not be cached, got %v", cached)
	}
}

// TestGetSession_RekeysOnModelChange verifies that switching the model key
// triggers a reload rather than returning the previously cached session — the
// runtime-model-switch correctness guarantee. Both loads fail (no ONNX on CI),
// so we assert on the cachedKey transition rather than a live session.
func TestGetSession_RekeysOnModelChange(t *testing.T) {
	sessionMu.Lock()
	// Seed a fake cached session under key "modelA|16000".
	cachedSession = &sessionInfo{}
	cachedKey = "/modelA.onnx|16000"
	seeded := cachedSession
	sessionMu.Unlock()

	// Same key → returns the cached session without reloading.
	got, err := getSession("/modelA.onnx", 16000)
	if err != nil || got != seeded {
		t.Fatalf("same key should return cached session: got=%v err=%v", got, err)
	}

	// Different model → key mismatch forces a reload (which fails on the bogus
	// path), and the stale session must no longer be returned.
	got, err = getSession("/modelB.onnx", 16000)
	if err == nil {
		t.Fatalf("expected reload error for new bogus model")
	}
	if got == seeded {
		t.Errorf("model switch must not return the stale cached session")
	}
}
