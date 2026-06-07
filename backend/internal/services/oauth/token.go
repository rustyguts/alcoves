package oauth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// TokenResult is the successful output of the token endpoint.
type TokenResult struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int
	Scope        string
}

// IssueCode mints a single-use authorization code for an approved request.
func (s *Service) IssueCode(ctx context.Context, userID uuid.UUID, r AuthorizeRequest) (string, error) {
	code, err := randomToken(authCodePrefix)
	if err != nil {
		return "", err
	}
	rec := &models.OAuthAuthorizationCode{
		CodeHash:            hashToken(code),
		ClientID:            r.ClientID,
		UserID:              userID,
		RedirectURI:         r.RedirectURI,
		CodeChallenge:       r.CodeChallenge,
		CodeChallengeMethod: r.CodeChallengeMethod,
		Scope:               r.Scope,
		Resource:            r.Resource,
		ExpiresAt:           time.Now().Add(s.cfg.CodeTTL),
	}
	if err := s.db.WithContext(ctx).Create(rec).Error; err != nil {
		return "", err
	}
	return code, nil
}

// ExchangeCode validates an authorization code (RFC 7636 PKCE, exact client +
// redirect match, single-use) and issues an access/refresh token pair.
func (s *Service) ExchangeCode(ctx context.Context, clientID, code, redirectURI, verifier string) (*TokenResult, error) {
	var rec models.OAuthAuthorizationCode
	err := s.db.WithContext(ctx).Where("code_hash = ?", hashToken(code)).First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrInvalidGrant
	}
	if err != nil {
		return nil, err
	}

	if rec.ConsumedAt != nil || time.Now().After(rec.ExpiresAt) ||
		rec.ClientID != clientID || rec.RedirectURI != redirectURI ||
		!verifyPKCE(rec.CodeChallenge, rec.CodeChallengeMethod, verifier) {
		return nil, ErrInvalidGrant
	}

	// Atomically mark consumed and issue the token pair in one transaction: a
	// zero row count means another request already spent it (replay) — reject;
	// and if minting fails, the consumption rolls back so the client can retry
	// the still-unexpired code instead of being stranded.
	var out *TokenResult
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&models.OAuthAuthorizationCode{}).
			Where("id = ? AND consumed_at IS NULL", rec.ID).
			Update("consumed_at", time.Now())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrInvalidGrant
		}
		pair, perr := s.issuePair(tx, clientID, rec.UserID, rec.Scope, rec.Resource, nil)
		if perr != nil {
			return perr
		}
		out = pair
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Refresh validates a refresh token, rotates it (revoking the old one), and
// issues a new pair. Reuse of an already-revoked token revokes the whole chain
// for that client+user (RFC 9700 reuse detection).
func (s *Service) Refresh(ctx context.Context, clientID, refreshToken string) (*TokenResult, error) {
	var rt models.OAuthRefreshToken
	err := s.db.WithContext(ctx).Where("token_hash = ?", hashToken(refreshToken)).First(&rt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrInvalidGrant
	}
	if err != nil {
		return nil, err
	}
	if rt.ClientID != clientID {
		return nil, ErrInvalidGrant
	}
	if rt.RevokedAt != nil {
		// Reuse of a rotated/revoked token — revoke every refresh token for this
		// client+user as a precaution, then reject.
		_ = s.revokeChain(ctx, rt.UserID, clientID)
		return nil, ErrInvalidGrant
	}
	if time.Now().After(rt.ExpiresAt) {
		return nil, ErrInvalidGrant
	}

	// Rotate (revoke the presented token) and mint the replacement pair in one
	// transaction: a zero row count means a concurrent rotation already spent it.
	var out *TokenResult
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&models.OAuthRefreshToken{}).
			Where("id = ? AND revoked_at IS NULL", rt.ID).
			Update("revoked_at", time.Now())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrInvalidGrant
		}
		pair, perr := s.issuePair(tx, clientID, rt.UserID, rt.Scope, s.Resource(), &rt.ID)
		if perr != nil {
			return perr
		}
		out = pair
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// issuePair mints a refresh token then an access token bound to it, on the
// provided handle (a transaction, so a partial mint rolls back atomically).
func (s *Service) issuePair(tx *gorm.DB, clientID string, userID uuid.UUID, scope, resource string, rotatedFrom *uuid.UUID) (*TokenResult, error) {
	if scope == "" {
		scope = DefaultScope
	}
	if resource == "" {
		resource = s.Resource()
	}

	refreshPlain, err := randomToken(refreshTokenPrefix)
	if err != nil {
		return nil, err
	}
	refresh := &models.OAuthRefreshToken{
		TokenHash:   hashToken(refreshPlain),
		ClientID:    clientID,
		UserID:      userID,
		Scope:       scope,
		ExpiresAt:   time.Now().Add(s.cfg.RefreshTTL),
		RotatedFrom: rotatedFrom,
	}
	if err := tx.Create(refresh).Error; err != nil {
		return nil, err
	}

	accessPlain, err := randomToken(accessTokenPrefix)
	if err != nil {
		return nil, err
	}
	access := &models.OAuthAccessToken{
		TokenHash:      hashToken(accessPlain),
		ClientID:       clientID,
		UserID:         userID,
		Scope:          scope,
		Resource:       resource,
		ExpiresAt:      time.Now().Add(s.cfg.AccessTTL),
		RefreshTokenID: &refresh.ID,
	}
	if err := tx.Create(access).Error; err != nil {
		return nil, err
	}

	return &TokenResult{
		AccessToken:  accessPlain,
		RefreshToken: refreshPlain,
		TokenType:    "Bearer",
		ExpiresIn:    int(s.cfg.AccessTTL.Seconds()),
		Scope:        scope,
	}, nil
}

