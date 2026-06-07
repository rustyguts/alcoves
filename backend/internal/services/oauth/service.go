// Package oauth implements an OAuth 2.1 Authorization Server + Resource Server
// for Alcoves' MCP endpoint, per the MCP authorization spec (2025-06-18). It
// lets remote MCP clients (e.g. Claude's custom connector) authenticate via a
// browser consent flow instead of a pasted personal access token.
//
// Design notes:
//   - Public clients only (PKCE S256, no client secret). Clients self-register
//     via Dynamic Client Registration (RFC 7591).
//   - Codes and tokens follow the personal_access_tokens pattern: only a
//     SHA-256 hash is stored; the plaintext is returned once.
//   - Access tokens are opaque and audience-bound to the MCP resource; the
//     resource server (cmd/server) only accepts them at /api/mcp.
//   - The consent step reuses the user's existing Alcoves session. A stateless
//     HMAC "consent token" binds an approval to the validated request + user.
package oauth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	// MCPResourcePath is the path of the protected MCP resource, appended to the
	// issuer to form the RFC 8707 resource identifier.
	MCPResourcePath = "/api/mcp"

	// DefaultScope is the single coarse scope granted in v1 ("act as me via
	// MCP"). Per-tool, per-library RBAC still applies on every call.
	DefaultScope = "mcp"

	accessTokenPrefix  = "alc_oat_"
	refreshTokenPrefix = "alc_ort_"
	authCodePrefix     = "alc_oac_"
	clientIDPrefix     = "alc_oc_"

	consentTTL = 10 * time.Minute
)

// Config configures the OAuth service. Issuer is the public base URL; all
// advertised endpoint URLs are derived from it. Secret keys the consent-token
// HMAC (the session secret).
type Config struct {
	Enabled              bool
	Issuer               string
	AccessTTL            time.Duration
	RefreshTTL           time.Duration
	CodeTTL              time.Duration
	DCREnabled           bool
	AllowedRedirectHosts []string
	Secret               string
}

// Service is the OAuth authorization + resource server.
type Service struct {
	db  *gorm.DB
	cfg Config
}

// New constructs the service.
func New(db *gorm.DB, cfg Config) *Service {
	return &Service{db: db, cfg: cfg}
}

// Enabled reports whether the OAuth path is active.
func (s *Service) Enabled() bool { return s.cfg.Enabled }

// Issuer returns the canonical issuer URL (no trailing slash).
func (s *Service) Issuer() string { return strings.TrimRight(s.cfg.Issuer, "/") }

// Resource returns the RFC 8707 resource identifier for the MCP endpoint.
func (s *Service) Resource() string { return s.Issuer() + MCPResourcePath }

// SupportedScopes returns the scopes advertised in metadata.
func (s *Service) SupportedScopes() []string { return []string{DefaultScope} }

// Error is an OAuth protocol error (RFC 6749 §5.2 / §4.1.2.1). Code is the
// machine-readable error code; Description is human-readable.
type Error struct {
	Code        string
	Description string
}

func (e *Error) Error() string { return e.Code + ": " + e.Description }

var (
	ErrInvalidGrant     = &Error{Code: "invalid_grant", Description: "the authorization grant is invalid, expired, or revoked"}
	ErrInvalidClient    = &Error{Code: "invalid_client", Description: "unknown client"}
	ErrInvalidRequest   = &Error{Code: "invalid_request", Description: "the request is missing a required parameter or is malformed"}
	ErrUnsupportedGrant = &Error{Code: "unsupported_grant_type", Description: "unsupported grant_type"}
	ErrDCRDisabled      = &Error{Code: "access_denied", Description: "dynamic client registration is disabled on this server"}
)

