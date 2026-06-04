package transcribe

import (
	"context"
	"strings"
	"testing"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// Real whisper.cpp transcription against a committed spoken clip. Runs the full
// ProcessTask pipeline (storage → ffmpeg → whisper-cli → VTT/text → DB) using
// the real whisper.cpp binary and the `tiny` GGML model (downloaded on first
// use). Asserts the produced transcript contains the words actually spoken in
// the clip ("Hello world. The quick brown fox jumps over the lazy dog.").
//
// Skips cleanly when ffmpeg, whisper-cli, the DB, or the model weights are
// unavailable, so it runs wherever the stack is present and is a no-op
// elsewhere.

// looksLikeInfra reports whether a run error is an environment/availability
// problem (model download, missing binary, network) that should skip rather
// than fail the test.
func looksLikeInfra(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	for _, frag := range []string{
		"download", "ensure", "no such file", "connection", "timeout",
		"executable file not found", "model", "dial tcp", "eof",
	} {
		if strings.Contains(s, frag) {
			return true
		}
	}
	return false
}

func TestRealTranscription_SpeechFixture(t *testing.T) {
	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	whisper := testsupport.WhisperCliBin()
	if whisper == "" {
		t.Skip("whisper-cli not available")
	}

	db := workerDB(t)
	store, _ := localStorage(t)
	libID, fileID := seedFile(t, db, "audio/wav")

	data := testsupport.FixtureBytes(t, "audio/speech_hello.wav")
	if err := store.StoreFile(libID.String(), fileID.String(), data); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	cfg := &config.Config{
		FFmpegBinaryPath:    ff,
		WhisperBinaryPath:   whisper,
		WhisperModel:        "tiny", // small + fast; default is the 3GB large-v3
		WhisperLanguage:     "en",
		WhisperModelsDir:    testsupport.WhisperCacheDir(),
		WhisperModelBaseURL: "https://s3.rustyguts.net/models",
		WhisperVADModel:     "silero-v6.2.0",
	}
	h := NewTaskHandler(db, store, cfg, nil, nil)

	if err := h.run(context.Background(), libID.String(), fileID.String()); err != nil {
		if looksLikeInfra(err) {
			t.Skipf("transcription unavailable (model/binary/network): %v", err)
		}
		t.Fatalf("transcribe run: %v", err)
	}

	var f models.File
	if err := db.Where("id = ?", fileID).First(&f).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "ready" {
		errMsg := ""
		if f.TranscribeError != nil {
			errMsg = *f.TranscribeError
		}
		t.Fatalf("transcribe status = %v (error: %q)", f.TranscribeStatus, errMsg)
	}
	if f.TranscriptText == nil {
		t.Fatal("transcript text is nil")
	}

	text := strings.ToLower(*f.TranscriptText)
	expected := []string{"hello", "world", "quick", "brown", "fox", "lazy", "dog"}
	hits := 0
	for _, w := range expected {
		if strings.Contains(text, w) {
			hits++
		}
	}
	if hits < 4 {
		t.Fatalf("transcript %q matched only %d/%d expected words", *f.TranscriptText, hits, len(expected))
	}
	t.Logf("transcript (%d/%d words matched): %q", hits, len(expected), strings.TrimSpace(*f.TranscriptText))

	if f.TranscriptVTT == nil || strings.TrimSpace(*f.TranscriptVTT) == "" {
		t.Fatal("expected non-empty WebVTT")
	}
	if !strings.Contains(*f.TranscriptVTT, "-->") {
		t.Fatalf("VTT missing cue timing markers: %q", *f.TranscriptVTT)
	}
	if f.TranscriptModel == nil || *f.TranscriptModel != "tiny" {
		t.Fatalf("transcript_model = %v, want tiny", f.TranscriptModel)
	}
}
