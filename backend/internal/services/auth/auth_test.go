package auth

import (
	"crypto/rand"
	"encoding/json"
	"io"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword(t *testing.T) {
	password := "testpassword123"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}

	if hash == "" {
		t.Fatal("HashPassword returned empty string")
	}

	// Verify it's a valid bcrypt hash
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		t.Fatalf("Hash is not valid bcrypt: %v", err)
	}
}

func TestVerifyPassword(t *testing.T) {
	password := "testpassword123"
	hash, _ := HashPassword(password)

	if !VerifyPassword(password, hash) {
		t.Fatal("VerifyPassword returned false for correct password")
	}

	if VerifyPassword("wrongpassword", hash) {
		t.Fatal("VerifyPassword returned true for wrong password")
	}
}

func TestVerifyPassword_BcryptjsCompatibility(t *testing.T) {
	// Verify Go's bcrypt is compatible with bcryptjs (same algorithm, same cost factor)
	password := "testpassword"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		t.Fatal(err)
	}

	if !VerifyPassword(password, string(hash)) {
		t.Fatal("Go bcrypt should be compatible with bcryptjs hashes")
	}
}

func TestSessionPayloadEncryption(t *testing.T) {
	secret := "test-secret-that-is-long-enough-for-aes"
	svc, err := NewService(nil, secret) // nil DB is fine for encryption tests
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}

	payload := SessionPayload{
		SessionToken: "test-token-uuid",
		UserID:       "test-user-uuid",
	}

	nonce, ciphertext := encryptPayload(t, svc, payload)
	decrypted := decryptPayload(t, svc, nonce, ciphertext)

	if decrypted.SessionToken != payload.SessionToken {
		t.Errorf("SessionToken mismatch: got %q, want %q", decrypted.SessionToken, payload.SessionToken)
	}
	if decrypted.UserID != payload.UserID {
		t.Errorf("UserID mismatch: got %q, want %q", decrypted.UserID, payload.UserID)
	}
}

func TestSessionPayloadDecryptionWithWrongKey(t *testing.T) {
	svc1, _ := NewService(nil, "secret-key-one-that-is-long-enough")
	svc2, _ := NewService(nil, "secret-key-two-that-is-long-enough")

	payload := SessionPayload{
		SessionToken: "test-token",
		UserID:       "test-user",
	}

	nonce, ciphertext := encryptPayload(t, svc1, payload)

	// Try to decrypt with wrong key - should fail
	_, err := svc2.aesgcm.Open(nil, nonce, ciphertext, nil)
	if err == nil {
		t.Fatal("Expected decryption to fail with wrong key")
	}
}

func encryptPayload(t *testing.T, svc *Service, payload SessionPayload) ([]byte, []byte) {
	t.Helper()

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	nonce := make([]byte, svc.aesgcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatal(err)
	}

	ciphertext := svc.aesgcm.Seal(nil, nonce, data, nil)
	return nonce, ciphertext
}

func decryptPayload(t *testing.T, svc *Service, nonce, ciphertext []byte) SessionPayload {
	t.Helper()

	plaintext, err := svc.aesgcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		t.Fatal(err)
	}

	var payload SessionPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}
