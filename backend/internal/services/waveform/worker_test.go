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

func TestComputePeaks_WindowsTakeMaxAbs(t *testing.T) {
	h := &TaskHandler{}
	// Two windows of windowSize = sampleRateHz/peaksPerSec = 16000/50 = 320.
	// First window: max abs = 0.5; Second window: max abs = 0.9 (negative values
	// must be normalized via abs).
	const ws = sampleRateHz / defaultPeaksPerSecond
	samples := make([]float32, ws*2)
	for i := 0; i < ws; i++ {
		samples[i] = 0.1
	}
	samples[100] = 0.5
	for i := ws; i < ws*2; i++ {
		samples[i] = 0.2
	}
	samples[ws+50] = -0.9

	path := writePCM(t, samples)
	peaks, err := h.computePeaks(path, defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 2 {
		t.Fatalf("expected 2 peaks, got %d", len(peaks))
	}
	if math.Abs(peaks[0]-0.5) > 1e-6 {
		t.Fatalf("expected peak[0]=0.5, got %v", peaks[0])
	}
	if math.Abs(peaks[1]-0.9) > 1e-6 {
		t.Fatalf("expected peak[1]=0.9, got %v", peaks[1])
	}
}

func TestComputePeaks_ClampsToOne(t *testing.T) {
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond
	samples := make([]float32, ws)
	samples[0] = 5.0 // out-of-range; should clamp to 1.0
	path := writePCM(t, samples)

	peaks, err := h.computePeaks(path, defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 1 {
		t.Fatalf("expected 1 peak, got %d", len(peaks))
	}
	if peaks[0] != 1.0 {
		t.Fatalf("expected clamp to 1.0, got %v", peaks[0])
	}
}

func TestComputePeaks_PartialWindowDropped(t *testing.T) {
	// A trailing partial window (< windowSize) is dropped — we only emit
	// peaks for full windows.
	h := &TaskHandler{}
	const ws = sampleRateHz / defaultPeaksPerSecond
	samples := make([]float32, ws+10) // one full window + 10 trailing samples
	samples[0] = 0.3
	samples[ws+5] = 0.9 // trailing — should not produce a peak

	path := writePCM(t, samples)
	peaks, err := h.computePeaks(path, defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 1 {
		t.Fatalf("expected 1 peak (partial dropped), got %d", len(peaks))
	}
	if math.Abs(peaks[0]-0.3) > 1e-6 {
		t.Fatalf("expected peak[0]=0.3, got %v", peaks[0])
	}
}

func TestComputePeaks_RejectsBadPCMLength(t *testing.T) {
	h := &TaskHandler{}
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.pcm")
	// 5 bytes is not a multiple of 4 → not valid float32 PCM.
	if err := os.WriteFile(path, []byte{1, 2, 3, 4, 5}, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := h.computePeaks(path, defaultPeaksPerSecond); err == nil {
		t.Fatalf("expected error for non-multiple-of-4 PCM, got nil")
	}
}

func TestComputePeaks_HighResolutionPeaksPerSecond(t *testing.T) {
	// At 200 peaks/sec, windowSize = 16000/200 = 80 samples. Each window of
	// 80 samples → one peak. 4 windows = 4 peaks.
	h := &TaskHandler{}
	const pps = 200
	const ws = sampleRateHz / pps
	samples := make([]float32, ws*4)
	for i := range samples {
		samples[i] = 0.25
	}
	path := writePCM(t, samples)
	peaks, err := h.computePeaks(path, pps)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 4 {
		t.Fatalf("expected 4 peaks at pps=%d, got %d", pps, len(peaks))
	}
	for i, p := range peaks {
		if math.Abs(p-0.25) > 1e-6 {
			t.Fatalf("peak[%d] expected 0.25, got %v", i, p)
		}
	}
}
