package oauth

import "github.com/modelcontextprotocol/go-sdk/oauthex"

// ProtectedResourceMetadata builds the RFC 9728 document served at
// /.well-known/oauth-protected-resource. It points MCP clients at this server
// as the authorization server for the /api/mcp resource.
func (s *Service) ProtectedResourceMetadata() *oauthex.ProtectedResourceMetadata {
	return &oauthex.ProtectedResourceMetadata{
		Resource:               s.Resource(),
		AuthorizationServers:   []string{s.Issuer()},
		ScopesSupported:        s.SupportedScopes(),
		BearerMethodsSupported: []string{"header"},
		ResourceName:           "Alcoves MCP",
	}
}

// AuthServerMetadata is the RFC 8414 authorization-server metadata document.
// Hand-rolled (rather than oauthex.AuthServerMeta) so we can omit jwks_uri —
// Alcoves issues opaque tokens, so there is no JWK set.
type AuthServerMetadata struct {
	Issuer                            string   `json:"issuer"`
	AuthorizationEndpoint             string   `json:"authorization_endpoint"`
	TokenEndpoint                     string   `json:"token_endpoint"`
	RegistrationEndpoint              string   `json:"registration_endpoint,omitempty"`
	RevocationEndpoint                string   `json:"revocation_endpoint,omitempty"`
	ScopesSupported                   []string `json:"scopes_supported"`
	ResponseTypesSupported            []string `json:"response_types_supported"`
	GrantTypesSupported               []string `json:"grant_types_supported"`
	TokenEndpointAuthMethodsSupported []string `json:"token_endpoint_auth_methods_supported"`
	CodeChallengeMethodsSupported     []string `json:"code_challenge_methods_supported"`
}

// AuthServerMetadata builds the document served at
// /.well-known/oauth-authorization-server. The authorization endpoint is the
// browser-facing SvelteKit consent page; token/register/revoke are JSON APIs.
func (s *Service) AuthServerMetadata() AuthServerMetadata {
	base := s.Issuer()
	m := AuthServerMetadata{
		Issuer:                            base,
		AuthorizationEndpoint:             base + "/oauth/authorize",
		TokenEndpoint:                     base + "/api/oauth/token",
		RevocationEndpoint:                base + "/api/oauth/revoke",
		ScopesSupported:                   s.SupportedScopes(),
		ResponseTypesSupported:            []string{"code"},
		GrantTypesSupported:               []string{"authorization_code", "refresh_token"},
		TokenEndpointAuthMethodsSupported: []string{"none"},
		CodeChallengeMethodsSupported:     []string{"S256"},
	}
	if s.cfg.DCREnabled {
		m.RegistrationEndpoint = base + "/api/oauth/register"
	}
	return m
}
