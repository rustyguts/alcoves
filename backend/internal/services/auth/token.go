package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// PATPrefix prefixes every personal access token so it is recognizable in
// configs/logs and can be cheaply rejected when an obviously-wrong value is
// presented.
const PATPrefix = "alc_pat_"

// hashToken returns the hex SHA-256 of a token. Only the hash is ever stored.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreatePersonalAccessToken mints a new PAT for the user, stores only its hash,
// and returns the plaintext token exactly once. expiresAt may be nil (never
// expires).
func (s *Service) CreatePersonalAccessToken(userID uuid.UUID, name string, expiresAt *time.Time) (string, *models.PersonalAccessToken, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil, fmt.Errorf("token name is required")
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("failed to generate token: %w", err)
	}
	plaintext := PATPrefix + base64.RawURLEncoding.EncodeToString(raw)

	pat := &models.PersonalAccessToken{
		UserID:    userID,
		TokenHash: hashToken(plaintext),
		Name:      name,
		ExpiresAt: expiresAt,
	}
	if err := s.db.Create(pat).Error; err != nil {
		return "", nil, fmt.Errorf("failed to store token: %w", err)
	}
	return plaintext, pat, nil
}

// ValidateMCPToken resolves a presented personal access token to its user.
// Returns (nil, nil) for an unknown, malformed, or expired token (mirroring
// ValidateSession's "nil means invalid" convention). last_used_at is updated
// best-effort on success.
func (s *Service) ValidateMCPToken(ctx context.Context, token string) (*models.User, error) {
	token = strings.TrimSpace(token)
	if token == "" || !strings.HasPrefix(token, PATPrefix) {
		return nil, nil
	}

	var pat models.PersonalAccessToken
	err := s.db.WithContext(ctx).Where("token_hash = ?", hashToken(token)).First(&pat).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if pat.ExpiresAt != nil && pat.ExpiresAt.Before(time.Now()) {
		return nil, nil
	}

	var user models.User
	err = s.db.WithContext(ctx).Where("id = ?", pat.UserID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Best-effort last-used bookkeeping; never fail the request on this.
	now := time.Now()
	s.db.WithContext(ctx).Model(&models.PersonalAccessToken{}).
		Where("id = ?", pat.ID).Update("last_used_at", now)

	return &user, nil
}
