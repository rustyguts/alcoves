package waveform

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// writePCM writes a sequence of float32 samples little-endian to a temp file
// for use as the input to computePeaks.
func writePCM(t *testing.T, samples []float32) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "audio.pcm")
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

// fillConst writes value into samples[from:to].
func fillConst(samples []float32, from, to int, value float32) {
	for i := from; i < to; i++ {
		samples[i] = value
	}
}

// TestComputePeaks_UsesRMSNotPeak is the headline regression test for the
// switch from max-peak to RMS sampling. A sustained mid-amplitude tone is the
// "louder" window perceptually; a single-sample spike in an otherwise-silent
// window should NOT outrank it. The previous max-peak implementation reversed
// this — every spike pegged its window to full-scale and drowned out the
// real signal.
func TestComputePeaks_UsesRMSNotPeak(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond

	samples := make([]float32, ws*2)
	// Window 0: sustained tone at 0.5 (RMS = 0.5).
	fillConst(samples, 0, ws, 0.5)
	// Window 1: silent except for a single full-scale spike (RMS ≈ 0.056).
	samples[ws+10] = 1.0

	peaks, err := h.computePeaks(writePCM(t, samples), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 2 {
		t.Fatalf("expected 2 peaks, got %d", len(peaks))
	}
	if peaks[0] <= peaks[1] {
		t.Fatalf("sustained tone (peaks[0]=%v) should be louder than single-spike window (peaks[1]=%v)", peaks[0], peaks[1])
	}
	// Also nail down the absolute scale: the sustained tone is the file's
	// reference loudness, so it must pin at full scale.
	if math.Abs(peaks[0]-1.0) > 1e-9 {
		t.Fatalf("expected sustained-tone window to normalize to 1.0, got %v", peaks[0])
	}
}

// TestComputePeaks_PerFileNormalization verifies that two files with the same
// shape but different absolute volumes produce identical waveforms. This is
// the property that makes a quiet podcast and a loud song equally readable.
func TestComputePeaks_PerFileNormalization(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond

	build := func(scale float32) []float32 {
		s := make([]float32, ws*3)
		fillConst(s, 0, ws, 1.0*scale)
		fillConst(s, ws, ws*2, 0.5*scale)
		fillConst(s, ws*2, ws*3, 0.25*scale)
		return s
	}

	loud, err := h.computePeaks(writePCM(t, build(0.8)), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("loud: %v", err)
	}
	quiet, err := h.computePeaks(writePCM(t, build(0.05)), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("quiet: %v", err)
	}
	if len(loud) != len(quiet) {
		t.Fatalf("length mismatch: loud=%d quiet=%d", len(loud), len(quiet))
	}
	for i := range loud {
		if math.Abs(loud[i]-quiet[i]) > 1e-9 {
			t.Fatalf("normalization not invariant to scale: loud[%d]=%v quiet[%d]=%v", i, loud[i], i, quiet[i])
		}
	}
}

// TestComputePeaks_DBCurveExpandsLowerEnd locks in the dB-mapped visual range.
// A window at -6dBFS relative to the file reference (half-amplitude RMS) must
// land near 0.88 — well above its raw value of 0.5 — so visible variation
// happens in the upper half of the canvas where the eye can resolve it.
func TestComputePeaks_DBCurveExpandsLowerEnd(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond

	samples := make([]float32, ws*2)
	fillConst(samples, 0, ws, 0.5)        // reference window (0 dBFS relative)
	fillConst(samples, ws, ws*2, 0.25)    // -6 dBFS relative

	peaks, err := h.computePeaks(writePCM(t, samples), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if math.Abs(peaks[0]-1.0) > 1e-9 {
		t.Fatalf("reference window should map to 1.0, got %v", peaks[0])
	}
	// (-6.02 dB - (-50 dB)) / 50 dB = 0.8796...
	const expected = 0.87959
	if math.Abs(peaks[1]-expected) > 1e-3 {
		t.Fatalf("expected -6dB window near %v, got %v", expected, peaks[1])
	}
}

// TestComputePeaks_SilentInputProducesZeros confirms we don't amplify the
// noise floor of a silent file all the way to 1.0. Without the silence-floor
// guard, dividing 0 by a tiny reference would give NaN or unbounded values.
func TestComputePeaks_SilentInputProducesZeros(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond
	samples := make([]float32, ws*4) // all zeros

	peaks, err := h.computePeaks(writePCM(t, samples), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 4 {
		t.Fatalf("expected 4 peaks, got %d", len(peaks))
	}
	for i, p := range peaks {
		if p != 0 {
			t.Fatalf("expected silence at peaks[%d], got %v", i, p)
		}
	}
}

// TestComputePeaks_PolaritySymmetric verifies that since RMS uses x², a
// negative-going window and the same window inverted produce identical
// output (no asymmetry from a missing abs()).
func TestComputePeaks_PolaritySymmetric(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond

	pos := make([]float32, ws)
	neg := make([]float32, ws)
	for i := 0; i < ws; i++ {
		v := float32(math.Sin(float64(i) / 10.0))
		pos[i] = v
		neg[i] = -v
	}

	pp, err := h.computePeaks(writePCM(t, pos), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("pos: %v", err)
	}
	np, err := h.computePeaks(writePCM(t, neg), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("neg: %v", err)
	}
	if len(pp) != 1 || len(np) != 1 || pp[0] != np[0] {
		t.Fatalf("polarity asymmetry: pos=%v neg=%v", pp, np)
	}
}

// TestComputePeaks_OutputBoundedZeroOne is a structural guarantee — the
// renderer multiplies by canvas height and assumes [0,1]. Out-of-range PCM
// (sample > 1.0) must clamp.
func TestComputePeaks_OutputBoundedZeroOne(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond
	samples := make([]float32, ws*3)
	fillConst(samples, 0, ws, 5.0)        // way out of range
	fillConst(samples, ws, ws*2, 0.5)
	fillConst(samples, ws*2, ws*3, 0.001) // very quiet

	peaks, err := h.computePeaks(writePCM(t, samples), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	for i, p := range peaks {
		if p < 0 || p > 1 {
			t.Fatalf("peaks[%d]=%v outside [0,1]", i, p)
		}
	}
}

// TestComputePeaks_PartialWindowDropped — a trailing partial window must not
// produce a spurious peak. (Behavior preserved from the old implementation.)
func TestComputePeaks_PartialWindowDropped(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond
	samples := make([]float32, ws+10)
	samples[0] = 0.3
	samples[ws+5] = 0.9 // in the partial window — must be ignored

	peaks, err := h.computePeaks(writePCM(t, samples), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 1 {
		t.Fatalf("expected 1 peak (partial dropped), got %d", len(peaks))
	}
}

// TestComputePeaks_WindowCountMatchesPPS — at higher peaks-per-second the
// window size shrinks proportionally and we get more output points.
func TestComputePeaks_WindowCountMatchesPPS(t *testing.T) {
	h := &TaskHandler{}
	const pps = 200
	const ws = sampleRateHz / pps // 80
	samples := make([]float32, ws*4)
	fillConst(samples, 0, ws*4, 0.25)

	peaks, err := h.computePeaks(writePCM(t, samples), pps)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 4 {
		t.Fatalf("expected 4 peaks at pps=%d, got %d", pps, len(peaks))
	}
}

func TestComputePeaks_RejectsBadPCMLength(t *testing.T) {
	h := &TaskHandler{}
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.pcm")
	if err := os.WriteFile(path, []byte{1, 2, 3, 4, 5}, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := h.computePeaks(path, defaultPeaksPerSecond); err == nil {
		t.Fatalf("expected error for non-multiple-of-4 PCM, got nil")
	}
}

// --- Unit tests for the helpers ---

func TestNormalizeAndScale_EmptyInput(t *testing.T) {
	out := normalizeAndScale(nil)
	if len(out) != 0 {
		t.Fatalf("expected empty output, got len=%d", len(out))
	}
}

func TestNormalizeAndScale_SilentBelowFloor(t *testing.T) {
	// All RMS values are below silenceFloorRMS — should emit zeros instead of
	// dividing by a tiny reference and amplifying pure noise.
	in := []float64{1e-6, 5e-7, 0, 1e-8}
	out := normalizeAndScale(in)
	if len(out) != len(in) {
		t.Fatalf("length mismatch: in=%d out=%d", len(in), len(out))
	}
	for i, v := range out {
		if v != 0 {
			t.Fatalf("expected silence at out[%d], got %v", i, v)
		}
	}
}

func TestNormalizeAndScale_ReferenceMapsToOne(t *testing.T) {
	// The p99 reference value, normalized, should land at exactly 1.0 (0 dB).
	out := normalizeAndScale([]float64{0.5})
	if math.Abs(out[0]-1.0) > 1e-12 {
		t.Fatalf("reference expected 1.0, got %v", out[0])
	}
}

func TestNormalizeAndScale_DBFloorMapsToZero(t *testing.T) {
	// A value 60 dB below reference (factor 1e-3) is below our -50 dB floor,
	// so it should clamp to 0 — we don't waste visual range on the inaudible.
	out := normalizeAndScale([]float64{1.0, 1e-3})
	if out[0] != 1.0 {
		t.Fatalf("reference should be 1.0, got %v", out[0])
	}
	if out[1] != 0 {
		t.Fatalf("-60dB value should clamp to 0, got %v", out[1])
	}
}

func TestNormalizeAndScale_MonotonicOrdering(t *testing.T) {
	// Strictly increasing RMS → strictly increasing output (above the floor).
	in := []float64{0.05, 0.1, 0.2, 0.4, 0.8}
	out := normalizeAndScale(in)
	for i := 1; i < len(out); i++ {
		if out[i] <= out[i-1] {
			t.Fatalf("monotonicity broken at i=%d: out=%v", i, out)
		}
	}
}

func TestNormalizeAndScale_AboveReferenceClamps(t *testing.T) {
	// The top 1% of windows can exceed the p99 reference — those must clamp
	// to 1.0 rather than producing positive dB and overshooting.
	in := make([]float64, 100)
	for i := range in {
		in[i] = 0.5
	}
	in[99] = 5.0 // outlier well above reference
	out := normalizeAndScale(in)
	if out[99] != 1.0 {
		t.Fatalf("outlier should clamp to 1.0, got %v", out[99])
	}
}

func TestQuantile(t *testing.T) {
	cases := []struct {
		name string
		in   []float64
		q    float64
		want float64
	}{
		{"empty", nil, 0.5, 0},
		{"single", []float64{0.7}, 0.99, 0.7},
		{"median odd", []float64{1, 5, 2, 4, 3}, 0.5, 3},
		{"min", []float64{1, 5, 2, 4, 3}, 0, 1},
		{"max", []float64{1, 5, 2, 4, 3}, 1, 5},
		{"q clamped low", []float64{1, 2, 3}, -0.5, 1},
		{"q clamped high", []float64{1, 2, 3}, 2.0, 3},
		// p99 of 100 sorted values [1..100] → idx round(0.99*99)=98 → 99.
		{"p99", makeRange(1, 100), 0.99, 99},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := quantile(tc.in, tc.q)
			if got != tc.want {
				t.Fatalf("quantile(%v, %v) = %v, want %v", tc.in, tc.q, got, tc.want)
			}
		})
	}
}

func TestQuantile_DoesNotMutateInput(t *testing.T) {
	in := []float64{3, 1, 2}
	_ = quantile(in, 0.5)
	if in[0] != 3 || in[1] != 1 || in[2] != 2 {
		t.Fatalf("input mutated: %v", in)
	}
}

func makeRange(lo, hi int) []float64 {
	out := make([]float64, 0, hi-lo+1)
	for i := lo; i <= hi; i++ {
		out = append(out, float64(i))
	}
	return out
}
