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

// TestComputePeaks_MaxAbsoluteSamplePerWindow locks in the industry-standard
// behavior: each output value is the largest |sample| in its window, on a
// linear scale, no per-file normalization. This matches what every major
// audio/video editor and waveform library renders.
func TestComputePeaks_MaxAbsoluteSamplePerWindow(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond

	samples := make([]float32, ws*3)
	fillConst(samples, 0, ws, 0.8)
	fillConst(samples, ws, ws*2, 0.25)
	// Single spike in an otherwise-silent window — the peak reflects it.
	samples[ws*2+5] = 0.6

	peaks, err := h.computePeaks(writePCM(t, samples), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 3 {
		t.Fatalf("expected 3 peaks, got %d", len(peaks))
	}
	if math.Abs(peaks[0]-0.8) > 1e-6 {
		t.Fatalf("peaks[0] = %v, want 0.8", peaks[0])
	}
	if math.Abs(peaks[1]-0.25) > 1e-6 {
		t.Fatalf("peaks[1] = %v, want 0.25", peaks[1])
	}
	if math.Abs(peaks[2]-0.6) > 1e-6 {
		t.Fatalf("peaks[2] = %v, want 0.6", peaks[2])
	}
}

// TestComputePeaks_PreservesAbsoluteLevel verifies that a quieter file
// produces proportionally smaller peaks — i.e. there is no per-file
// normalization that would flatten dynamics. A loud file should look loud
// and a quiet file should look quiet.
func TestComputePeaks_PreservesAbsoluteLevel(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond

	build := func(scale float32) []float32 {
		s := make([]float32, ws*2)
		fillConst(s, 0, ws, 1.0*scale)
		fillConst(s, ws, ws*2, 0.5*scale)
		return s
	}

	loud, err := h.computePeaks(writePCM(t, build(0.8)), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("loud: %v", err)
	}
	quiet, err := h.computePeaks(writePCM(t, build(0.1)), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("quiet: %v", err)
	}

	if math.Abs(loud[0]-0.8) > 1e-6 || math.Abs(loud[1]-0.4) > 1e-6 {
		t.Fatalf("loud peaks not preserved: %v", loud)
	}
	if math.Abs(quiet[0]-0.1) > 1e-6 || math.Abs(quiet[1]-0.05) > 1e-6 {
		t.Fatalf("quiet peaks not preserved: %v", quiet)
	}
}

// TestComputePeaks_SilentInputProducesZeros — silence stays silent. No
// noise-floor amplification.
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

// TestComputePeaks_PolaritySymmetric — peak uses |sample|, so a signal and
// its inverse produce identical output.
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

// TestComputePeaks_OutputBoundedZeroOne — the renderer multiplies by canvas
// height and assumes [0,1]. Out-of-range PCM (sample > 1.0) must clamp.
func TestComputePeaks_OutputBoundedZeroOne(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond
	samples := make([]float32, ws*3)
	fillConst(samples, 0, ws, 5.0) // way out of range
	fillConst(samples, ws, ws*2, 0.5)
	fillConst(samples, ws*2, ws*3, 0.001) // very quiet

	peaks, err := h.computePeaks(writePCM(t, samples), defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if peaks[0] != 1.0 {
		t.Fatalf("expected out-of-range to clamp to 1.0, got %v", peaks[0])
	}
	for i, p := range peaks {
		if p < 0 || p > 1 {
			t.Fatalf("peaks[%d]=%v outside [0,1]", i, p)
		}
	}
}

// TestComputePeaks_PartialWindowDropped — a trailing partial window must not
// produce a spurious peak.
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
