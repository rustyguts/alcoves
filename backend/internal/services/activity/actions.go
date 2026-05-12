// Package activity is the canonical activity-log / notification service.
//
// Service.Emit inserts a row into library_activities. Phase B will add
// the Hub and Bus types that broadcast the same payload via Redis Pub/Sub
// to connected WebSocket clients. The single source of truth is always
// the DB row — websocket delivery is best-effort (Redis Pub/Sub is at-most-once;
// clients refetch via HTTP on reconnect).
package activity

import (
	"strings"
)

// Subject types.
const (
	SubjectFile   = "file"
	SubjectFolder = "folder"
	SubjectTag    = "tag"
	SubjectMoment = "moment"
	SubjectShare  = "share"
	SubjectMember = "member"
)

// Action names. These strings are mirrored 1:1 in
// frontend/app/utils/activity-format.ts — change both or neither.
const (
	ActionFileCreated  = "file.created"
	ActionFileDeleted  = "file.deleted"
	ActionFolderCreated = "folder.created"
	ActionFolderRenamed = "folder.renamed"
	ActionFolderDeleted = "folder.deleted"
	ActionTagCreated    = "tag.created"
	ActionMomentCreated = "moment.created"
	ActionMomentShared  = "moment.shared"
	ActionMemberJoined  = "member.joined"
	ActionMemberRemoved = "member.removed"

	// System events — visible in the library Feed tab only.
	// Excluded from the global bell by the /api/notifications query.
	ActionSystemWaveformReady     = "system.waveform_ready"
	ActionSystemTranscribeReady   = "system.transcribe_ready"
	ActionSystemVideoProxyReady   = "system.video_proxy_ready"
)

// IsSystemAction returns true for any action that should be hidden from
// the global bell view (but still surfaced in the per-library Feed).
func IsSystemAction(action string) bool {
	return strings.HasPrefix(action, "system.")
}