// ValidateAccessToken resolves a presented access token to its user, used by
// the resource server at /api/mcp. Returns (nil, nil, nil) for an unknown,
// malformed, or expired token (mirroring auth.ValidateMCPToken).
func (s *Service) ValidateAccessToken(ctx context.Context, token string) (*models.User, *models.OAuthAccessToken, error) {
	token = strings.TrimSpace(token)
	if token == "" || !strings.HasPrefix(token, accessTokenPrefix) {
		return nil, nil, nil
	}
	var at models.OAuthAccessToken
	err := s.db.WithContext(ctx).Where("token_hash = ?", hashToken(token)).First(&at).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if time.Now().After(at.ExpiresAt) {
		return nil, nil, nil
	}
	// Audience binding (RFC 8707): only honor tokens minted for this server's
	// MCP resource. The authorize endpoint enforces this at mint time, so a
	// mismatch here means a stale/foreign-audience row — reject it.
	if at.Resource != "" && at.Resource != s.Resource() {
		return nil, nil, nil
	}

	var user models.User
	err = s.db.WithContext(ctx).Where("id = ?", at.UserID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}

	now := time.Now()
	s.db.WithContext(ctx).Model(&models.OAuthAccessToken{}).
		Where("id = ?", at.ID).Update("last_used_at", now)

	return &user, &at, nil
}

// revokeChain revokes every (still-active) refresh token for a client+user AND
// deletes that client+user's access tokens. Reuse detection means the chain is
// compromised, so the short-lived access tokens must not outlive the revocation
// (otherwise a thief keeps MCP access for up to AccessTTL after detection).
func (s *Service) revokeChain(ctx context.Context, userID uuid.UUID, clientID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.OAuthRefreshToken{}).
			Where("user_id = ? AND client_id = ? AND revoked_at IS NULL", userID, clientID).
			Update("revoked_at", time.Now()).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ? AND client_id = ?", userID, clientID).
			Delete(&models.OAuthAccessToken{}).Error
	})
}

// Connection summarizes a client a user has authorized, for the profile UI.
type Connection struct {
	ClientID   string     `json:"clientId"`
	ClientName string     `json:"clientName"`
	Scope      string     `json:"scope"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

// ListConnections returns the distinct clients a user has live (non-expired)
// access tokens for, newest first.
func (s *Service) ListConnections(ctx context.Context, userID uuid.UUID) ([]Connection, error) {
	var rows []struct {
		ClientID   string
		ClientName string
		Scope      string
		LastUsedAt *time.Time
		CreatedAt  time.Time
	}
	err := s.db.WithContext(ctx).
		Model(&models.OAuthAccessToken{}).
		Select("oauth_access_tokens.client_id AS client_id, "+
			"COALESCE(oauth_clients.client_name, oauth_access_tokens.client_id) AS client_name, "+
			"MAX(oauth_access_tokens.scope) AS scope, "+
			"MAX(oauth_access_tokens.last_used_at) AS last_used_at, "+
			"MIN(oauth_access_tokens.created_at) AS created_at").
		Joins("LEFT JOIN oauth_clients ON oauth_clients.client_id = oauth_access_tokens.client_id").
		Where("oauth_access_tokens.user_id = ? AND oauth_access_tokens.expires_at > ?", userID, time.Now()).
		Group("oauth_access_tokens.client_id, oauth_clients.client_name").
		Order("created_at DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]Connection, 0, len(rows))
	for _, r := range rows {
		out = append(out, Connection{
			ClientID:   r.ClientID,
			ClientName: r.ClientName,
			Scope:      r.Scope,
			LastUsedAt: r.LastUsedAt,
			CreatedAt:  r.CreatedAt,
		})
	}
	return out, nil
}

// RevokeConnection deletes every access and refresh token a user holds for a
// given client (the profile "disconnect" action).
func (s *Service) RevokeConnection(ctx context.Context, userID uuid.UUID, clientID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND client_id = ?", userID, clientID).
			Delete(&models.OAuthAccessToken{}).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ? AND client_id = ?", userID, clientID).
			Delete(&models.OAuthRefreshToken{}).Error
	})
}

// RevokeToken implements RFC 7009 for a single access or refresh token. Unknown
// tokens are a no-op (the RFC mandates a 200 either way).
func (s *Service) RevokeToken(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	switch {
	case strings.HasPrefix(token, accessTokenPrefix):
		return s.db.WithContext(ctx).Where("token_hash = ?", hashToken(token)).
			Delete(&models.OAuthAccessToken{}).Error
	case strings.HasPrefix(token, refreshTokenPrefix):
		var rt models.OAuthRefreshToken
		err := s.db.WithContext(ctx).Where("token_hash = ?", hashToken(token)).First(&rt).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		// Revoke the refresh token and delete the access token it minted, so
		// revocation cuts live access immediately rather than after AccessTTL.
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&models.OAuthRefreshToken{}).
				Where("id = ?", rt.ID).Update("revoked_at", time.Now()).Error; err != nil {
				return err
			}
			return tx.Where("refresh_token_id = ?", rt.ID).
				Delete(&models.OAuthAccessToken{}).Error
		})
	default:
		return nil
	}
}
