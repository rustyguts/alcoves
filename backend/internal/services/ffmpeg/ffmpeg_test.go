package ffmpeg

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestParseOutTime(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    float64
		wantErr bool
	}{
		{name: "hms with fraction", in: "00:01:30.500", want: 90.5},
		{name: "hours", in: "01:00:00.000", want: 3600},
		{name: "zero", in: "00:00:00.000", want: 0},
		{name: "too few parts", in: "01:30", wantErr: true},
		{name: "non-numeric", in: "aa:bb:cc", wantErr: true},
		{name: "empty", in: "", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseOutTime(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q, got %v", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.in, err)
			}
			if math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("parseOutTime(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestParseSpeed(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    float64
		wantErr bool
	}{
		{name: "with x suffix", in: "1.5x", want: 1.5},
		{name: "integer", in: "2x", want: 2},
		{name: "whitespace", in: " 2.0x ", want: 2},
		{name: "no suffix", in: "3.0", want: 3},
		{name: "empty", in: "", wantErr: true},
		{name: "only x", in: "x", wantErr: true},
		{name: "zero", in: "0", wantErr: true},
		{name: "zero x", in: "0x", wantErr: true},
		{name: "negative", in: "-1x", wantErr: true},
		{name: "non-numeric", in: "fastx", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseSpeed(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q, got %v", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.in, err)
			}
			if math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("parseSpeed(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// writeStub writes an executable /bin/sh script to a temp dir and returns its path.
func writeStub(t *testing.T, body string) string {
	t.Helper()
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh unavailable; skipping stub-based test")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "stub.sh")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	return path
}

func TestRunWithProgress_ReportsMonotonicProgress(t *testing.T) {
	stub := writeStub(t, "#!/bin/sh\n"+
		"printf 'out_time=00:00:05.000\\nspeed=2.0x\\nprogress=continue\\n"+
		"out_time=00:00:10.000\\nspeed=2.0x\\nprogress=end\\n' 1>&2\n")

	type tick struct {
		percent int
		eta     *int
	}
	var ticks []tick
	err := RunWithProgress(context.Background(), stub, []string{}, 10.0, func(p int, eta *int) {
		ticks = append(ticks, tick{p, eta})
	})
	if err != nil {
		t.Fatalf("RunWithProgress returned error: %v", err)
	}
	if len(ticks) == 0 {
		t.Fatal("expected at least one progress tick")
	}

	// Monotonic non-decreasing, ending at 100.
	prev := -1
	for i, tk := range ticks {
		if tk.percent < prev {
			t.Fatalf("tick %d percent %d decreased from %d", i, tk.percent, prev)
		}
		prev = tk.percent
	}
	if got := ticks[len(ticks)-1].percent; got != 100 {
		t.Fatalf("final percent = %d, want 100", got)
	}

	// 5s/10s -> 50% with a finite ETA; remaining 5s at 2x => ceil(2.5)=3.
	first := ticks[0]
	if first.percent != 50 {
		t.Fatalf("first percent = %d, want 50", first.percent)
	}
	if first.eta == nil || *first.eta != 3 {
		t.Fatalf("first eta = %v, want 3", first.eta)
	}
	// At 100% (out_time == duration) ETA is nil (no remaining work reported).
	if ticks[len(ticks)-1].eta != nil {
		t.Fatalf("final eta = %v, want nil", *ticks[len(ticks)-1].eta)
	}
}

func TestRunWithProgress_NilCallbackStillRuns(t *testing.T) {
	stub := writeStub(t, "#!/bin/sh\n"+
		"printf 'out_time=00:00:05.000\\nprogress=end\\n' 1>&2\n")
	if err := RunWithProgress(context.Background(), stub, []string{}, 10.0, nil); err != nil {
		t.Fatalf("RunWithProgress with nil callback returned error: %v", err)
	}
}

func TestRunWithProgress_NonZeroExitReturnsError(t *testing.T) {
	stub := writeStub(t, "#!/bin/sh\nexit 1\n")
	called := false
	err := RunWithProgress(context.Background(), stub, []string{}, 10.0, func(int, *int) {
		called = true
	})
	if err == nil {
		t.Fatal("expected error from non-zero exit, got nil")
	}
	if called {
		t.Fatal("callback should not have been invoked for a stub emitting no progress")
	}
}
