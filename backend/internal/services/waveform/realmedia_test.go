package waveform

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// These tests exercise the real waveform DSP against real, ffmpeg-decoded audio
// (generated tones with known amplitude envelopes, plus a committed speech
// clip) rather than hand-written PCM. They prove the full extract → peak
// pipeline produces a waveform whose values track the actual signal level.
//
// All ffmpeg-dependent tests skip cleanly when ffmpeg is unavailable, matching
// the rest of the waveform suite.

func ftoa(f float64) string { return strconv.FormatFloat(f, 'g', -1, 64) }

// genSineWav writes a mono 16kHz WAV of a 440Hz sine at an exact peak
// amplitude (0..1) using ffmpeg's aevalsrc — which, unlike the `sine` source
// (whose default level is ~-18 dBFS), lets us control the amplitude precisely.
func genSineWav(t *testing.T, dir, name string, durSec float64, amplitude float64) string {
	t.Helper()
	out := filepath.Join(dir, name)
	expr := "aevalsrc=exprs=" + ftoa(amplitude) + "*sin(2*PI*440*t):sample_rate=16000:duration=" + ftoa(durSec)
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", expr,
		"-ac", "1", "-ar", "16000",
		out,
	)
	if combined, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg gen sine failed: %v\n%s", err, combined)
	}
	return out
}

func extractPeaks(t *testing.T, src string) []float64 {
	t.Helper()
	h := NewTaskHandler(nil, nil, testConfig(), nil)
	dst := filepath.Join(t.TempDir(), "audio.pcm")
	if err := h.extractPCM(context.Background(), src, dst); err != nil {
		t.Fatalf("extractPCM: %v", err)
	}
	peaks, err := h.computePeaks(dst, defaultPeaksPerSecond)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	return peaks
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}

// TestWaveform_RealTone_KnownAmplitude decodes ffmpeg-generated sine tones at
// two known volumes and confirms the computed peaks match the source level.
func TestWaveform_RealTone_KnownAmplitude(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()

	full := extractPeaks(t, genSineWav(t, dir, "full.wav", 1.0, 1.0))
	half := extractPeaks(t, genSineWav(t, dir, "half.wav", 1.0, 0.5))

	if len(full) < 40 || len(half) < 40 {
		t.Fatalf("too few peaks: full=%d half=%d", len(full), len(half))
	}
	// A 320-sample window over ~8.8 cycles of a 440Hz sine captures very close
	// to the true crest, so peaks sit just under the source amplitude.
	if m := mean(full[5:45]); m < 0.95 || m > 1.0001 {
		t.Fatalf("full-scale tone mean peak %.4f, want ~1.0", m)
	}
	if m := mean(half[5:45]); m < 0.45 || m > 0.52 {
		t.Fatalf("half-scale tone mean peak %.4f, want ~0.5", m)
	}
}

// TestWaveform_RealEnvelope confirms peaks track a loud→quiet amplitude
// envelope within a single real decode.
func TestWaveform_RealEnvelope(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	out := filepath.Join(dir, "env.wav")
	// 2s sine with an explicit amplitude envelope: 1.0 for t<1, then 0.25.
	expr := "aevalsrc=exprs=if(lt(t\\,1)\\,1.0\\,0.25)*sin(2*PI*440*t):sample_rate=16000:duration=2"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", expr,
		"-ac", "1", "-ar", "16000",
		out,
	)
	if combined, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg envelope gen failed: %v\n%s", err, combined)
	}
	peaks := extractPeaks(t, out)
	if len(peaks) < 95 {
		t.Fatalf("expected ~100 peaks for 2s @50pps, got %d", len(peaks))
	}
	loud := mean(peaks[5:45])   // first second
	quiet := mean(peaks[55:95]) // second second
	if loud < 0.9 {
		t.Fatalf("loud segment mean %.3f, want >0.9", loud)
	}
	if quiet < 0.2 || quiet > 0.3 {
		t.Fatalf("quiet segment mean %.3f, want ~0.25", quiet)
	}
	if loud <= quiet {
		t.Fatalf("envelope not tracked: loud %.3f <= quiet %.3f", loud, quiet)
	}
}

// TestWaveform_RealSilence confirms a real silent source decodes to all-zero peaks.
func TestWaveform_RealSilence(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	out := filepath.Join(dir, "silence.wav")
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
		"-t", "1", out,
	)
	if combined, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg silence gen failed: %v\n%s", err, combined)
	}
	peaks := extractPeaks(t, out)
	if len(peaks) == 0 {
		t.Fatal("expected peaks for silent source")
	}
	for i, p := range peaks {
		if p != 0 {
			t.Fatalf("silent source peak[%d] = %g, want 0", i, p)
		}
	}
}

// TestWaveform_FullPipeline_RealSpeech runs the entire ProcessTask pipeline
// (storage → ffmpeg → peaks → cache JSON) against the committed speech clip and
// validates the persisted waveform document.
func TestWaveform_FullPipeline_RealSpeech(t *testing.T) {
	ffmpegAvailable(t)
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)

	data := testsupport.FixtureBytes(t, "audio/speech_hello.wav")
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "speech.wav", MimeType: "audio/wav", OwnerID: &ownerID, Size: int64(len(data))}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	if err := store.StoreFile(libID.String(), f.ID.String(), data); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	h := NewTaskHandler(db, store, testConfig(), nil)
	if err := h.run(context.Background(), libID.String(), f.ID.String()); err != nil {
		t.Fatalf("run: %v", err)
	}

	var updated models.File
	if err := db.Where("id = ?", f.ID).First(&updated).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if updated.WaveformStatus == nil || *updated.WaveformStatus != "ready" {
		t.Fatalf("waveform status = %v, want ready", updated.WaveformStatus)
	}

	raw, err := store.ReadCacheBuffer(libID.String() + "/" + f.ID.String() + "/waveform.json")
	if err != nil {
		t.Fatalf("read waveform cache: %v", err)
	}
	var wf struct {
		Peaks          []float64 `json:"peaks"`
		PeaksPerSecond int       `json:"peaksPerSecond"`
		SampleRate     int       `json:"sampleRate"`
	}
	if err := json.Unmarshal(raw, &wf); err != nil {
		t.Fatalf("unmarshal waveform: %v", err)
	}
	if wf.PeaksPerSecond != defaultPeaksPerSecond || wf.SampleRate != sampleRateHz {
		t.Fatalf("waveform meta: pps=%d sr=%d", wf.PeaksPerSecond, wf.SampleRate)
	}
	// ~3.56s of speech at 50 peaks/s ≈ 178 peaks. Allow generous slack.
	if len(wf.Peaks) < 120 || len(wf.Peaks) > 220 {
		t.Fatalf("peak count %d outside expected speech range", len(wf.Peaks))
	}
	var maxP float64
	for _, p := range wf.Peaks {
		if p < 0 || p > 1.0 {
			t.Fatalf("peak %g outside [0,1]", p)
		}
		if p > maxP {
			maxP = p
		}
	}
	if maxP < 0.05 {
		t.Fatalf("real speech produced near-silent waveform (max peak %.4f)", maxP)
	}
}
