// Package queues is the single source of truth for the named Asynq queues used
// across Alcoves. Each logical class of background work routes to its own queue
// so that latency-sensitive work (interactive image transforms) is never stuck
// behind heavy batch work (ML inference, video transcode) or low-priority
// maintenance (cache pre-warming).
//
// To add a queue: add a constant here, give it a weight in Priorities, and
// register its handler(s) in cmd/server/main.go. The worker's asynq.Config
// reads Priorities directly so a new queue is picked up in one place.
package queues

// Named queues. The string values are the on-the-wire queue names stored in
// Redis; do not rename them without a migration plan for in-flight tasks.
const (
	// Default carries general async work: hashing, metadata/EXIF, waveforms,
	// face/object detection, audio detection, transcription, video transcode,
	// and moment export.
	Default = "default"

	// ImageProxy carries interactive, on-demand image transforms. A user is
	// usually blocked on these (a thumbnail is rendering), so it gets the
	// highest weight.
	ImageProxy = "imageproxy"

	// Maintenance carries low-priority background upkeep that no user is
	// waiting on — currently the hourly image-proxy variant pre-warm. Lowest
	// weight so a large backfill batch can never starve interactive transforms
	// or the default queue.
	Maintenance = "maintenance"
)

// Priorities is the asynq queue-weight map consumed by the worker in
// cmd/server/main.go. Higher weight = a larger share of worker attention.
// ImageProxy ≫ Default ≫ Maintenance encodes "users first, batch second,
// upkeep last".
var Priorities = map[string]int{
	ImageProxy:  10,
	Default:     3,
	Maintenance: 1,
}
