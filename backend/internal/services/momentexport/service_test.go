package momentexport

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCacheKey(t *testing.T) {
	got := CacheKey("lib-1", "moment-2", 7)
	want := "lib-1/moments/moment-2/v7.mp4"
	if got != want {
		t.Fatalf("CacheKey: got %q want %q", got, want)
	}
}

func TestCacheKeyVersionsAreDistinct(t *testing.T) {
	v1 := CacheKey("lib", "m", 1)
	v2 := CacheKey("lib", "m", 2)
	if v1 == v2 {
		t.Fatalf("expected different keys for different versions, both got %q", v1)
	}
}

func TestCachePrefix(t *testing.T) {
	got := CachePrefix("lib-1", "moment-2")
	want := "lib-1/moments/moment-2/"
	if got != want {
		t.Fatalf("CachePrefix: got %q want %q", got, want)
	}
	// Every CacheKey for that moment must live under the prefix so the export
	// worker can sweep stale versions on re-export.
	key := CacheKey("lib-1", "moment-2", 5)
	if !strings.HasPrefix(key, got) {
		t.Fatalf("CacheKey %q is not under CachePrefix %q", key, got)
	}
}

func TestPayloadJSONRoundtrip(t *testing.T) {
	in := Payload{LibraryID: "lib-1", FileID: "file-1", MomentID: "moment-1"}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out Payload
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out != in {
		t.Fatalf("roundtrip mismatch: got %+v want %+v", out, in)
	}
}

func TestPayloadJSONFieldNames(t *testing.T) {
	// Asynq workers consume the payload as JSON; lock the field names so a
	// rename in the Go struct doesn't silently break in-flight tasks.
	b, err := json.Marshal(Payload{LibraryID: "L", FileID: "F", MomentID: "M"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"libraryId":"L"`, `"fileId":"F"`, `"momentId":"M"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("payload JSON %s missing %s", b, want)
		}
	}
}
