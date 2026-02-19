package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

const (
	SessionMaxAge    = 30 * 24 * time.Hour // 30 days
	SessionCookie    = "alcoves-session"
	BcryptCost       = 10
)

// SessionPayload is what gets encrypted into the cookie.
type SessionPayload struct {
	SessionToken string `json:"st"`
	UserID       string `json:"uid"`
}

type Service struct {
	db        *gorm.DB
	aesgcm    cipher.AEAD
}

func NewService(db *gorm.DB, secret string) (*Service, error) {
	// Derive a 32-byte key from the secret using SHA-256
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	return &Service{db: db, aesgcm: aesgcm}, nil
}

// HashPassword hashes a password using bcrypt (compatible with existing bcryptjs hashes).
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword checks a password against a bcrypt hash.
func VerifyPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// CreateSession creates a DB session record and returns the session token.
func (s *Service) CreateSession(userID uuid.UUID, c echo.Context) (string, error) {
	sessionToken := uuid.New().String()
	ua := c.Request().Header.Get("User-Agent")
	ip := c.RealIP()

	session := models.Session{
		UserID:       userID,
		SessionToken: sessionToken,
		UserAgent:    strPtr(ua),
		IPAddress:    strPtr(ip),
		ExpiresAt:    time.Now().Add(SessionMaxAge),
	}

	if err := s.db.Create(&session).Error; err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}

	return sessionToken, nil
}

// ValidateSession checks a session token against the DB. Returns nil if invalid/expired.
func (s *Service) ValidateSession(sessionToken string) (*models.Session, error) {
	var session models.Session
	err := s.db.Where("session_token = ?", sessionToken).First(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if session.ExpiresAt.Before(time.Now()) {
		s.db.Delete(&session)
		return nil, nil
	}

	return &session, nil
}

// DeleteSession removes a session by token.
func (s *Service) DeleteSession(sessionToken string) error {
	return s.db.Where("session_token = ?", sessionToken).Delete(&models.Session{}).Error
}

// DeleteSessionByID removes a session by ID, verifying it belongs to the user.
func (s *Service) DeleteSessionByID(sessionID, userID uuid.UUID) error {
	return s.db.Where("id = ? AND user_id = ?", sessionID, userID).Delete(&models.Session{}).Error
}

// SetSessionCookie encrypts session data and sets it as a cookie.
func (s *Service) SetSessionCookie(c echo.Context, payload SessionPayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	nonce := make([]byte, s.aesgcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}

	ciphertext := s.aesgcm.Seal(nonce, nonce, data, nil)
	encoded := base64.URLEncoding.EncodeToString(ciphertext)

	c.SetCookie(&http.Cookie{
		Name:     SessionCookie,
		Value:    encoded,
		Path:     "/",
		HttpOnly: true,
		Secure:   c.Scheme() == "https",
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(SessionMaxAge.Seconds()),
	})

	return nil
}

// GetSessionFromCookie reads and decrypts the session cookie.
func (s *Service) GetSessionFromCookie(c echo.Context) (*SessionPayload, error) {
	cookie, err := c.Cookie(SessionCookie)
	if err != nil {
		return nil, err
	}

	ciphertext, err := base64.URLEncoding.DecodeString(cookie.Value)
	if err != nil {
		return nil, fmt.Errorf("invalid cookie encoding: %w", err)
	}

	nonceSize := s.aesgcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("cookie too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := s.aesgcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt cookie: %w", err)
	}

	var payload SessionPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		return nil, fmt.Errorf("invalid cookie payload: %w", err)
	}

	return &payload, nil
}

// ClearSessionCookie removes the session cookie.
func (s *Service) ClearSessionCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name:     SessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// GetUserBySession validates the cookie and DB session, returns the user.
func (s *Service) GetUserBySession(c echo.Context) (*models.User, string, error) {
	payload, err := s.GetSessionFromCookie(c)
	if err != nil {
		return nil, "", err
	}

	session, err := s.ValidateSession(payload.SessionToken)
	if err != nil {
		return nil, "", err
	}
	if session == nil {
		return nil, "", nil
	}

	var user models.User
	err = s.db.Where("id = ?", session.UserID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}

	return &user, payload.SessionToken, nil
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
