package mcpserver

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// These tests exercise the v1 tool set added for full Alcoves feature parity.
// They reuse setup/call/decode/errText from mcpserver_test.go and the shared
// :5455 test database (skipped automatically when unavailable).

func strptr(s string) *string   { return &s }
func f64ptr(f float64) *float64 { return &f }

// seedFile inserts a File row directly and returns its ID.
func seedFile(t *testing.T, fx fixture, lib uuid.UUID, f models.File) uuid.UUID {
	t.Helper()
	f.ID = uuid.New()
	f.LibraryID = lib
	if f.MimeType == "" {
		f.MimeType = "application/octet-stream"
	}
	f.OwnerID = &fx.userA.ID
	if err := fx.deps.DB.Create(&f).Error; err != nil {
		t.Fatalf("seed file: %v", err)
	}
	return f.ID
}

// ─── get_library ─────────────────────────────────────────────────────────────

func TestGetLibrary_RoleAndFlags(t *testing.T) {
	fx := setup(t)
	// Enable a couple of flags on libShared to verify they surface.
	fx.deps.DB.Model(&models.Library{}).Where("id = ?", fx.libShared).
		Updates(map[string]any{"face_recognition_enabled": true, "sharing_enabled": true})

	out := decode[libraryDetail](t, call(t, fx.deps, fx.userA, "get_library", map[string]any{"libraryId": fx.libShared.String()}))
	if out.Role != "owner" || !out.IsOwner || !out.IsAdmin {
		t.Fatalf("owner role wrong: %+v", out)
	}
	if !out.FaceRecognitionEnabled || !out.SharingEnabled || out.ObjectDetectionEnabled {
		t.Fatalf("flags wrong: %+v", out)
	}

	// userB is admin of libShared.
	outB := decode[libraryDetail](t, call(t, fx.deps, fx.userB, "get_library", map[string]any{"libraryId": fx.libShared.String()}))
	if outB.Role != "admin" || outB.IsOwner || !outB.IsAdmin {
		t.Fatalf("admin role wrong: %+v", outB)
	}

	// userB has no access to libA.
	if res := call(t, fx.deps, fx.userB, "get_library", map[string]any{"libraryId": fx.libA.String()}); !res.IsError {
		t.Fatalf("expected access denied for userB on libA")
	}
}

// ─── list_members ────────────────────────────────────────────────────────────

func TestListMembers_OwnerFirst(t *testing.T) {
	fx := setup(t)
	out := decode[listMembersOutput](t, call(t, fx.deps, fx.userC, "list_members", map[string]any{"libraryId": fx.libShared.String()}))
	if len(out.Members) != 3 {
		t.Fatalf("expected 3 members, got %+v", out.Members)
	}
	if out.Members[0].Role != "owner" || !out.Members[0].IsOwner || out.Members[0].UserID != fx.userA.ID.String() {
		t.Fatalf("owner should be first: %+v", out.Members[0])
	}
	roles := map[string]string{}
	for _, m := range out.Members {
		roles[m.UserID] = m.Role
	}
	if roles[fx.userB.ID.String()] != "admin" || roles[fx.userC.ID.String()] != "viewer" {
		t.Fatalf("member roles wrong: %+v", roles)
	}
}

// ─── search ──────────────────────────────────────────────────────────────────

func TestSearch_ScopedToAccessAndObjectLabels(t *testing.T) {
	fx := setup(t)
	// "vacation.jpg" in libA (userB can't see) and libShared (userB can).
	seedFile(t, fx, fx.libA, models.File{Name: "vacation.jpg", MimeType: "image/jpeg"})
	sharedFile := seedFile(t, fx, fx.libShared, models.File{Name: "vacation.jpg", MimeType: "image/jpeg"})

	// Object detection "dog" on a differently-named file in libShared.
	dogFile := seedFile(t, fx, fx.libShared, models.File{Name: "IMG_001.jpg", MimeType: "image/jpeg"})
	fx.deps.DB.Create(&models.ObjectDetection{
		FileID: dogFile, LibraryID: fx.libShared, Label: "dog", Confidence: 90,
		BoxX: 1, BoxY: 1, BoxWidth: 10, BoxHeight: 10, ImageWidth: 100, ImageHeight: 100,
	})

	// userB searches "vacation": only the libShared file (not libA's).
	out := decode[searchOutput](t, call(t, fx.deps, fx.userB, "search", map[string]any{"query": "vacation"}))
	if len(out.Results) != 1 || out.Results[0].ID != sharedFile.String() {
		t.Fatalf("search should be scoped to access: %+v", out.Results)
	}

	// Plural object search "dogs" finds the dog file by label.
	out = decode[searchOutput](t, call(t, fx.deps, fx.userB, "search", map[string]any{"query": "dogs"}))
	found := false
	for _, r := range out.Results {
		if r.ID == dogFile.String() && r.MatchReason == "object" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected object-label match for 'dogs': %+v", out.Results)
	}

	// Empty query → empty results, no error.
	out = decode[searchOutput](t, call(t, fx.deps, fx.userA, "search", map[string]any{"query": "   "}))
	if len(out.Results) != 0 {
		t.Fatalf("blank query should return no results: %+v", out)
	}
}

