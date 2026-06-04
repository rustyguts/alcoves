package signing

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSignDownload_RoundTrip(t *testing.T) {
	s := New("test-secret")
	lib, file := uuid.New(), uuid.New()

	token := s.SignDownload(lib, file, time.Now().Add(time.Hour))
	claims, err := s.VerifyDownload(token)
	if err != nil {
		t.Fatalf("VerifyDownload: %v", err)
	}
	if claims.LibraryID != lib || claims.FileID != file {
		t.Fatalf("claims mismatch: got lib=%s file=%s", claims.LibraryID, claims.FileID)
	}
}

func TestSignUpload_RoundTrip(t *testing.T) {
	s := New("test-secret")
	lib, owner, folder := uuid.New(), uuid.New(), uuid.New()

	token := s.SignUpload(UploadClaims{
		LibraryID: lib, OwnerID: owner, FolderID: &folder,
		Name: "movie.mp4", MimeType: "video/mp4", MaxSize: 1 << 30,
	}, time.Now().Add(time.Hour))

	claims, err := s.VerifyUpload(token)
	if err != nil {
		t.Fatalf("VerifyUpload: %v", err)
	}
	if claims.LibraryID != lib || claims.OwnerID != owner || claims.FolderID == nil || *claims.FolderID != folder {
		t.Fatalf("upload claims mismatch: %+v", claims)
	}
	if claims.Name != "movie.mp4" || claims.MimeType != "video/mp4" || claims.MaxSize != 1<<30 {
		t.Fatalf("upload claims fields mismatch: %+v", claims)
	}
}

func TestVerify_Expired(t *testing.T) {
	s := New("test-secret")
	token := s.SignDownload(uuid.New(), uuid.New(), time.Now().Add(-time.Minute))
	if _, err := s.VerifyDownload(token); err != ErrExpiredToken {
		t.Fatalf("expected ErrExpiredToken, got %v", err)
	}
}

func TestVerify_Tampered(t *testing.T) {
	s := New("test-secret")
	token := s.SignDownload(uuid.New(), uuid.New(), time.Now().Add(time.Hour))

	// Flip a character in the payload portion.
	body, sig, _ := strings.Cut(token, ".")
	tampered := body[:len(body)-1] + flip(body[len(body)-1:]) + "." + sig
	if _, err := s.VerifyDownload(tampered); err != ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken for tampered body, got %v", err)
	}

	// A different key must reject a validly-signed token.
	other := New("different-secret")
	if _, err := other.VerifyDownload(token); err != ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken under wrong key, got %v", err)
	}
}

func TestVerify_WrongOp(t *testing.T) {
	s := New("test-secret")
	dl := s.SignDownload(uuid.New(), uuid.New(), time.Now().Add(time.Hour))
	if _, err := s.VerifyUpload(dl); err != ErrWrongOp {
		t.Fatalf("expected ErrWrongOp verifying a download token as upload, got %v", err)
	}
	ul := s.SignUpload(UploadClaims{LibraryID: uuid.New(), OwnerID: uuid.New()}, time.Now().Add(time.Hour))
	if _, err := s.VerifyDownload(ul); err != ErrWrongOp {
		t.Fatalf("expected ErrWrongOp verifying an upload token as download, got %v", err)
	}
}

func TestVerify_Garbage(t *testing.T) {
	s := New("test-secret")
	for _, bad := range []string{"", "no-dot", ".", "a.", ".b"} {
		if _, err := s.VerifyDownload(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func flip(s string) string {
	if s == "A" {
		return "B"
	}
	return "A"
}
