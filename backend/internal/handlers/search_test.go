package handlers

import (
	"strings"
	"testing"
)

// Fuzzy object-label matching: query variants must let "birds" reach the
// "bird" label and "planes" reach the "airplane" label.

func termsContain(terms []string, want string) bool {
	for _, t := range terms {
		if t == want {
			return true
		}
	}
	return false
}

func TestExpandSearchTerms_PluralToSingular(t *testing.T) {
	terms := expandSearchTerms("birds")
	if !termsContain(terms, "bird") {
		t.Fatalf("expected 'bird' in %v", terms)
	}
}

func TestExpandSearchTerms_PlanesMatchesAirplane(t *testing.T) {
	// "planes" → "plane", which is a substring of the "airplane" label.
	terms := expandSearchTerms("planes")
	if !termsContain(terms, "plane") {
		t.Fatalf("expected 'plane' in %v", terms)
	}
	if !strings.Contains("airplane", "plane") {
		t.Fatal("sanity: 'airplane' should contain 'plane'")
	}
}

func TestExpandSearchTerms_SingularAddsPlural(t *testing.T) {
	terms := expandSearchTerms("bird")
	if !termsContain(terms, "bird") || !termsContain(terms, "birds") {
		t.Fatalf("expected both 'bird' and 'birds' in %v", terms)
	}
}

func TestBuildLabelMatchClause_IncludesLabelSubstringCheck(t *testing.T) {
	clause, args := buildLabelMatchClause("planes")
	if !strings.Contains(clause, "? ILIKE '%' || od.label || '%'") {
		t.Fatalf("clause missing label-substring branch: %s", clause)
	}
	if len(args) == 0 {
		t.Fatal("expected non-empty args")
	}
}

// Port of TypeScript search service helper tests

func getMatchRank(name, query string) int {
	if name == query {
		return 0
	}
	if len(name) >= len(query) && name[:len(query)] == query {
		return 1
	}
	// Word boundary: space, dash, underscore
	for _, sep := range []string{" ", "-", "_"} {
		if contains(name, sep+query) {
			return 2
		}
	}
	if contains(name, query) {
		return 3
	}
	return 3
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && findSubstring(s, substr)
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestMatchRank_ExactMatch(t *testing.T) {
	if v := getMatchRank("photo", "photo"); v != 0 {
		t.Fatalf("Expected rank 0, got %d", v)
	}
}

func TestMatchRank_PrefixMatch(t *testing.T) {
	if v := getMatchRank("photography", "photo"); v != 1 {
		t.Fatalf("Expected rank 1, got %d", v)
	}
}

func TestMatchRank_WordBoundarySpace(t *testing.T) {
	if v := getMatchRank("my photo", "photo"); v != 2 {
		t.Fatalf("Expected rank 2, got %d", v)
	}
}

func TestMatchRank_WordBoundaryDash(t *testing.T) {
	if v := getMatchRank("my-photo", "photo"); v != 2 {
		t.Fatalf("Expected rank 2, got %d", v)
	}
}

func TestMatchRank_WordBoundaryUnderscore(t *testing.T) {
	if v := getMatchRank("my_photo", "photo"); v != 2 {
		t.Fatalf("Expected rank 2, got %d", v)
	}
}

func TestMatchRank_SubstringMatch(t *testing.T) {
	if v := getMatchRank("rephoto", "photo"); v != 3 {
		t.Fatalf("Expected rank 3, got %d", v)
	}
}

// Port of folder path building logic tests

type folderIndexRow struct {
	id             string
	parentFolderID *string
	name           string
}

func buildFolderPath(folderID *string, foldersById map[string]folderIndexRow, cache map[string]string) string {
	if folderID == nil {
		return "/"
	}
	key := *folderID
	if v, ok := cache[key]; ok {
		return v
	}

	visited := map[string]bool{}
	segments := []string{}
	currentID := folderID

	for currentID != nil {
		id := *currentID
		if visited[id] {
			break
		}
		visited[id] = true
		folder, ok := foldersById[id]
		if !ok {
			break
		}
		segments = append([]string{folder.name}, segments...)
		currentID = folder.parentFolderID
	}

	path := "/"
	if len(segments) > 0 {
		path = "/" + joinPath(segments)
	}
	cache[key] = path
	return path
}

func joinPath(segments []string) string {
	result := ""
	for i, s := range segments {
		if i > 0 {
			result += "/"
		}
		result += s
	}
	return result
}

func strPtr(s string) *string { return &s }

func TestBuildFolderPath_NullFolderID(t *testing.T) {
	cache := map[string]string{}
	if v := buildFolderPath(nil, map[string]folderIndexRow{}, cache); v != "/" {
		t.Fatalf("Expected '/', got %q", v)
	}
}

func TestBuildFolderPath_SingleLevel(t *testing.T) {
	folders := map[string]folderIndexRow{
		"f1": {id: "f1", parentFolderID: nil, name: "Photos"},
	}
	cache := map[string]string{}
	if v := buildFolderPath(strPtr("f1"), folders, cache); v != "/Photos" {
		t.Fatalf("Expected '/Photos', got %q", v)
	}
}

func TestBuildFolderPath_Nested(t *testing.T) {
	folders := map[string]folderIndexRow{
		"f1": {id: "f1", parentFolderID: nil, name: "Photos"},
		"f2": {id: "f2", parentFolderID: strPtr("f1"), name: "Vacation"},
		"f3": {id: "f3", parentFolderID: strPtr("f2"), name: "Beach"},
	}
	cache := map[string]string{}
	if v := buildFolderPath(strPtr("f3"), folders, cache); v != "/Photos/Vacation/Beach" {
		t.Fatalf("Expected '/Photos/Vacation/Beach', got %q", v)
	}
}

func TestBuildFolderPath_UsesCache(t *testing.T) {
	folders := map[string]folderIndexRow{
		"f1": {id: "f1", parentFolderID: nil, name: "Photos"},
	}
	cache := map[string]string{}
	buildFolderPath(strPtr("f1"), folders, cache)

	if v, ok := cache["f1"]; !ok || v != "/Photos" {
		t.Fatalf("Cache should contain /Photos for f1, got %q", v)
	}

	// Second call should use cache
	if v := buildFolderPath(strPtr("f1"), folders, cache); v != "/Photos" {
		t.Fatalf("Expected '/Photos' from cache, got %q", v)
	}
}

func TestBuildFolderPath_MissingFolder(t *testing.T) {
	cache := map[string]string{}
	if v := buildFolderPath(strPtr("nonexistent"), map[string]folderIndexRow{}, cache); v != "/" {
		t.Fatalf("Expected '/', got %q", v)
	}
}

func TestBuildFolderPath_CircularReference(t *testing.T) {
	folders := map[string]folderIndexRow{
		"f1": {id: "f1", parentFolderID: strPtr("f2"), name: "A"},
		"f2": {id: "f2", parentFolderID: strPtr("f1"), name: "B"},
	}
	cache := map[string]string{}
	// Should not hang - visited set prevents infinite loop
	result := buildFolderPath(strPtr("f1"), folders, cache)
	if result == "" {
		t.Fatal("Expected non-empty result for circular reference")
	}
}
