package audiodetection

import (
	"sort"
)

// ModelSpec describes one selectable audio-tagging model in the admin
// dashboard. Every model in the registry shares the AudioSet 527-class
// label space (audioset_class_labels_indices.csv on the model bucket), so
// switching between them does not invalidate downstream HighlightFilter
// expressions written against label names.
//
// Models that consume raw waveform input (PANNs CNN14) take 32 kHz float32
// PCM. Models that consume log-mel features (EfficientAT, CED) MUST be
// exported with their mel-spectrogram transform baked into the ONNX graph
// so the worker can keep feeding raw PCM — see scripts/export-audio-tagger.py.
type ModelSpec struct {
	ID         string  // settings.AudioDetectModel value; stable identifier.
	Label      string  // human-friendly name for the admin UI.
	ModelFile  string  // filename in $ALCOVES_MODELS_PATH and on the S3 bucket.
	SampleRate int     // ffmpeg target sample rate; 16000 or 32000.
	DiskMB     int     // approximate disk size for admin RAM/disk callout.
	RAMPeakMB  int     // approximate peak RSS during inference.
	MAP        float64 // AudioSet AS-2M mAP for the option callout.
	License    string  // SPDX-ish — Apache-2.0 / MIT etc.
	Notes      string  // 1-line subtitle for the admin UI.
}

// DefaultModelID is the registry entry selected on fresh installs. This
// also serves as the worker fallback when settings.AudioDetectModel is
// empty (e.g. tests, boot before settings reload). Keep in sync with
// settings.defaults() and docs/models.md §2.
const DefaultModelID = "efficientat_mn10"

// LegacyModelID is the previous default (PANNs CNN14). The worker uses
// this to render audio_detect_model when the registry lookup fails — for
// debugging only; the admin handler rejects unknown IDs up front.
const LegacyModelID = "pann_cnn14"

// Registry is the authoritative list of selectable audio-tagging models.
// Add new entries here AND in docs/models.md AND upload the ONNX artifact
// to s3.rustyguts.net/models/ via scripts/export-audio-tagger.py.
var Registry = map[string]ModelSpec{
	"pann_cnn14": {
		ID:         "pann_cnn14",
		Label:      "PANNs CNN14 (legacy)",
		ModelFile:  "panns_cnn14.onnx",
		SampleRate: 32000,
		DiskMB:     313,
		RAMPeakMB:  600,
		MAP:        0.431,
		License:    "Apache-2.0",
		Notes:      "Original baseline. Raw waveform input, no mel preprocessing.",
	},
	"efficientat_mn04": {
		ID:         "efficientat_mn04",
		Label:      "EfficientAT mn04_as (tiny)",
		ModelFile:  "efficientat_mn04_as.onnx",
		SampleRate: 32000,
		DiskMB:     5,
		RAMPeakMB:  60,
		MAP:        0.432,
		License:    "MIT",
		Notes:      "Same mAP as CNN14 at ~80× smaller. Best for ultra-constrained pods.",
	},
	"efficientat_mn10": {
		ID:         "efficientat_mn10",
		Label:      "EfficientAT mn10_as (recommended)",
		ModelFile:  "efficientat_mn10_as.onnx",
		SampleRate: 32000,
		DiskMB:     20,
		RAMPeakMB:  120,
		MAP:        0.471,
		License:    "MIT",
		Notes:      "Default. ~16× smaller than CNN14, +9% mAP, faster on CPU.",
	},
	"efficientat_mn40": {
		ID:         "efficientat_mn40",
		Label:      "EfficientAT mn40_as_ext",
		ModelFile:  "efficientat_mn40_as_ext.onnx",
		SampleRate: 32000,
		DiskMB:     280,
		RAMPeakMB:  500,
		MAP:        0.487,
		License:    "MIT",
		Notes:      "Same disk class as CNN14, +5.6 mAP. Slower CPU inference.",
	},
	"ced_tiny": {
		ID:         "ced_tiny",
		Label:      "CED-Tiny",
		ModelFile:  "ced_tiny.onnx",
		SampleRate: 16000,
		DiskMB:     22,
		RAMPeakMB:  120,
		MAP:        0.481,
		License:    "Apache-2.0",
		Notes:      "Transformer; CPU parity with MobileNetV3 per authors.",
	},
	"ced_small": {
		ID:         "ced_small",
		Label:      "CED-Small",
		ModelFile:  "ced_small.onnx",
		SampleRate: 16000,
		DiskMB:     85,
		RAMPeakMB:  280,
		MAP:        0.496,
		License:    "Apache-2.0",
		Notes:      "Best mid-range quality.",
	},
	"ced_base": {
		ID:         "ced_base",
		Label:      "CED-Base (premium)",
		ModelFile:  "ced_base.onnx",
		SampleRate: 16000,
		DiskMB:     330,
		RAMPeakMB:  600,
		MAP:        0.500,
		License:    "Apache-2.0",
		Notes:      "SOTA-class quality, same disk class as PANN CNN14.",
	},
}

// LookupSpec returns the ModelSpec for an ID, or the default spec when id
// is empty or unknown. The bool reports whether the lookup hit the registry.
func LookupSpec(id string) (ModelSpec, bool) {
	if id == "" {
		return Registry[DefaultModelID], false
	}
	spec, ok := Registry[id]
	if !ok {
		return Registry[DefaultModelID], false
	}
	return spec, true
}

// IsValidModelID reports whether id is a known registry entry.
func IsValidModelID(id string) bool {
	_, ok := Registry[id]
	return ok
}

// ModelList returns registry entries sorted by ID for deterministic admin
// API responses + test fixtures.
func ModelList() []ModelSpec {
	out := make([]ModelSpec, 0, len(Registry))
	for _, m := range Registry {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
