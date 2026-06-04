package audiodetection

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
	"github.com/alcoves/alcoves-backend/internal/testsupport/onnxtest"
)

// Real AudioSet tagger inference against a committed speech clip and
// ffmpeg-generated audio. Loads the actual ONNX model (downloading it on first
// use), extracts PCM with ffmpeg, runs the streaming window inference, and
// asserts both a semantic result (speech is tagged "Speech") and structural
// invariants (527 classes, probabilities in range). Skips cleanly when ffmpeg,
// the ONNX Runtime, or the model weights are unavailable.

const (
	mirrorBaseURL = "https://s3.rustyguts.net/models"
	labelsURL     = mirrorBaseURL + "/audioset_class_labels_indices.csv"
)

func init() { onnxtest.SetupLib() }

func loadAudioOrSkip(t *testing.T) (*sessionInfo, []string, int) {
	t.Helper()
	if testsupport.FfmpegBin() == "" {
		t.Skip("ffmpeg not available")
	}
	spec, _ := LookupSpec(DefaultModelID)
	modelsDir := testsupport.ModelsCacheDir()
	modelPath, labelsPath, err := EnsureAssets(modelsDir, spec.ModelFile, mirrorBaseURL+"/"+spec.ModelFile, labelsURL)
	if err != nil {
		t.Skipf("audio model/labels unavailable: %v", err)
	}
	labels, err := LoadLabels(labelsPath)
	if err != nil {
		t.Skipf("audio labels unavailable: %v", err)
	}
	sess, err := getSession(modelPath, spec.SampleRate)
	if err != nil {
		t.Skipf("audio ONNX session/runtime unavailable: %v", err)
	}
	return sess, labels, spec.SampleRate
}

// inferMaxProbs extracts PCM from a media file and returns the per-class maximum
// probability across all 10s windows (mirroring the worker's window loop).
func inferMaxProbs(t *testing.T, sess *sessionInfo, sr int, src string) []float32 {
	t.Helper()
	pcm := filepath.Join(t.TempDir(), "audio.f32le")
	if err := extractAudio(context.Background(), testsupport.FfmpegBin(), src, pcm, sr); err != nil {
		t.Fatalf("extractAudio: %v", err)
	}
	raw, err := os.ReadFile(pcm)
	if err != nil {
		t.Fatalf("read pcm: %v", err)
	}
	windowLen := 10 * sr
	window := make([]float32, windowLen)
	var agg []float32
	for off := 0; off < len(raw); off += windowLen * 4 {
		end := min(off+windowLen*4, len(raw))
		decodePCMBytes(raw[off:end], window)
		probs, err := runInference(sess, window)
		if err != nil {
			t.Fatalf("runInference: %v", err)
		}
		if agg == nil {
			agg = make([]float32, len(probs))
		}
		for i, p := range probs {
			if p > agg[i] {
				agg[i] = p
			}
		}
	}
	if agg == nil {
		t.Fatal("no audio windows produced")
	}
	return agg
}

func labelIndex(labels []string, name string) int {
	for i, l := range labels {
		if l == name {
			return i
		}
	}
	return -1
}

// TestRealAudioLabels_Loaded confirms the real AudioSet CSV parses to 527
// classes including the ones the highlight engine relies on.
func TestRealAudioLabels_Loaded(t *testing.T) {
	_, labels, _ := loadAudioOrSkip(t)
	if len(labels) != 527 {
		t.Fatalf("AudioSet labels = %d, want 527", len(labels))
	}
	for _, want := range []string{"Speech", "Music", "Laughter"} {
		if labelIndex(labels, want) < 0 {
			t.Fatalf("expected AudioSet class %q to be present", want)
		}
	}
}

// TestRealAudioDetection_SpeechFixture confirms real speech audio is tagged
// "Speech" with a meaningful score.
func TestRealAudioDetection_SpeechFixture(t *testing.T) {
	sess, labels, sr := loadAudioOrSkip(t)
	probs := inferMaxProbs(t, sess, sr, testsupport.Fixture(t, "audio/speech_hello.wav"))

	idx := labelIndex(labels, "Speech")
	if idx < 0 {
		t.Fatal("no Speech class in labels")
	}
	if probs[idx] < 0.3 {
		t.Fatalf("speech clip scored Speech=%.3f, want >=0.3", probs[idx])
	}
	t.Logf("speech clip Speech score = %.3f", probs[idx])
}