// ─── get_file ────────────────────────────────────────────────────────────────

func TestGetFile_MetadataAndTags(t *testing.T) {
	fx := setup(t)
	cap := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	fileID := seedFile(t, fx, fx.libA, models.File{
		Name: "beach.jpg", MimeType: "image/jpeg", Size: 2048,
		CapturedAt: &cap, GpsLat: f64ptr(40.0), GpsLon: f64ptr(-74.0),
		CameraMake: strptr("Canon"),
	})
	tag := models.Tag{LibraryID: fx.libA, Name: "summer", Color: "#22C55E"}
	fx.deps.DB.Create(&tag)
	fx.deps.DB.Create(&models.FileTag{FileID: fileID, TagID: tag.ID})

	out := decode[fileDetail](t, call(t, fx.deps, fx.userA, "get_file", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
	}))
	if out.Name != "beach.jpg" || out.Size != 2048 || out.GpsLat == nil || *out.GpsLat != 40.0 {
		t.Fatalf("metadata wrong: %+v", out)
	}
	if len(out.Tags) != 1 || out.Tags[0].Name != "summer" {
		t.Fatalf("tags wrong: %+v", out.Tags)
	}

	// Cross-library: file not found in libShared.
	if res := call(t, fx.deps, fx.userA, "get_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileId": fileID.String(),
	}); !res.IsError {
		t.Fatalf("expected not-found across libraries")
	}
	// No access for userB on libA.
	if res := call(t, fx.deps, fx.userB, "get_file", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
	}); !res.IsError {
		t.Fatalf("expected access denied for userB")
	}
}

// ─── get_timeline + list_map_points ──────────────────────────────────────────

func TestTimelineAndMap(t *testing.T) {
	fx := setup(t)
	old := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	recent := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	seedFile(t, fx, fx.libA, models.File{Name: "old.jpg", MimeType: "image/jpeg", CapturedAt: &old})
	geoID := seedFile(t, fx, fx.libA, models.File{Name: "new.jpg", MimeType: "image/jpeg", CapturedAt: &recent, GpsLat: f64ptr(1.0), GpsLon: f64ptr(2.0)})
	seedFile(t, fx, fx.libA, models.File{Name: "notes.txt", MimeType: "text/plain"})

	// Default (media only): 2 entries, newest first.
	tl := decode[getTimelineOutput](t, call(t, fx.deps, fx.userA, "get_timeline", map[string]any{"libraryId": fx.libA.String()}))
	if len(tl.Entries) != 2 || tl.Entries[0].Name != "new.jpg" {
		t.Fatalf("timeline media ordering wrong: %+v", tl.Entries)
	}
	// includeAll: 3 entries.
	tlAll := decode[getTimelineOutput](t, call(t, fx.deps, fx.userA, "get_timeline", map[string]any{"libraryId": fx.libA.String(), "includeAll": true}))
	if len(tlAll.Entries) != 3 {
		t.Fatalf("includeAll should list all files: %+v", tlAll.Entries)
	}

	// Map: only the geotagged file.
	mp := decode[listMapPointsOutput](t, call(t, fx.deps, fx.userA, "list_map_points", map[string]any{"libraryId": fx.libA.String()}))
	if len(mp.Points) != 1 || mp.Points[0].ID != geoID.String() {
		t.Fatalf("map points wrong: %+v", mp.Points)
	}
}

// ─── create_folder ───────────────────────────────────────────────────────────

