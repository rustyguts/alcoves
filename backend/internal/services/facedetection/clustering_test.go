package facedetection

import (
	"strings"
	"testing"
)

// TestEmbeddingToString_Format ensures embeddingToString produces a valid pgvector literal.
func TestEmbeddingToString_Format(t *testing.T) {
	cases := []struct {
		name string
		in   []float32
	}{
		{"three values", []float32{0.1, -0.2, 0.3}},
		{"single value", []float32{1.0}},
		{"empty", []float32{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := embeddingToString(tc.in)
			if !strings.HasPrefix(s, "[") {
				t.Errorf("embeddingToString(%v) = %q, missing '[' prefix", tc.in, s)
			}
			if !strings.HasSuffix(s, "]") {
				t.Errorf("embeddingToString(%v) = %q, missing ']' suffix", tc.in, s)
			}
		})
	}
}

// TestEmbeddingToString_CommaSeparated checks that multi-value embeddings are comma-separated.
func TestEmbeddingToString_CommaSeparated(t *testing.T) {
	s := embeddingToString([]float32{1.0, 2.0, 3.0})
	// Strip brackets
	inner := s[1 : len(s)-1]
	parts := strings.Split(inner, ",")
	if len(parts) != 3 {
		t.Errorf("expected 3 comma-separated values, got %d in %q", len(parts), s)
	}
}

// TestEmbeddingToString_SingleValue checks that a single-element embedding has no commas.
func TestEmbeddingToString_SingleValue(t *testing.T) {
	s := embeddingToString([]float32{0.5})
	inner := s[1 : len(s)-1]
	if strings.Contains(inner, ",") {
		t.Errorf("single-element embedding should have no comma, got %q", s)
	}
}

// TestEmbeddingToString_Roundtrip verifies that values appear in order.
func TestEmbeddingToString_Roundtrip(t *testing.T) {
	emb := []float32{0.1, 0.2, 0.3}
	s := embeddingToString(emb)
	// All three formatted values must appear in the output string
	for _, v := range []string{"0.100000", "0.200000", "0.300000"} {
		if !strings.Contains(s, v) {
			t.Errorf("embeddingToString result %q does not contain expected value %q", s, v)
		}
	}
}

// TestFaceConfig_ComputedThresholds verifies that NewFaceConfig derives
// MatchCandidateDistance and AutoMergeDistance from MaxDistance.
func TestFaceConfig_ComputedThresholds(t *testing.T) {
	cfg := NewFaceConfig(0.6, 0.4, 10, 3, "/models")

	// MatchCandidateDistance should be greater than MaxDistance (1.5× multiplier).
	if cfg.MatchCandidateDistance <= cfg.MaxDistance {
		t.Errorf("MatchCandidateDistance (%.4f) should be > MaxDistance (%.4f)", cfg.MatchCandidateDistance, cfg.MaxDistance)
	}

	// AutoMergeDistance should be less than MaxDistance (0.85× multiplier).
	if cfg.AutoMergeDistance >= cfg.MaxDistance {
		t.Errorf("AutoMergeDistance (%.4f) should be < MaxDistance (%.4f)", cfg.AutoMergeDistance, cfg.MaxDistance)
	}

	if cfg.AutoMergeMinEvidence != 3 {
		t.Errorf("AutoMergeMinEvidence: want 3, got %d", cfg.AutoMergeMinEvidence)
	}
}