// hashToken returns the hex SHA-256 of a token. Only the hash is ever stored.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// randomToken returns prefix + 32 bytes of base64url-encoded randomness.
func randomToken(prefix string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

// verifyPKCE checks an RFC 7636 code_verifier against a stored challenge. Only
// the S256 method is accepted (OAuth 2.1 forbids plain).
func verifyPKCE(challenge, method, verifier string) bool {
	if verifier == "" || challenge == "" {
		return false
	}
	if method != "S256" {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(computed), []byte(challenge)) == 1
}

// AuthorizeRequest holds the validated parameters of an authorization request.
type AuthorizeRequest struct {
	ClientID            string
	RedirectURI         string
	ResponseType        string
	CodeChallenge       string
	CodeChallengeMethod string
	Scope               string
	State               string
	Resource            string
}

// NewConsentToken mints a stateless, HMAC-signed token binding a consent
// approval to the validated request and the signed-in user. It is returned by
// the authorize endpoint and required by the decision endpoint, preventing a
// cross-site page from forging an approval.
func (s *Service) NewConsentToken(r AuthorizeRequest, userID uuid.UUID) string {
	exp := time.Now().Add(consentTTL).Unix()
	return s.signConsent(r, userID, exp)
}

// VerifyConsentToken validates a consent token against the request and user.
func (s *Service) VerifyConsentToken(token string, r AuthorizeRequest, userID uuid.UUID) bool {
	expStr, _, ok := strings.Cut(token, ".")
	if !ok {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return false
	}
	if time.Now().Unix() > exp {
		return false
	}
	expected := s.signConsent(r, userID, exp)
	return hmac.Equal([]byte(expected), []byte(token))
}

func (s *Service) signConsent(r AuthorizeRequest, userID uuid.UUID, exp int64) string {
	msg := strings.Join([]string{
		r.ClientID, r.RedirectURI, r.CodeChallenge, r.CodeChallengeMethod,
		r.Scope, r.Resource, r.State, userID.String(), strconv.FormatInt(exp, 10),
	}, "\n")
	mac := hmac.New(sha256.New, []byte(s.cfg.Secret))
	mac.Write([]byte(msg))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return strconv.FormatInt(exp, 10) + "." + sig
}

// isLoopback reports whether a hostname is a loopback address (used to permit
// http redirect URIs for native/desktop clients per OAuth 2.1). It parses the
// host as an IP literal rather than matching a "127." string prefix, so a
// publicly-resolvable spoof like "127.0.0.1.attacker.com" is NOT treated as
// loopback (which would otherwise bypass the https requirement + host allowlist).
func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func hostAllowed(host string, allowed []string) bool {
	for _, a := range allowed {
		if strings.EqualFold(host, a) {
			return true
		}
	}
	return false
}

// validateRedirectURI enforces OAuth 2.1 redirect rules: absolute URL, no
// fragment, https (except loopback), and the optional host allowlist.
func (s *Service) validateRedirectURI(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() || u.Host == "" {
		return &Error{Code: "invalid_redirect_uri", Description: "redirect_uri must be an absolute URL"}
	}
	if u.Fragment != "" || strings.Contains(raw, "#") {
		return &Error{Code: "invalid_redirect_uri", Description: "redirect_uri must not contain a fragment"}
	}
	host := u.Hostname()
	if u.Scheme != "https" && !isLoopback(host) {
		return &Error{Code: "invalid_redirect_uri", Description: "redirect_uri must use https (http allowed only for loopback)"}
	}
	if len(s.cfg.AllowedRedirectHosts) > 0 && !isLoopback(host) && !hostAllowed(host, s.cfg.AllowedRedirectHosts) {
		return &Error{Code: "invalid_redirect_uri", Description: "redirect_uri host is not allowed"}
	}
	return nil
}

// NormalizeScope reduces a requested scope string to the server's supported
// set: it splits on whitespace, drops unknown and duplicate tokens, and falls
// back to DefaultScope when nothing supported remains. This keeps the advertised
// scope set authoritative — a client cannot mint a token bearing a scope the AS
// never sanctioned — while staying lenient per RFC 6749 §3.3 (ignore unknown
// scopes rather than reject). It also guarantees the scope is duplicate-free,
// which the consent screen relies on for its keyed {#each}.
func (s *Service) NormalizeScope(requested string) string {
	supported := make(map[string]bool, len(s.SupportedScopes()))
	for _, sc := range s.SupportedScopes() {
		supported[sc] = true
	}
	seen := make(map[string]bool)
	kept := make([]string, 0)
	for _, tok := range strings.Fields(requested) {
		if supported[tok] && !seen[tok] {
			seen[tok] = true
			kept = append(kept, tok)
		}
	}
	if len(kept) == 0 {
		return DefaultScope
	}
	return strings.Join(kept, " ")
}
