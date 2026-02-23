package filehash

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"
	"testing"
)

func TestHashingReader(t *testing.T) {
	data := "hello world"
	expected := sha256.Sum256([]byte(data))
	expectedHex := hex.EncodeToString(expected[:])

	hr := NewHashingReader(strings.NewReader(data))

	// Read all bytes
	buf, err := io.ReadAll(hr)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(buf) != data {
		t.Fatalf("expected data %q, got %q", data, string(buf))
	}

	got := hr.HexSum()
	if got != expectedHex {
		t.Fatalf("expected hash %s, got %s", expectedHex, got)
	}
}

func TestHashingReaderEmpty(t *testing.T) {
	expected := sha256.Sum256([]byte{})
	expectedHex := hex.EncodeToString(expected[:])

	hr := NewHashingReader(strings.NewReader(""))
	io.ReadAll(hr)

	if got := hr.HexSum(); got != expectedHex {
		t.Fatalf("expected hash %s, got %s", expectedHex, got)
	}
}