func TestCreateFolder_AdminAndNesting(t *testing.T) {
	fx := setup(t)
	// Owner creates a root folder.
	root := decode[createFolderOutput](t, call(t, fx.deps, fx.userA, "create_folder", map[string]any{
		"libraryId": fx.libShared.String(), "name": "Photos",
	}))
	if root.Name != "Photos" || root.ParentFolderID != nil {
		t.Fatalf("root folder wrong: %+v", root)
	}
	// Nested under it.
	child := decode[createFolderOutput](t, call(t, fx.deps, fx.userA, "create_folder", map[string]any{
		"libraryId": fx.libShared.String(), "name": "2025", "parentFolderId": root.ID,
	}))
	if child.ParentFolderID == nil || *child.ParentFolderID != root.ID {
		t.Fatalf("nested folder wrong: %+v", child)
	}
	// Bad parent rejected.
	if res := call(t, fx.deps, fx.userA, "create_folder", map[string]any{
		"libraryId": fx.libShared.String(), "name": "x", "parentFolderId": uuid.New().String(),
	}); !res.IsError {
		t.Fatalf("expected error for nonexistent parent")
	}
	// Viewer (userC) denied.
	if res := call(t, fx.deps, fx.userC, "create_folder", map[string]any{
		"libraryId": fx.libShared.String(), "name": "nope",
	}); !res.IsError {
		t.Fatalf("expected viewer to be denied folder creation")
	}
}

// With a configured Activity service in synchronous mode (the stdio path), a
// write tool records a library-feed row before returning.
func TestCreateFolder_EmitsActivitySync(t *testing.T) {
	fx := setup(t)
	d := fx.deps
	d.Activity = activity.NewService(d.DB, nil, nil)
	d.SyncActivity = true

	out := decode[createFolderOutput](t, call(t, d, fx.userA, "create_folder", map[string]any{
		"libraryId": fx.libShared.String(), "name": "Activity",
	}))
	var count int64
	d.DB.Model(&models.LibraryActivity{}).
		Where("library_id = ? AND action = ? AND subject_id = ?", fx.libShared, activity.ActionFolderCreated, out.ID).
		Count(&count)
	if count != 1 {
		t.Fatalf("expected 1 %s activity row, got %d", activity.ActionFolderCreated, count)
	}
}

// ─── update_file (rename + move) ─────────────────────────────────────────────

func TestUpdateFile_RenameAndMove(t *testing.T) {
	fx := setup(t)
	fileID := seedFile(t, fx, fx.libShared, models.File{Name: "raw.mov", MimeType: "video/quicktime"})
	folder := models.Folder{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: fx.libShared, Name: "clips", OwnerID: &fx.userA.ID}
	fx.deps.DB.Create(&folder)

	// Rename + move in one call.
	out := decode[updateFileOutput](t, call(t, fx.deps, fx.userB, "update_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileId": fileID.String(),
		"name": "final.mov", "parentFolderId": folder.ID.String(),
	}))
	if out.Name != "final.mov" || out.ParentFolderID == nil || *out.ParentFolderID != folder.ID.String() {
		t.Fatalf("rename/move wrong: %+v", out)
	}
	// Rename only (parentFolderId absent) must leave the folder unchanged.
	out = decode[updateFileOutput](t, call(t, fx.deps, fx.userB, "update_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileId": fileID.String(), "name": "renamed.mov",
	}))
	if out.Name != "renamed.mov" || out.ParentFolderID == nil || *out.ParentFolderID != folder.ID.String() {
		t.Fatalf("rename-only should keep folder: %+v", out)
	}
	// Move back to root with empty string.
	out = decode[updateFileOutput](t, call(t, fx.deps, fx.userB, "update_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileId": fileID.String(), "parentFolderId": "",
	}))
	if out.ParentFolderID != nil {
		t.Fatalf("expected move to root: %+v", out)
	}
	// Nonexistent destination folder rejected.
	if res := call(t, fx.deps, fx.userB, "update_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileId": fileID.String(), "parentFolderId": uuid.New().String(),
	}); !res.IsError {
		t.Fatalf("expected error for bad destination folder")
	}
	// Viewer denied.
	if res := call(t, fx.deps, fx.userC, "update_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileId": fileID.String(), "name": "hax.mov",
	}); !res.IsError {
		t.Fatalf("expected viewer denied")
	}
}

