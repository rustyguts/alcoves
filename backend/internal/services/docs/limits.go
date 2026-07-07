package docs

// Size and paging limits for the live-document endpoints. Constants rather
// than env knobs: markdown-scale documents fit comfortably inside these, and
// a smaller config surface wins until a real deployment needs otherwise.
const (
	// MaxUpdateBytes caps a single decoded Yjs update (append/init).
	// Keystroke-scale updates are tens of bytes; large pastes are still far
	// below this.
	MaxUpdateBytes = 256 << 10 // 256 KiB

	// MaxSnapshotBytes caps a client-computed merged snapshot on compaction.
	MaxSnapshotBytes = 16 << 20 // 16 MiB

	// MaxTextBytes caps the materialized markdown text on compaction and the
	// blob read on the first-open seeding path.
	MaxTextBytes = 16 << 20 // 16 MiB

	// MaxAwarenessBytes caps an inbound presence/awareness frame on the doc
	// WebSocket. Awareness payloads are cursor positions + user info.
	MaxAwarenessBytes = 16 << 10 // 16 KiB

	// MaxReplayPage caps how many updates GetState/ListUpdates return per
	// request; clients page with ?since= until hasMore is false.
	MaxReplayPage = 500
)