// TestRealAudioInference_OutputShapeAndRange validates the raw model output
// shape and probability range on a real window.
func TestRealAudioInference_OutputShapeAndRange(t *testing.T) {
	sess, labels, sr := loadAudioOrSkip(t)
	probs := inferMaxProbs(t, sess, sr, testsupport.Fixture(t, "audio/speech_hello.wav"))
	if len(probs) != len(labels) {
		t.Fatalf("model output length %d != labels %d", len(probs), len(labels))
	}
	for i, p := range probs {
		if p < 0 || p > 1.0001 {
			t.Fatalf("probability[%d] = %.4f outside [0,1]", i, p)
		}
	}
}

// localAudioStorage builds a temp-dir-backed storage service.
func localAudioStorage(t *testing.T) *storage.Service {
	t.Helper()
	root := t.TempDir()
	st := storage.NewService(storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	))
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	return st
}

// TestRealAudioDetect_WorkerEndToEnd runs the full ProcessTask pipeline
// (storage → ffmpeg → ONNX windows → DB) on the speech clip and asserts the
// persisted detections include "Speech" and the file is marked ready.
func TestRealAudioDetect_WorkerEndToEnd(t *testing.T) {
	if testsupport.FfmpegBin() == "" {
		t.Skip("ffmpeg not available")
	}
	db := audioTestDB(t)
	st := localAudioStorage(t)
	libID, fileID := seedAudioFile(t, db, "audio/wav")

	data := testsupport.FixtureBytes(t, "audio/speech_hello.wav")
	if err := st.StoreFile(libID.String(), fileID.String(), data); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	cfg := &config.Config{
		ModelsPath:              testsupport.ModelsCacheDir(),
		FFmpegBinaryPath:        testsupport.FfmpegBin(),
		AudioDetectModelBaseURL: mirrorBaseURL,
		AudioDetectLabelsURL:    labelsURL,
		AudioDetectWindowSec:    10,
		AudioDetectThreshold:    0.2,
		AudioDetectTopK:         5,
	}
	h := NewTaskHandler(db, st, cfg, nil)

	// Pre-flight the model so a download/runtime failure skips rather than fails.
	spec, _ := LookupSpec(DefaultModelID)
	if mp, _, err := EnsureAssets(cfg.ModelsPath, spec.ModelFile, mirrorBaseURL+"/"+spec.ModelFile, labelsURL); err != nil {
		t.Skipf("audio model unavailable: %v", err)
	} else if _, err := getSession(mp, spec.SampleRate); err != nil {
		t.Skipf("audio ONNX runtime unavailable: %v", err)
	}

	if err := h.run(context.Background(), libID.String(), fileID.String()); err != nil {
		t.Fatalf("run: %v", err)
	}

	var f models.File
	if err := db.Where("id = ?", fileID).First(&f).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if f.AudioDetectStatus == nil || *f.AudioDetectStatus != "ready" {
		t.Fatalf("audio_detect_status = %v, want ready", f.AudioDetectStatus)
	}
	if f.AudioDetectModel == nil || *f.AudioDetectModel != DefaultModelID {
		t.Fatalf("audio_detect_model = %v, want %s", f.AudioDetectModel, DefaultModelID)
	}

	var dets []models.AudioDetection
	if err := db.Where("file_id = ?", fileID).Find(&dets).Error; err != nil {
		t.Fatalf("query detections: %v", err)
	}
	if len(dets) == 0 {
		t.Fatal("expected at least one audio detection")
	}
	foundSpeech := false
	for _, d := range dets {
		if d.Score < 0 || d.Score > 1.0001 {
			t.Fatalf("detection score %.4f outside [0,1]", d.Score)
		}
		if d.EndSeconds < d.StartSeconds {
			t.Fatalf("detection end %.2f < start %.2f", d.EndSeconds, d.StartSeconds)
		}
		if d.Label == "Speech" {
			foundSpeech = true
		}
	}
	if !foundSpeech {
		t.Fatalf("expected a 'Speech' detection; got %d detections without it", len(dets))
	}
	t.Logf("persisted %d detections incl. Speech", len(dets))
}