// ─── trash_file + restore_file ───────────────────────────────────────────────

func TestTrashAndRestoreFile(t *testing.T) {
	fx := setup(t)
	f1 := seedFile(t, fx, fx.libShared, models.File{Name: "a.bin"})
	f2 := seedFile(t, fx, fx.libShared, models.File{Name: "b.bin"})

	tr := decode[trashFileOutput](t, call(t, fx.deps, fx.userB, "trash_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileIds": []string{f1.String(), f2.String()},
	}))
	if tr.Trashed != 2 {
		t.Fatalf("expected 2 trashed, got %d", tr.Trashed)
	}
	// Re-trashing already-trashed yields 0.
	tr = decode[trashFileOutput](t, call(t, fx.deps, fx.userB, "trash_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileIds": []string{f1.String()},
	}))
	if tr.Trashed != 0 {
		t.Fatalf("expected 0 re-trashed, got %d", tr.Trashed)
	}
	// Restore.
	rs := decode[restoreFileOutput](t, call(t, fx.deps, fx.userB, "restore_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileIds": []string{f1.String(), f2.String()},
	}))
	if rs.Restored != 2 {
		t.Fatalf("expected 2 restored, got %d", rs.Restored)
	}
	// Viewer denied trashing.
	if res := call(t, fx.deps, fx.userC, "trash_file", map[string]any{
		"libraryId": fx.libShared.String(), "fileIds": []string{f1.String()},
	}); !res.IsError {
		t.Fatalf("expected viewer denied trash")
	}
}

// ─── tags ────────────────────────────────────────────────────────────────────

func TestTags_CreateListAndSetFileTags(t *testing.T) {
	fx := setup(t)
	// Auto-color on create.
	tagA := decode[tagRef](t, call(t, fx.deps, fx.userA, "create_tag", map[string]any{
		"libraryId": fx.libA.String(), "name": "trip",
	}))
	if tagA.Color == "" || tagA.Name != "trip" {
		t.Fatalf("create_tag wrong: %+v", tagA)
	}
	// Duplicate name rejected.
	if res := call(t, fx.deps, fx.userA, "create_tag", map[string]any{
		"libraryId": fx.libA.String(), "name": "trip",
	}); !res.IsError {
		t.Fatalf("expected duplicate tag name error")
	}
	// A second tag gets a different palette color.
	tagB := decode[tagRef](t, call(t, fx.deps, fx.userA, "create_tag", map[string]any{
		"libraryId": fx.libA.String(), "name": "family",
	}))
	if tagB.Color == tagA.Color {
		t.Fatalf("expected distinct auto colors, both %s", tagA.Color)
	}

	// set_file_tags replaces the set.
	fileID := seedFile(t, fx, fx.libA, models.File{Name: "p.jpg", MimeType: "image/jpeg"})
	res := decode[setFileTagsOutput](t, call(t, fx.deps, fx.userA, "set_file_tags", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
		"tagIds": []string{tagA.ID, tagB.ID},
	}))
	if len(res.Tags) != 2 {
		t.Fatalf("expected 2 tags set, got %+v", res.Tags)
	}
	// Replace with just one.
	res = decode[setFileTagsOutput](t, call(t, fx.deps, fx.userA, "set_file_tags", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(), "tagIds": []string{tagA.ID},
	}))
	if len(res.Tags) != 1 || res.Tags[0].ID != tagA.ID {
		t.Fatalf("expected tag replace to 1, got %+v", res.Tags)
	}
	// Empty array clears all tags.
	res = decode[setFileTagsOutput](t, call(t, fx.deps, fx.userA, "set_file_tags", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(), "tagIds": []string{},
	}))
	if len(res.Tags) != 0 {
		t.Fatalf("expected tags cleared, got %+v", res.Tags)
	}

	// Cross-library tag rejected: a tag from libShared can't be applied to a libA file.
	otherTag := models.Tag{LibraryID: fx.libShared, Name: "other", Color: "#000000"}
	fx.deps.DB.Create(&otherTag)
	if r := call(t, fx.deps, fx.userA, "set_file_tags", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(), "tagIds": []string{otherTag.ID.String()},
	}); !r.IsError {
		t.Fatalf("expected cross-library tag rejection")
	}

	// list_tags shows both libA tags.
	lt := decode[listTagsOutput](t, call(t, fx.deps, fx.userA, "list_tags", map[string]any{"libraryId": fx.libA.String()}))
	if len(lt.Tags) != 2 {
		t.Fatalf("expected 2 tags listed, got %+v", lt.Tags)
	}
}

