package handlers

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/files"
)

// ---------------------------------------------------------------------------
// Single-file response shape (regression)
//
// The single-file payload (Get/Update/Upload/job handlers via fileJSON) used to
// omit owner, tags, capturedAt, gpsLat and gpsLon even though the list endpoint
// (services/files FileResponse) and the client's LibraryFile type include them
// — owner and tags are declared REQUIRED in client/src/lib/types/api.ts. These
// tests pin the single-file response to the list row's field names and shapes.
// ---------------------------------------------------------------------------

func TestFile_Get_IncludesOwnerTagsAndCaptureMetadata(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "geo.jpg", false, nil)

	tagID := createTag(t, db, fix.LibraryID, "vacation")
	tagFile(t, db, id, tagID)

	captured := time.Date(2024, 5, 4, 12, 30, 0, 0, time.UTC)
	lat, lon := 44.5, -110.3
	if err := db.Model(&models.File{}).Where("id = ?", id).Updates(map[string]any{
		"captured_at": captured,
		"gps_lat":     lat,
		"gps_lon":     lon,
	}).Error; err != nil {
		t.Fatalf("set capture metadata: %v", err)
	}

	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Get(c); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}

	var single map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &single); err != nil {
		t.Fatalf("unmarshal single-file response: %v", err)
	}

	// owner — same shape as the list endpoint's OwnerSummary / LibraryUserSummary.
	owner, ok := single["owner"].(map[string]any)
	if !ok {
		t.Fatalf("owner missing or not an object: %T %v", single["owner"], single["owner"])
	}
	if owner["id"] != fix.UserID.String() {
		t.Fatalf("owner.id = %v, want %s", owner["id"], fix.UserID)
	}
	if owner["displayName"] != "Purge Test User" {
		t.Fatalf("owner.displayName = %v", owner["displayName"])
	}
	if _, present := owner["avatarUrl"]; !present {
		t.Fatalf("owner.avatarUrl key missing")
	}

	// tags — same shape as the list endpoint's TagResponse / LibraryTag.
	tags, ok := single["tags"].([]any)
	if !ok {
		t.Fatalf("tags missing or not an array: %T %v", single["tags"], single["tags"])
	}
	if len(tags) != 1 {
		t.Fatalf("want 1 tag, got %d", len(tags))
	}
	tag, ok := tags[0].(map[string]any)
	if !ok {
		t.Fatalf("tag not an object: %T", tags[0])
	}
	if tag["id"] != tagID.String() || tag["libraryId"] != fix.LibraryID.String() ||
		tag["name"] != "vacation" || tag["color"] != "#ff0000" {
		t.Fatalf("tag mismatch: %v", tag)
	}
	for _, k := range []string{"createdAt", "updatedAt"} {
		if _, present := tag[k]; !present {
			t.Fatalf("tag missing %q", k)
		}
	}

	// capture metadata — same field names as the list endpoint.
	if single["capturedAt"] == nil {
		t.Fatalf("capturedAt missing or null")
	}
	if got, _ := single["gpsLat"].(float64); got != lat {
		t.Fatalf("gpsLat = %v, want %v", single["gpsLat"], lat)
	}
	if got, _ := single["gpsLon"].(float64); got != lon {
		t.Fatalf("gpsLon = %v, want %v", single["gpsLon"], lon)
	}

	// Key-set parity: every key a list row carries must also be present in the
	// single-file response for the same file (single-file is a strict superset).
	listResult, err := h.fileSvc.ListLibraryFiles(fix.LibraryID.String(), files.ListParams{})
	if err != nil {
		t.Fatalf("ListLibraryFiles: %v", err)
	}
	var listRow map[string]any
	for _, e := range listResult.Entries {
		raw, err := json.Marshal(e)
		if err != nil {
			t.Fatalf("marshal list entry: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("unmarshal list entry: %v", err)
		}
		if m["id"] == id.String() {
			listRow = m
			break
		}
	}
	if listRow == nil {
		t.Fatalf("file %s not found in list response", id)
	}
	for key := range listRow {
		if _, present := single[key]; !present {
			t.Fatalf("single-file response missing list-row key %q", key)
		}
	}

	// owner + tags must serialize identically in both payloads.
	if !reflect.DeepEqual(single["owner"], listRow["owner"]) {
		t.Fatalf("owner differs: single=%v list=%v", single["owner"], listRow["owner"])
	}
	if !reflect.DeepEqual(single["tags"], listRow["tags"]) {
		t.Fatalf("tags differ: single=%v list=%v", single["tags"], listRow["tags"])
	}
}

// TestFile_Update_IncludesOwnerAndTags covers the fileToJSONWithLookup path
// (Update + the file_jobs.go handlers) carrying owner + tags as well.
func TestFile_Update_IncludesOwnerAndTags(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "old.jpg", false, nil)
	tagID := createTag(t, db, fix.LibraryID, "keep")
	tagFile(t, db, id, tagID)

	c, rec := ffCtx(http.MethodPatch, "/", `{"name":"new.jpg"}`, fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Update(c); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	owner, ok := resp["owner"].(map[string]any)
	if !ok || owner["id"] != fix.UserID.String() {
		t.Fatalf("owner missing or mismatched: %v", resp["owner"])
	}
	tags, ok := resp["tags"].([]any)
	if !ok || len(tags) != 1 {
		t.Fatalf("tags missing or mismatched: %v", resp["tags"])
	}
	if tag, _ := tags[0].(map[string]any); tag["id"] != tagID.String() {
		t.Fatalf("tag id mismatch: %v", tags[0])
	}
}

// TestFile_Get_OwnerlessAndUntagged pins the degraded shape: owner null (not
// absent) and tags an empty array (not null), matching list rows.
func TestFile_Get_OwnerlessAndUntagged(t *testing.T) {
	h, db, _, fix := fullFileHandler(t)
	id := createFile(t, db, fix.LibraryID, fix.UserID, "plain.jpg", false, nil)
	if err := db.Model(&models.File{}).Where("id = ?", id).Update("owner_id", nil).Error; err != nil {
		t.Fatalf("clear owner: %v", err)
	}

	c, rec := ffCtx(http.MethodGet, "/", "", fix, map[string]string{"id": fix.LibraryID.String(), "fileId": id.String()})
	if err := h.Get(c); err != nil {
		t.Fatalf("Get: %v", err)
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if v, present := resp["owner"]; !present || v != nil {
		t.Fatalf("owner: want explicit null, got present=%v value=%v", present, v)
	}
	tags, ok := resp["tags"].([]any)
	if !ok {
		t.Fatalf("tags: want empty array, got %T %v", resp["tags"], resp["tags"])
	}
	if len(tags) != 0 {
		t.Fatalf("tags: want empty, got %v", tags)
	}
}
