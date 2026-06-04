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

	// Available reports whether ModelFile is actually mirrored to the model
	// bucket today. Entries that are catalogued but not yet uploaded stay in
	// the registry (Available:false) so the roadmap + metadata remain
	// documented, but IsValidModelID refuses to select them and LookupSpec
	// falls back to the default — otherwise the worker would 404 at download
	// time and fail every audio-detect job. Flip to true in the SAME change
	// that uploads the ONNX artifact (see docs/internal/publishing-models.md).
	Available bool
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

// Registry is the authoritative list of audio-tagging models. Add new
// entries here AND in docs/models.md. An entry is only *selectable* once its
// ONNX artifact is mirrored to s3.rustyguts.net/models/ (via
// scripts/export-audio-tagger.py) and Available is flipped to true — see the
// ModelSpec.Available doc.
//
// AVAILABILITY: only pann_cnn14 + efficientat_mn10 are currently published to
// the bucket. efficientat_mn04/mn40 and ced_tiny/small/base are catalogued but
// NOT yet uploaded, so they stay Available:false until someone runs the
// publish flow. Marking them Available without uploading reintroduces the
// "ced_base.onnx 404 fails every audio-detect job" bug.
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
		Available:  true,
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
		Available:  false, // not yet mirrored to the model bucket
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
		Available:  true,
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
		Available:  false, // not yet mirrored to the model bucket
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
		Available:  false, // not yet mirrored to the model bucket
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
		Available:  false, // not yet mirrored to the model bucket
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
		Available:  false, // not yet mirrored to the model bucket
	},
}

// LookupSpec returns the ModelSpec for an ID, or the default spec when id is
// empty, unknown, OR not Available. The bool reports whether the lookup
// resolved to a usable (published) model. An unavailable selection — e.g. a
// settings row pointing at a model that was catalogued but never uploaded —
// falls back to the default so the worker runs a model that actually exists
// on the bucket instead of 404ing at download time. DefaultModelID must stay
// Available (asserted in registry_test.go) for this fallback to be safe.
func LookupSpec(id string) (ModelSpec, bool) {
	if id == "" {
		return Registry[DefaultModelID], false
	}
	spec, ok := Registry[id]
	if !ok || !spec.Available {
		return Registry[DefaultModelID], false
	}
	return spec, true
}

// IsValidModelID reports whether id is a known AND currently-selectable
// (published) registry entry. The admin settings handler uses this to reject
// selecting a model whose ONNX artifact isn't on the bucket yet.
func IsValidModelID(id string) bool {
	spec, ok := Registry[id]
	return ok && spec.Available
}

// ModelList returns all registry entries sorted by ID for deterministic admin
// API responses + test fixtures, including catalogued-but-unpublished models
// (inspect ModelSpec.Available to tell them apart).
func ModelList() []ModelSpec {
	out := make([]ModelSpec, 0, len(Registry))
	for _, m := range Registry {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// AvailableModelList returns only the currently-selectable (published)
// registry entries, sorted by ID. This is the set an admin can actually pick
// without breaking audio detection.
func AvailableModelList() []ModelSpec {
	out := make([]ModelSpec, 0, len(Registry))
	for _, m := range Registry {
		if m.Available {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
