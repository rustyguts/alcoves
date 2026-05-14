package transcribe

// WhisperModelSpec describes one selectable whisper.cpp GGML build. Used
// by the admin allow-list and (indirectly) by the admin UI catalog.
//
// Filename in the model bucket and on disk follows the whisper.cpp
// convention: "ggml-<ID>.bin". Keep this list in sync with docs/models.md
// §1 and the artifacts uploaded by scripts/upload-whisper-models.sh.
type WhisperModelSpec struct {
	ID        string  // e.g. "medium", "large-v3-turbo-q5_0".
	Label     string  // human-friendly name for the admin UI.
	DiskMB    int     // approximate file size on disk.
	RAMPeakMB int     // approximate peak RSS during inference (whisper.cpp README).
	WERClean  float64 // LibriSpeech test-clean WER (%) for the option callout.
	WEROther  float64 // LibriSpeech test-other WER (%).
	Realtime  float64 // typical CPU-only x-realtime factor.
	English   bool    // true for English-only variants (distil-large-v3.5).
	Notes     string  // 1-line subtitle for the admin UI.
}

// WhisperModels is the authoritative allow-list. Order is preserved for the
// admin UI: tiny → fastest, large-v3 → slowest/most accurate, quants below.
var WhisperModels = []WhisperModelSpec{
	{ID: "tiny", Label: "tiny", DiskMB: 75, RAMPeakMB: 390, WERClean: 7.5, WEROther: 16.0, Realtime: 50, Notes: "Fastest, weak accuracy."},
	{ID: "base", Label: "base", DiskMB: 142, RAMPeakMB: 500, WERClean: 5.0, WEROther: 12.0, Realtime: 32, Notes: "Fast fallback for low-RAM hosts."},
	{ID: "small", Label: "small", DiskMB: 466, RAMPeakMB: 1000, WERClean: 3.4, WEROther: 7.6, Realtime: 16, Notes: "Mid-tier."},
	{ID: "medium", Label: "medium", DiskMB: 1500, RAMPeakMB: 2500, WERClean: 3.0, WEROther: 6.0, Realtime: 6, Notes: "Strong accuracy within homelab memory limits."},
	{ID: "large-v3", Label: "large-v3 (default)", DiskMB: 3100, RAMPeakMB: 3900, WERClean: 2.7, WEROther: 5.2, Realtime: 1, Notes: "Best WER; ≥4 GB RAM recommended."},
	{ID: "large-v3-q5_0", Label: "large-v3 q5_0", DiskMB: 1080, RAMPeakMB: 1300, WERClean: 2.9, WEROther: 5.4, Realtime: 3, Notes: "Quantized; reasonable accuracy/size tradeoff."},
	{ID: "large-v3-turbo-q5_0", Label: "large-v3-turbo q5_0", DiskMB: 574, RAMPeakMB: 900, WERClean: 3.0, WEROther: 5.5, Realtime: 10, Notes: "8× faster than v3, near-v3 WER. Capable CPU/GPU."},
	{ID: "large-v3-turbo-q4_0", Label: "large-v3-turbo q4_0", DiskMB: 470, RAMPeakMB: 800, WERClean: 3.2, WEROther: 5.8, Realtime: 12, Notes: "Smallest near-SOTA option."},
	{ID: "distil-large-v3.5-q5", Label: "distil-large-v3.5 q5 (EN)", DiskMB: 600, RAMPeakMB: 1000, WERClean: 3.0, WEROther: 5.6, Realtime: 15, English: true, Notes: "English-only; faster than turbo."},
}

// IsValidWhisperModel reports whether id is in the allow-list.
func IsValidWhisperModel(id string) bool {
	for _, m := range WhisperModels {
		if m.ID == id {
			return true
		}
	}
	return false
}

// WhisperLanguages is the allow-list for the language selector. "auto"
// instructs whisper.cpp to detect; the others are ISO-639-1 codes covering
// the languages we have confidence whisper.cpp handles well at the current
// default model sizes. Power users can override via env var.
var WhisperLanguages = []string{
	"auto", "en", "fr", "de", "es", "it", "pt", "nl", "ja", "zh", "ko", "ru",
}

// IsValidWhisperLanguage reports whether lang is in the allow-list.
func IsValidWhisperLanguage(lang string) bool {
	for _, l := range WhisperLanguages {
		if l == lang {
			return true
		}
	}
	return false
}
