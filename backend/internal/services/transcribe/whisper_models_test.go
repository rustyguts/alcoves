package transcribe

import "testing"

func TestIsValidWhisperModel_AllowsKnownIDs(t *testing.T) {
	for _, id := range []string{"tiny", "base", "small", "medium", "large-v3", "large-v3-q5_0", "large-v3-turbo-q5_0", "large-v3-turbo-q4_0", "distil-large-v3.5-q5"} {
		if !IsValidWhisperModel(id) {
			t.Errorf("IsValidWhisperModel(%q) = false, want true", id)
		}
	}
}

func TestIsValidWhisperModel_RejectsUnknownAndCaseMismatches(t *testing.T) {
	for _, id := range []string{"", "Medium", "MEDIUM", "tiny.en", "medium.en", "large", "large-v2", "small.bin", "ggml-medium"} {
		if IsValidWhisperModel(id) {
			t.Errorf("IsValidWhisperModel(%q) = true, want false", id)
		}
	}
}

func TestIsValidWhisperLanguage_AllowsAutoAndCommonCodes(t *testing.T) {
	for _, lang := range []string{"auto", "en", "fr", "de", "es", "ja", "zh"} {
		if !IsValidWhisperLanguage(lang) {
			t.Errorf("IsValidWhisperLanguage(%q) = false, want true", lang)
		}
	}
}

func TestIsValidWhisperLanguage_RejectsUnknown(t *testing.T) {
	for _, lang := range []string{"", "EN", "english", "xx", "en-US", "auto-detect"} {
		if IsValidWhisperLanguage(lang) {
			t.Errorf("IsValidWhisperLanguage(%q) = true, want false", lang)
		}
	}
}

func TestWhisperModels_NoDuplicateIDs(t *testing.T) {
	seen := map[string]bool{}
	for _, m := range WhisperModels {
		if seen[m.ID] {
			t.Errorf("duplicate WhisperModels entry: %q", m.ID)
		}
		seen[m.ID] = true
	}
}

func TestWhisperModels_DefaultLargeV3Present(t *testing.T) {
	// The settings default seeds "large-v3". The allow-list must include it
	// or every fresh install would 400 on the admin's first model save.
	if !IsValidWhisperModel("large-v3") {
		t.Fatal("large-v3 must be in WhisperModels — settings.defaults() seeds it")
	}
}
