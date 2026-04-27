package transcribe

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/hibiken/asynq"
)

func TestNewTranscribeTask_TypeAndPayload(t *testing.T) {
	task, err := NewTranscribeTask("lib-1", "file-1")
	if err != nil {
		t.Fatalf("NewTranscribeTask: %v", err)
	}
	if task.Type() != TaskTypeTranscribe {
		t.Fatalf("task type: got %q want %q", task.Type(), TaskTypeTranscribe)
	}
	var p Payload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p.LibraryID != "lib-1" || p.FileID != "file-1" {
		t.Fatalf("payload: got %+v", p)
	}
}

func TestPayloadJSONFieldNames(t *testing.T) {
	// Locks the on-the-wire field names — workers in flight expect these
	// exact keys, so a Go field rename without `json:` tag preservation
	// would silently break the queue.
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
	bad := asynq.NewTask(TaskTypeTranscribe, []byte("not json"))
	if err := h.ProcessTask(context.Background(), bad); err == nil {
		t.Fatal("expected error for invalid payload, got nil")
	}
}

func TestTimestampRegex_ParsesSegmentEnd(t *testing.T) {
	cases := []struct {
		line   string
		wantSec float64
	}{
		{"[00:00:00.000 --> 00:00:02.140]   we don't use the hardware", 2.14},
		{"[00:01:23.500 --> 00:01:25.500]   text", 85.5},
		{"[01:30:00.000 --> 01:30:30.000]   text", 5430.0},
	}
	for _, tc := range cases {
		m := timestampRegex.FindStringSubmatch(tc.line)
		if m == nil {
			t.Errorf("regex did not match %q", tc.line)
			continue
		}
		hh, _ := atoiOrZero(m[1])
		mm, _ := atoiOrZero(m[2])
		ss, _ := atoiOrZero(m[3])
		ms, _ := atoiOrZero(m[4])
		got := float64(hh*3600+mm*60+ss) + float64(ms)/1000
		if got != tc.wantSec {
			t.Errorf("line %q: got %v want %v", tc.line, got, tc.wantSec)
		}
	}
}

func TestTimestampRegex_RejectsStartTimestamp(t *testing.T) {
	// We must match only the END (after `-->`), not the START — otherwise
	// every line fires progress at its segment-start position which is fine
	// but our regex is anchored to `-->` so confirm it is.
	line := "[00:01:23.000 --> 00:01:25.000]   text"
	m := timestampRegex.FindStringSubmatch(line)
	if m == nil {
		t.Fatal("expected match")
	}
	if m[2] == "01" && m[3] == "23" {
		t.Fatalf("regex matched the start timestamp instead of the end: %v", m)
	}
}

func TestProgressRegex_ParsesPercent(t *testing.T) {
	cases := []struct {
		line string
		want string
	}{
		{"whisper_print_progress_callback: progress =  49%", "49"},
		{"progress = 0%", "0"},
		{"progress = 100%", "100"},
		{"progress=12", "12"},
	}
	for _, tc := range cases {
		m := progressRegex.FindStringSubmatch(tc.line)
		if m == nil {
			t.Errorf("regex did not match %q", tc.line)
			continue
		}
		if m[1] != tc.want {
			t.Errorf("line %q: got %q want %q", tc.line, m[1], tc.want)
		}
	}
}

func atoiOrZero(s string) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, nil
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

func TestProgressTracker_TimestampLinesEmitMonotonic(t *testing.T) {
	var calls []int
	var mu sync.Mutex
	last := 0
	tr := &progressTracker{
		audioSec:   100, // 100s of audio
		onProgress: func(p int) { calls = append(calls, p) },
		mu:         &mu,
		lastPct:    &last,
	}
	// Simulate whisper output: segments climb steadily, then a backwards jump
	// (re-emit of an earlier line) which must be ignored.
	lines := []string{
		"[00:00:00.000 --> 00:00:05.000]   first",  //  5%
		"[00:00:05.000 --> 00:00:10.000]   second", // 10%
		"[00:00:10.000 --> 00:00:15.000]   third",  // 15%
		"[00:00:00.000 --> 00:00:02.000]   replay", //  2% — must be skipped
		"[00:00:15.000 --> 00:00:30.000]   fourth", // 30%
		"[00:00:30.000 --> 00:01:39.500]   last",   // 99%
	}
	for _, l := range lines {
		tr.consume(l)
	}
	want := []int{5, 10, 15, 30, 99}
	if !reflect.DeepEqual(calls, want) {
		t.Errorf("got %v, want %v", calls, want)
	}
}

func TestProgressTracker_ClampsToNinetyNine(t *testing.T) {
	var got []int
	var mu sync.Mutex
	last := 0
	tr := &progressTracker{
		audioSec:   10,
		onProgress: func(p int) { got = append(got, p) },
		mu:         &mu,
		lastPct:    &last,
	}
	tr.consume("[00:00:00.000 --> 00:00:50.000]   over") // 500% raw → clamp 99
	if len(got) != 1 || got[0] != 99 {
		t.Errorf("expected [99], got %v", got)
	}
}

func TestProgressTracker_FallbackProgressLine(t *testing.T) {
	var got []int
	var mu sync.Mutex
	last := 0
	tr := &progressTracker{
		audioSec:   0, // duration unknown — only the `progress = N%` path fires
		onProgress: func(p int) { got = append(got, p) },
		mu:         &mu,
		lastPct:    &last,
	}
	tr.consume("[00:00:00.000 --> 00:00:10.000]   ignored — audioSec=0")
	tr.consume("whisper_print_progress_callback: progress =  25%")
	tr.consume("whisper_print_progress_callback: progress =  20%") // backwards — skip
	tr.consume("whisper_print_progress_callback: progress =  50%")
	if !reflect.DeepEqual(got, []int{25, 50}) {
		t.Errorf("got %v, want [25 50]", got)
	}
}

func TestProgressTracker_NilCallbackIsSafe(t *testing.T) {
	var mu sync.Mutex
	last := 0
	tr := &progressTracker{audioSec: 100, onProgress: nil, mu: &mu, lastPct: &last}
	// Must not panic.
	tr.consume("[00:00:00.000 --> 00:00:10.000]   x")
}

func TestWavDurationSeconds_ComputesFromFileSize(t *testing.T) {
	// 44-byte header + 32000 bytes (1 second of 16-bit mono 16kHz PCM).
	dir := t.TempDir()
	p := dir + "/audio.wav"
	header := make([]byte, 44)
	body := make([]byte, 32000*3) // 3 seconds
	all := append(header, body...)
	if err := os.WriteFile(p, all, 0o644); err != nil {
		t.Fatal(err)
	}
	got := wavDurationSeconds(p)
	if got < 2.99 || got > 3.01 {
		t.Errorf("expected ~3s, got %v", got)
	}
}

func TestWavDurationSeconds_MissingFileReturnsZero(t *testing.T) {
	if got := wavDurationSeconds("/no/such/file.wav"); got != 0 {
		t.Errorf("expected 0 on missing file, got %v", got)
	}
}
