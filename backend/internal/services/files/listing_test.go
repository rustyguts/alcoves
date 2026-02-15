package files

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestParseCursor_EmptyString(t *testing.T) {
	result, err := parseCursor("")
	if err != nil || result != nil {
		t.Fatalf("Expected nil, nil for empty cursor; got %v, %v", result, err)
	}
}

func TestParseCursor_ValidFolderCursor(t *testing.T) {
	payload := CursorPayload{KindRank: 0, SortName: "documents", ID: "550e8400-e29b-41d4-a716-446655440000"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	result, err := parseCursor(encoded)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.KindRank != 0 || result.SortName != "documents" || result.ID != payload.ID {
		t.Fatalf("Cursor mismatch: %+v", result)
	}
}

func TestParseCursor_ValidFileCursor(t *testing.T) {
	payload := CursorPayload{KindRank: 1, SortName: "photo.jpg", ID: "550e8400-e29b-41d4-a716-446655440001"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	result, err := parseCursor(encoded)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.KindRank != 1 || result.SortName != "photo.jpg" {
		t.Fatalf("Cursor mismatch: %+v", result)
	}
}

func TestParseCursor_InvalidBase64(t *testing.T) {
	_, err := parseCursor("not-valid-base64!!!")
	if err == nil {
		t.Fatal("Expected error for invalid base64")
	}
}

func TestParseCursor_InvalidJSON(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("not json"))
	_, err := parseCursor(encoded)
	if err == nil {
		t.Fatal("Expected error for invalid JSON")
	}
}

func TestParseCursor_MissingFields(t *testing.T) {
	// Missing sortName and kindRank defaults to 0 in JSON - but ID is not a UUID
	encoded := base64.StdEncoding.EncodeToString([]byte(`{"id":"123"}`))
	_, err := parseCursor(encoded)
	if err == nil {
		t.Fatal("Expected error for invalid cursor (non-UUID ID)")
	}
}

func TestParseCursor_InvalidKindRank(t *testing.T) {
	payload := map[string]interface{}{"kindRank": 2, "sortName": "a", "id": "550e8400-e29b-41d4-a716-446655440000"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	_, err := parseCursor(encoded)
	if err == nil {
		t.Fatal("Expected error for invalid kindRank")
	}
}

func TestParseCursor_EmptySortName(t *testing.T) {
	payload := CursorPayload{KindRank: 0, SortName: "", ID: "550e8400-e29b-41d4-a716-446655440000"}
	data, _ := json.Marshal(payload)
	encoded := base64.StdEncoding.EncodeToString(data)

	result, err := parseCursor(encoded)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if result.SortName != "" {
		t.Fatalf("Expected empty sortName, got %q", result.SortName)
	}
}

func TestParseLimit_Default(t *testing.T) {
	if v := parseLimit(""); v != DefaultLimit {
		t.Fatalf("Expected %d, got %d", DefaultLimit, v)
	}
	if v := parseLimit("abc"); v != DefaultLimit {
		t.Fatalf("Expected %d for NaN, got %d", DefaultLimit, v)
	}
}

func TestParseLimit_ClampsMinimum(t *testing.T) {
	if v := parseLimit("-5"); v != 1 {
		t.Fatalf("Expected 1, got %d", v)
	}
}

func TestParseLimit_ClampsMaximum(t *testing.T) {
	if v := parseLimit("500"); v != MaxLimit {
		t.Fatalf("Expected %d, got %d", MaxLimit, v)
	}
}

func TestParseLimit_ValidValues(t *testing.T) {
	if v := parseLimit("25"); v != 25 {
		t.Fatalf("Expected 25, got %d", v)
	}
	if v := parseLimit("100"); v != 100 {
		t.Fatalf("Expected 100, got %d", v)
	}
}

func TestNormalizeFolderID(t *testing.T) {
	// Nil for empty
	if v := normalizeFolderID(""); v != nil {
		t.Fatal("Expected nil for empty string")
	}

	// Nil for whitespace
	if v := normalizeFolderID("   "); v != nil {
		t.Fatal("Expected nil for whitespace")
	}

	// Nil for "null"
	if v := normalizeFolderID("null"); v != nil {
		t.Fatal("Expected nil for 'null'")
	}

	// Trims and returns valid folder IDs
	v := normalizeFolderID("folder-123")
	if v == nil || *v != "folder-123" {
		t.Fatalf("Expected 'folder-123', got %v", v)
	}

	v = normalizeFolderID("  folder-123  ")
	if v == nil || *v != "folder-123" {
		t.Fatalf("Expected 'folder-123', got %v", v)
	}

	// Any non-empty value
	v = normalizeFolderID("abc")
	if v == nil || *v != "abc" {
		t.Fatalf("Expected 'abc', got %v", v)
	}

	v = normalizeFolderID("0")
	if v == nil || *v != "0" {
		t.Fatalf("Expected '0', got %v", v)
	}
}

func TestEscapeSQLString(t *testing.T) {
	if v := escapeSQLString("hello"); v != "hello" {
		t.Fatalf("Expected 'hello', got %q", v)
	}
	if v := escapeSQLString("it's"); v != "it''s" {
		t.Fatalf("Expected escaped single quote, got %q", v)
	}
	if v := escapeSQLString("a''b"); v != "a''''b" {
		t.Fatalf("Expected double-escaped, got %q", v)
	}
}
