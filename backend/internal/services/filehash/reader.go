package filehash

import (
	"crypto/sha256"
	"encoding/hex"
	"hash"
	"io"
)

// HashingReader wraps an io.Reader and computes a SHA256 hash as bytes are read.
// After the underlying reader is fully consumed, call HexSum to get the hash.
type HashingReader struct {
	r io.Reader
	h hash.Hash
}

// NewHashingReader wraps r so every Read feeds bytes through SHA256.
func NewHashingReader(r io.Reader) *HashingReader {
	h := sha256.New()
	return &HashingReader{
		r: io.TeeReader(r, h),
		h: h,
	}
}

func (hr *HashingReader) Read(p []byte) (int, error) {
	return hr.r.Read(p)
}

// HexSum returns the hex-encoded SHA256 digest. Only valid after the reader
// has been fully consumed (all bytes read until EOF).
func (hr *HashingReader) HexSum() string {
	return hex.EncodeToString(hr.h.Sum(nil))
}