// ─── AI insights ─────────────────────────────────────────────────────────────

func TestGetTranscript_ReadyStates(t *testing.T) {
	fx := setup(t)
	// Not ready (no status).
	fileID := seedFile(t, fx, fx.libA, models.File{Name: "talk.mp4", MimeType: "video/mp4"})
	out := decode[getTranscriptOutput](t, call(t, fx.deps, fx.userA, "get_transcript", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
	}))
	if out.Ready {
		t.Fatalf("expected not ready, got %+v", out)
	}
	// Ready with text.
	fx.deps.DB.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]any{
		"transcribe_status": "ready", "transcript_text": "hello world", "transcript_model": "large-v3",
	})
	out = decode[getTranscriptOutput](t, call(t, fx.deps, fx.userA, "get_transcript", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
	}))
	if !out.Ready || out.Text == nil || *out.Text != "hello world" {
		t.Fatalf("expected ready transcript, got %+v", out)
	}
}

func TestListAudioEvents(t *testing.T) {
	fx := setup(t)
	fileID := seedFile(t, fx, fx.libA, models.File{Name: "podcast.mp3", MimeType: "audio/mpeg"})
	fx.deps.DB.Create(&models.AudioDetection{FileID: fileID, LibraryID: fx.libA, Label: "Music", ClassIndex: 1, Score: 0.9, StartSeconds: 5, EndSeconds: 6})
	fx.deps.DB.Create(&models.AudioDetection{FileID: fileID, LibraryID: fx.libA, Label: "Speech", ClassIndex: 2, Score: 0.8, StartSeconds: 0, EndSeconds: 1})

	out := decode[listAudioEventsOutput](t, call(t, fx.deps, fx.userA, "list_audio_events", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
	}))
	if len(out.Events) != 2 || out.Events[0].Label != "Speech" {
		t.Fatalf("audio events ordering wrong: %+v", out.Events)
	}
}

func TestListPeople(t *testing.T) {
	fx := setup(t)
	fx.deps.DB.Create(&models.Person{ID: uuid.New(), LibraryID: fx.libA, Name: strptr("Alice"), FaceCount: 5})
	fx.deps.DB.Create(&models.Person{ID: uuid.New(), LibraryID: fx.libA, FaceCount: 0}) // excluded (no faces)

	out := decode[listPeopleOutput](t, call(t, fx.deps, fx.userA, "list_people", map[string]any{"libraryId": fx.libA.String()}))
	if len(out.People) != 1 || out.People[0].Name == nil || *out.People[0].Name != "Alice" {
		t.Fatalf("people list wrong: %+v", out.People)
	}
}

func TestListObjects_SummaryAndPerFile(t *testing.T) {
	fx := setup(t)
	f1 := seedFile(t, fx, fx.libA, models.File{Name: "1.jpg", MimeType: "image/jpeg"})
	f2 := seedFile(t, fx, fx.libA, models.File{Name: "2.jpg", MimeType: "image/jpeg"})
	mk := func(file uuid.UUID, label string, conf int) {
		fx.deps.DB.Create(&models.ObjectDetection{FileID: file, LibraryID: fx.libA, Label: label, Confidence: conf, ImageWidth: 100, ImageHeight: 100})
	}
	mk(f1, "dog", 90)
	mk(f2, "dog", 80)
	mk(f1, "cat", 70)

	// Library summary: dog (2 files) before cat (1 file).
	sum := decode[listObjectsOutput](t, call(t, fx.deps, fx.userA, "list_objects", map[string]any{"libraryId": fx.libA.String()}))
	if len(sum.Labels) != 2 || sum.Labels[0].Label != "dog" || sum.Labels[0].FileCount != 2 {
		t.Fatalf("object summary wrong: %+v", sum.Labels)
	}
	// Per-file: f1 has dog + cat.
	perFile := decode[listObjectsOutput](t, call(t, fx.deps, fx.userA, "list_objects", map[string]any{
		"libraryId": fx.libA.String(), "fileId": f1.String(),
	}))
	if len(perFile.Detections) != 2 {
		t.Fatalf("per-file detections wrong: %+v", perFile.Detections)
	}
}

