package oauth

import (
	"context"
	"errors"
	"slices"
	"strings"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// ClientRegistration is the subset of RFC 7591 client metadata Alcoves accepts.
type ClientRegistration struct {
	ClientName              string   `json:"client_name"`
	RedirectURIs            []string `json:"redirect_uris"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	Scope                   string   `json:"scope"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
}

// RegisterClient persists a new public client (Dynamic Client Registration,
// RFC 7591) and returns it with a freshly minted client_id.
func (s *Service) RegisterClient(ctx context.Context, reg ClientRegistration) (*models.OAuthClient, error) {
	if !s.cfg.DCREnabled {
		return nil, ErrDCRDisabled
	}
	if len(reg.RedirectURIs) == 0 {
		return nil, &Error{Code: "invalid_redirect_uri", Description: "at least one redirect_uri is required"}
	}
	for _, u := range reg.RedirectURIs {
		if err := s.validateRedirectURI(u); err != nil {
			return nil, err
		}
	}

	grantTypes := reg.GrantTypes
	if len(grantTypes) == 0 {
		grantTypes = []string{"authorization_code", "refresh_token"}
	}

	name := strings.TrimSpace(reg.ClientName)
	if name == "" {
		name = "MCP Client"
	}

	clientID, err := randomToken(clientIDPrefix)
	if err != nil {
		return nil, err
	}

	client := &models.OAuthClient{
		ClientID:                clientID,
		ClientName:              name,
		RedirectURIs:            reg.RedirectURIs,
		GrantTypes:              grantTypes,
		Scope:                   s.NormalizeScope(reg.Scope),
		TokenEndpointAuthMethod: "none",
		RegistrationVia:         "dcr",
	}
	if err := s.db.WithContext(ctx).Create(client).Error; err != nil {
		return nil, err
	}
	return client, nil
}

// GetClient looks up a client by its public client_id. Returns (nil, nil) when
// not found.
func (s *Service) GetClient(ctx context.Context, clientID string) (*models.OAuthClient, error) {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return nil, nil
	}
	var client models.OAuthClient
	err := s.db.WithContext(ctx).Where("client_id = ?", clientID).First(&client).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &client, nil
}

// RedirectAllowed reports whether redirectURI exactly matches one of the
// client's registered redirect URIs.
func RedirectAllowed(client *models.OAuthClient, redirectURI string) bool {
	return slices.Contains(client.RedirectURIs, redirectURI)
}
