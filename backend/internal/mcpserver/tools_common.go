package mcpserver

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// itoa renders an int as its base-10 string (used to feed the listing services'
// raw string params from typed MCP inputs).
func itoa(n int) string { return strconv.Itoa(n) }

// shellSingleQuote wraps s in POSIX single quotes, escaping embedded single
// quotes (' → '\”), so a value (e.g. a file name) interpolated into a curl
// command we hand to the model is a single safe shell token even if it contains
// quotes, spaces, or other metacharacters.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// parseUUIDArg parses a UUID argument, returning a consistent, model-friendly
// error naming the offending field.
func parseUUIDArg(field, val string) (uuid.UUID, error) {
	id, err := uuid.Parse(val)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid %s: %q (expected a UUID)", field, val)
	}
	return id, nil
}

// rfc3339 formats a time as RFC3339Nano (matching the HTTP API's serialization).
func rfc3339(t time.Time) string { return t.Format(time.RFC3339Nano) }

// rfc3339Ptr formats a *time.Time, or returns nil for a nil input.
func rfc3339Ptr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339Nano)
	return &s
}

// uuidStrPtr renders a *uuid.UUID as a *string, nil-preserving.
func uuidStrPtr(u *uuid.UUID) *string {
	if u == nil {
		return nil
	}
	s := u.String()
	return &s
}

// errFileNotFound is the canonical "file missing in this library" error,
// phrased identically whether the file truly does not exist or belongs to a
// library the caller cannot see (access is checked separately, before this).
func errFileNotFound(fileID uuid.UUID) error {
	return fmt.Errorf("file %s not found in this library", fileID)
}

// fileExists reports whether a non-derived file with id exists in the library,
// regardless of trash state. Used by tools that must confirm a file belongs to
// the caller's library before acting on a related resource.
func (d Deps) fileExists(libraryID, fileID uuid.UUID) (bool, error) {
	var count int64
	if err := d.DB.Model(&models.File{}).
		Where("id = ? AND library_id = ?", fileID, libraryID).
		Count(&count).Error; err != nil {
		return false, fmt.Errorf("failed to look up file")
	}
	return count > 0, nil
}