func TestListMoments(t *testing.T) {
	fx := setup(t)
	fileID := seedFile(t, fx, fx.libA, models.File{Name: "vid.mp4", MimeType: "video/mp4"})
	m := models.Moment{BaseModel: models.BaseModel{ID: uuid.New()}, FileID: fileID, LibraryID: fx.libA, CreatedByID: fx.userA.ID, Name: "Intro", StartSeconds: 0, EndSeconds: 10, ExportVersion: 1}
	fx.deps.DB.Create(&m)
	tag := models.Tag{LibraryID: fx.libA, Name: "highlight", Color: "#fff"}
	fx.deps.DB.Create(&tag)
	fx.deps.DB.Create(&models.MomentTag{MomentID: m.ID, TagID: tag.ID})

	out := decode[listMomentsOutput](t, call(t, fx.deps, fx.userA, "list_moments", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
	}))
	if len(out.Moments) != 1 || out.Moments[0].Name != "Intro" || len(out.Moments[0].Tags) != 1 {
		t.Fatalf("moments wrong: %+v", out.Moments)
	}

	// A valid-but-unknown fileId is rejected as not found (consistency).
	if res := call(t, fx.deps, fx.userA, "list_moments", map[string]any{
		"libraryId": fx.libA.String(), "fileId": uuid.New().String(),
	}); !res.IsError {
		t.Fatalf("expected not-found for unknown file")
	}
}

// download_file in URL mode must shell-quote the file name so a name containing
// a single quote produces a safe (non-injectable) curl command.
func TestDownloadFile_CurlFilenameEscaped(t *testing.T) {
	fx := setup(t)
	fileID := seedFile(t, fx, fx.libA, models.File{Name: "o'brien.txt", MimeType: "text/plain", Size: 2})
	out := decode[downloadFileOutput](t, call(t, fx.deps, fx.userA, "download_file", map[string]any{
		"libraryId": fx.libA.String(), "fileId": fileID.String(),
	}))
	if out.Mode != "url" {
		t.Fatalf("expected url mode, got %+v", out)
	}
	if !strings.Contains(out.CurlCommand, `'o'\''brien.txt'`) {
		t.Fatalf("curl filename not safely quoted: %q", out.CurlCommand)
	}
}

// ─── invalid-argument handling ───────────────────────────────────────────────

func TestInvalidUUIDArgs(t *testing.T) {
	fx := setup(t)
	for _, tc := range []struct {
		tool string
		args map[string]any
	}{
		{"get_library", map[string]any{"libraryId": "not-a-uuid"}},
		{"get_file", map[string]any{"libraryId": fx.libA.String(), "fileId": "nope"}},
		{"create_folder", map[string]any{"libraryId": "bad", "name": "x"}},
		{"trash_file", map[string]any{"libraryId": fx.libA.String(), "fileIds": []string{"bad"}}},
		{"restore_file", map[string]any{"libraryId": fx.libA.String(), "fileIds": []string{}}}, // empty list
		{"list_files", map[string]any{"libraryId": "bad"}},
		{"get_timeline", map[string]any{"libraryId": "bad"}},
		{"list_map_points", map[string]any{"libraryId": "bad"}},
		{"download_file", map[string]any{"libraryId": fx.libA.String(), "fileId": "bad"}},
		{"upload_file", map[string]any{"libraryId": "bad", "filename": "x"}},
		{"list_moments", map[string]any{"libraryId": fx.libA.String(), "fileId": "bad"}},
		{"list_objects", map[string]any{"libraryId": fx.libA.String(), "fileId": "bad"}},
		{"get_transcript", map[string]any{"libraryId": fx.libA.String(), "fileId": "bad"}},
		{"set_file_tags", map[string]any{"libraryId": fx.libA.String(), "fileId": "bad", "tagIds": []string{}}},
		{"create_tag", map[string]any{"libraryId": "bad", "name": "x"}},
		{"update_file", map[string]any{"libraryId": fx.libA.String(), "fileId": "bad"}},
	} {
		if res := call(t, fx.deps, fx.userA, tc.tool, tc.args); !res.IsError {
			t.Fatalf("%s: expected error for invalid UUID", tc.tool)
		}
	}
}
