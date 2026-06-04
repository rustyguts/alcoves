// Package queues is the single source of truth for the named Asynq queues used
// across Alcoves. Each logical class of background work routes to its own queue
// so that latency-sensitive work (interactive image transforms) is never stuck
// behind heavy batch work (whisper transcription, video transcode) or
// low-priority maintenance (cache pre-warming).
//
// Ranking philosophy — weight ≈ importance ÷ complexity:
//
//   - importance: how much a user is actively blocked on the result. An
//     on-demand thumbnail (someone is staring at a spinner) outranks a
//     background ML enrichment that nobody asked for yet.
//   - complexity: how long/heavy the job is. A multi-minute whisper transcribe
//     or full video transcode must not hog the worker pool ahead of the dozens
//     of sub-second jobs queued behind it, so heavier work is demoted.
//
// The result is a clear ladder: interactive transforms first, then cheap
// post-upload derivations (metadata, thumbnails, hashes), then moderate media
// work, then CPU-bound ML inference, and finally the genuinely heavy
// long-runners (video transcode, whisper) just above pure background upkeep.
//
// To add a queue: add a constant here, give it a weight in Priorities, and
// register its handler(s) in cmd/server/main.go. The worker's asynq.Config
// reads Priorities directly so a new queue is picked up in one place. The admin
// jobs dashboard discovers queues at runtime via the Asynq inspector, so a new
// queue needs no dashboard changes.
package queues

// Named queues. The string values are the on-the-wire queue names stored in
// Redis; do not rename them without a migration plan for in-flight tasks.
const (
	// ImageProxy carries interactive, on-demand image transforms. A user is
	// usually blocked on these (a thumbnail is rendering), so it gets the
	// highest weight by a wide margin.
	ImageProxy = "imageproxy"

	// Metadata carries EXIF/GPS + ffprobe extraction. Cheap and fast, and it
	// unblocks core display surfaces (Timeline, Map, file details), so it sits
	// near the top.
	Metadata = "metadata"

	// Thumbnail carries video poster-frame extraction — a fast ffmpeg seek that
	// makes the library grid usable. The owner explicitly wants thumbnailing to
	// outrank the heavy long-runners below.
	Thumbnail = "thumbnail"

	// Hash carries SHA256 content hashing for dedup. Fast and important for
	// correctness, but no user is blocked on it, so it ranks just below the
	// display-critical derivations.
	Hash = "hash"

	// Default is retained ONLY as a drain target for tasks enqueued by an older
	// binary before this rollout, and as a fallback for any future enqueue that
	// forgets to name a queue. No current code routes new work here. Kept at a
	// middle weight so any transient backlog drains promptly without starving
	// interactive work.
	Default = "default"

	// MomentExport carries short user-initiated clip encodes. Someone clicked
	// "export" and is waiting, so it outranks background ML, but it's a real
	// ffmpeg encode so it sits below the cheap derivations.
	MomentExport = "moment-export"

	// Waveform carries audio waveform peak generation — a moderate ffmpeg PCM
	// pass feeding the editor/player UI.
	Waveform = "waveform"

	// ObjectDetection carries YOLO ONNX inference. CPU-bound background
	// enrichment for search; nobody is blocked on it in real time.
	ObjectDetection = "object-detection"

	// FaceDetection carries face ONNX inference + clustering. Same complexity
	// class as object detection; background enrichment.
	FaceDetection = "face-detection"

	// AudioDetection carries AudioSet ONNX inference. Runs over decoded audio
	// from (often long) video, so it's a touch heavier than the image-based
	// detectors and ranks just below them.
	AudioDetection = "audio-detection"

	// VideoTranscode carries full video proxy transcodes — heavy, multi-minute
	// ffmpeg work. Demoted near the bottom so a big import can't starve the
	// fast jobs queued behind it.
	VideoTranscode = "video-transcode"

	// Transcription carries whisper.cpp speech-to-text. The single heaviest,
	// longest-running job class (minutes for long media), so it sits at the
	// very bottom of the real-work ladder — above only pure maintenance.
	Transcription = "transcription"

	// Maintenance carries low-priority background upkeep that no user is waiting
	// on — currently the hourly image-proxy variant pre-warm. Lowest weight so a
	// large backfill batch can never starve anything above it.
	Maintenance = "maintenance"
)

// Priorities is the asynq queue-weight map consumed by the worker in
// cmd/server/main.go. Higher weight = a larger share of worker attention.
// Asynq samples non-strictly across NON-EMPTY queues in proportion to these
// weights, so a low-weight queue is never starved when it's the only one with
// work — it simply yields to higher-priority queues while they have a backlog.
//
// The ladder (high → low): interactive transforms ≫ fast derivations ≫
// moderate media ≫ ML inference ≫ heavy long-runners ≫ maintenance.
var Priorities = map[string]int{
	ImageProxy:      100,
	Metadata:        70,
	Thumbnail:       65,
	Hash:            60,
	Default:         50,
	MomentExport:    45,
	Waveform:        40,
	ObjectDetection: 30,
	FaceDetection:   30,
	AudioDetection:  25,
	VideoTranscode:  10,
	Transcription:   5,
	Maintenance:     1,
}
