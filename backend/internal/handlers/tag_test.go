package handlers

import (
	"regexp"
	"strings"
	"testing"
)

func TestTagColorPaletteContains12Colors(t *testing.T) {
	if len(TagColorPalette) != 12 {
		t.Fatalf("Expected 12 colors, got %d", len(TagColorPalette))
	}
}

func TestTagColorPaletteAllValidUppercaseHex(t *testing.T) {
	re := regexp.MustCompile(`^#[0-9A-F]{6}$`)
	for _, color := range TagColorPalette {
		if !re.MatchString(color) {
			t.Fatalf("Invalid palette color: %q", color)
		}
	}
}

func TestTagColorPaletteNoDuplicates(t *testing.T) {
	seen := map[string]bool{}
	for _, color := range TagColorPalette {
		if seen[color] {
			t.Fatalf("Duplicate palette color: %s", color)
		}
		seen[color] = true
	}
}

func TestIsTagColorInPalette(t *testing.T) {
	inPalette := func(c string) bool {
		c = strings.TrimSpace(strings.ToUpper(c))
		for _, p := range TagColorPalette {
			if p == c {
				return true
			}
		}
		return false
	}

	// Valid palette colors (case-insensitive)
	if !inPalette("#E11D48") {
		t.Fatal("Expected #E11D48 in palette")
	}
	if !inPalette("#e11d48") {
		t.Fatal("Expected #e11d48 (lowercase) in palette")
	}
	if !inPalette(" #3B82F6 ") {
		t.Fatal("Expected #3B82F6 with spaces in palette")
	}

	// Not in palette
	if inPalette("#000000") {
		t.Fatal("Expected #000000 NOT in palette")
	}
	if inPalette("#FFFFFF") {
		t.Fatal("Expected #FFFFFF NOT in palette")
	}
	if inPalette("not-a-color") {
		t.Fatal("Expected 'not-a-color' NOT in palette")
	}
}

func TestNormalizeTagName(t *testing.T) {
	normalize := func(s string) string {
		s = strings.TrimSpace(s)
		// Collapse multiple spaces to one
		parts := strings.Fields(s)
		return strings.Join(parts, " ")
	}

	// Trims whitespace
	if v := normalize("  hello  "); v != "hello" {
		t.Fatalf("Expected 'hello', got %q", v)
	}

	// Collapses multiple internal spaces
	if v := normalize("hello   world"); v != "hello world" {
		t.Fatalf("Expected 'hello world', got %q", v)
	}

	// Mixed whitespace
	if v := normalize("  foo   bar   baz  "); v != "foo bar baz" {
		t.Fatalf("Expected 'foo bar baz', got %q", v)
	}

	// Whitespace-only
	if v := normalize("   "); v != "" {
		t.Fatalf("Expected empty string, got %q", v)
	}
}

func TestNormalizeHexColor(t *testing.T) {
	re := regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

	normalizeHexColor := func(c string) (string, error) {
		c = strings.TrimSpace(c)
		if !re.MatchString(c) {
			return "", &hexError{"Color must be a 6-digit hex value"}
		}
		c = strings.ToUpper(c)
		// Check if in palette
		found := false
		for _, p := range TagColorPalette {
			if p == c {
				found = true
				break
			}
		}
		if !found {
			return "", &hexError{"Color must be one of the predefined tag colors"}
		}
		return c, nil
	}

	// Valid palette colors
	v, err := normalizeHexColor("#e11d48")
	if err != nil || v != "#E11D48" {
		t.Fatalf("Expected #E11D48, got %q, %v", v, err)
	}

	v, err = normalizeHexColor(" #3b82f6 ")
	if err != nil || v != "#3B82F6" {
		t.Fatalf("Expected #3B82F6, got %q, %v", v, err)
	}

	// Invalid format
	_, err = normalizeHexColor("red")
	if err == nil || err.Error() != "Color must be a 6-digit hex value" {
		t.Fatalf("Expected hex format error, got %v", err)
	}

	_, err = normalizeHexColor("#FFF")
	if err == nil || err.Error() != "Color must be a 6-digit hex value" {
		t.Fatalf("Expected hex format error for short hex, got %v", err)
	}

	// Valid hex, not in palette
	_, err = normalizeHexColor("#000000")
	if err == nil || err.Error() != "Color must be one of the predefined tag colors" {
		t.Fatalf("Expected palette error, got %v", err)
	}
}

type hexError struct {
	msg string
}

func (e *hexError) Error() string { return e.msg }
