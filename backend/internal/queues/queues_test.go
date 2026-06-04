package queues

import "testing"

// allQueues is every named queue this package defines. Keeping it explicit (vs
// ranging over Priorities) lets the tests assert the map and the constant set
// stay in lockstep — a new constant without a weight, or a stray weight without
// a constant, both fail.
var allQueues = []string{
	ImageProxy,
	Metadata,
	Thumbnail,
	Hash,
	Default,
	MomentExport,
	Waveform,
	ObjectDetection,
	FaceDetection,
	AudioDetection,
	VideoTranscode,
	Transcription,
	Maintenance,
}

// TestEveryQueueHasAWeight guards against adding a queue constant but forgetting
// to give it a weight in Priorities — an unweighted queue would not be polled by
// the worker at all, silently stranding its tasks.
func TestEveryQueueHasAWeight(t *testing.T) {
	for _, q := range allQueues {
		if _, ok := Priorities[q]; !ok {
			t.Errorf("queue %q has no weight in Priorities", q)
		}
	}
	if len(Priorities) != len(allQueues) {
		t.Errorf("Priorities has %d entries but %d queues are defined; a weight exists without a matching constant", len(Priorities), len(allQueues))
	}
}

// TestNoDuplicateQueueNames ensures two constants never resolve to the same
// on-the-wire name, which would silently merge two job classes into one queue.
func TestNoDuplicateQueueNames(t *testing.T) {
	seen := map[string]bool{}
	for _, q := range allQueues {
		if seen[q] {
			t.Errorf("duplicate queue name %q", q)
		}
		seen[q] = true
	}
}

// TestWeightsArePositive — asynq treats a non-positive weight as "never poll",
// so every real queue must be >= 1.
func TestWeightsArePositive(t *testing.T) {
	for q, w := range Priorities {
		if w < 1 {
			t.Errorf("queue %q has non-positive weight %d", q, w)
		}
	}
}

// TestRankingLadder pins the documented priority ordering. These are the
// product invariants — if a future change reweights a queue in a way that
// violates the ladder (e.g. makes whisper outrank thumbnailing), this fails.
func TestRankingLadder(t *testing.T) {
	// The full high → low ladder. Each entry must be strictly heavier than the
	// next, except the ML-detection trio which is allowed to tie.
	ladder := []struct {
		name      string
		queue     string
		mayTieNxt bool
	}{
		{"imageproxy", ImageProxy, false},
		{"metadata", Metadata, false},
		{"thumbnail", Thumbnail, false},
		{"hash", Hash, false},
		{"default", Default, false},
		{"moment-export", MomentExport, false},
		{"waveform", Waveform, false},
		{"object-detection", ObjectDetection, true}, // may tie face-detection
		{"face-detection", FaceDetection, false},
		{"audio-detection", AudioDetection, false},
		{"video-transcode", VideoTranscode, false},
		{"transcription", Transcription, false},
		{"maintenance", Maintenance, false},
	}

	for i := 0; i+1 < len(ladder); i++ {
		hi, lo := ladder[i], ladder[i+1]
		wHi, wLo := Priorities[hi.queue], Priorities[lo.queue]
		if hi.mayTieNxt {
			if wHi < wLo {
				t.Errorf("%s (%d) must be >= %s (%d)", hi.name, wHi, lo.name, wLo)
			}
		} else if wHi <= wLo {
			t.Errorf("%s (%d) must outrank %s (%d)", hi.name, wHi, lo.name, wLo)
		}
	}
}

// TestUserMandatedConstraints encodes the explicit asks from the feature
// request: whisper transcription and heavy video transcode are demoted below
// fast thumbnailing, and whisper — the longest-running class — sits at or below
// video transcode.
func TestUserMandatedConstraints(t *testing.T) {
	if Priorities[Transcription] >= Priorities[Thumbnail] {
		t.Errorf("transcription (%d) must be lower priority than thumbnail (%d)", Priorities[Transcription], Priorities[Thumbnail])
	}
	if Priorities[VideoTranscode] >= Priorities[Thumbnail] {
		t.Errorf("video-transcode (%d) must be lower priority than thumbnail (%d)", Priorities[VideoTranscode], Priorities[Thumbnail])
	}
	if Priorities[Transcription] > Priorities[VideoTranscode] {
		t.Errorf("whisper transcription (%d) is the heaviest job class and must not outrank video-transcode (%d)", Priorities[Transcription], Priorities[VideoTranscode])
	}
	// Interactive transforms always win; pure maintenance always loses.
	for _, q := range allQueues {
		if q != ImageProxy && Priorities[ImageProxy] <= Priorities[q] {
			t.Errorf("imageproxy must be the highest-priority queue, but %q (%d) >= imageproxy (%d)", q, Priorities[q], Priorities[ImageProxy])
		}
		if q != Maintenance && Priorities[Maintenance] >= Priorities[q] {
			t.Errorf("maintenance must be the lowest-priority queue, but %q (%d) <= maintenance (%d)", q, Priorities[q], Priorities[Maintenance])
		}
	}
}
