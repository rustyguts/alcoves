// Package signing mints and verifies short-lived, single-resource HMAC tokens
// used to authorize out-of-band curl uploads/downloads of large files. A token
// is self-contained (carries its own claims + expiry) so a bare `curl` needs no
// cookie or bearer header. Access is authorized once, at mint time, by the
// caller; the token simply proves that authorization until it expires.
package signing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	opDownload = "dl"
	opUpload   = "ul"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
	ErrWrongOp      = errors.New("token not valid for this operation")
)

// Signer mints and verifies tokens with an HMAC-SHA256 key.
type Signer struct {
	key []byte
}

// New returns a Signer keyed by secret (typically ALCOVES_MCP_SIGNING_SECRET,
// falling back to ALCOVES_SESSION_SECRET).
func New(secret string) *Signer {
	sum := sha256.Sum256([]byte(secret))
	return &Signer{key: sum[:]}
}

// claims is the wire payload embedded in every token.
type claims struct {
	Op       string `json:"op"`
	Lib      string `json:"lib"`
	File     string `json:"file,omitempty"`   // download target
	Owner    string `json:"own,omitempty"`    // upload: owner user id
	Folder   string `json:"folder,omitempty"` // upload: destination folder
	Name     string `json:"name,omitempty"`   // upload: filename
	MimeType string `json:"mime,omitempty"`   // upload
	MaxSize  int64  `json:"max,omitempty"`    // upload: byte cap (0 = unlimited)
	Exp      int64  `json:"exp"`              // unix seconds
}

// DownloadClaims is returned by VerifyDownload.
type DownloadClaims struct {
	LibraryID uuid.UUID
	FileID    uuid.UUID
}

// UploadClaims describes a signed upload destination.
type UploadClaims struct {
	LibraryID uuid.UUID
	OwnerID   uuid.UUID
	FolderID  *uuid.UUID
	Name      string
	MimeType  string
	MaxSize   int64
}

func (s *Signer) encode(c claims) string {
	payload, _ := json.Marshal(c)
	body := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(body))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return body + "." + sig
}

func (s *Signer) decode(token string) (*claims, error) {
	body, sig, ok := strings.Cut(token, ".")
	if !ok || body == "" || sig == "" {
		return nil, ErrInvalidToken
	}
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(body))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(sig)) {
		return nil, ErrInvalidToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return nil, ErrInvalidToken
	}
	var c claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, ErrInvalidToken
	}
	if time.Now().Unix() > c.Exp {
		return nil, ErrExpiredToken
	}
	return &c, nil
}

// SignDownload mints a token authorizing a GET of one file until expiresAt.
func (s *Signer) SignDownload(libraryID, fileID uuid.UUID, expiresAt time.Time) string {
	return s.encode(claims{
		Op:   opDownload,
		Lib:  libraryID.String(),
		File: fileID.String(),
		Exp:  expiresAt.Unix(),
	})
}

// SignUpload mints a token authorizing a single PUT into a library until expiresAt.
func (s *Signer) SignUpload(c UploadClaims, expiresAt time.Time) string {
	cl := claims{
		Op:       opUpload,
		Lib:      c.LibraryID.String(),
		Owner:    c.OwnerID.String(),
		Name:     c.Name,
		MimeType: c.MimeType,
		MaxSize:  c.MaxSize,
		Exp:      expiresAt.Unix(),
	}
	if c.FolderID != nil {
		cl.Folder = c.FolderID.String()
	}
	return s.encode(cl)
}

// VerifyDownload validates a download token and returns its target.
func (s *Signer) VerifyDownload(token string) (*DownloadClaims, error) {
	c, err := s.decode(token)
	if err != nil {
		return nil, err
	}
	if c.Op != opDownload {
		return nil, ErrWrongOp
	}
	lib, err := uuid.Parse(c.Lib)
	if err != nil {
		return nil, ErrInvalidToken
	}
	file, err := uuid.Parse(c.File)
	if err != nil {
		return nil, ErrInvalidToken
	}
	return &DownloadClaims{LibraryID: lib, FileID: file}, nil
}

// VerifyUpload validates an upload token and returns its destination claims.
func (s *Signer) VerifyUpload(token string) (*UploadClaims, error) {
	c, err := s.decode(token)
	if err != nil {
		return nil, err
	}
	if c.Op != opUpload {
		return nil, ErrWrongOp
	}
	lib, err := uuid.Parse(c.Lib)
	if err != nil {
		return nil, ErrInvalidToken
	}
	owner, err := uuid.Parse(c.Owner)
	if err != nil {
		return nil, ErrInvalidToken
	}
	out := &UploadClaims{
		LibraryID: lib,
		OwnerID:   owner,
		Name:      c.Name,
		MimeType:  c.MimeType,
		MaxSize:   c.MaxSize,
	}
	if c.Folder != "" {
		folder, err := uuid.Parse(c.Folder)
		if err != nil {
			return nil, ErrInvalidToken
		}
		out.FolderID = &folder
	}
	return out, nil
}
