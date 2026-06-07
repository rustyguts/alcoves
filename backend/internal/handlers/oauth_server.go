package handlers

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	oauthservice "github.com/alcoves/alcoves-backend/internal/services/oauth"
)

// OAuthServerHandler implements Alcoves' OAuth 2.1 Authorization Server for MCP
// connections (distinct from oauth.go, which is the Google-login OAuth *client*).
//
// Route auth model (enforced by the global AuthMiddleware skip list):
//   - public (no session): /token, /register, /revoke — called by the client's
//     backend, authenticated by the grant itself (PKCE / refresh token).
//   - session-required: /authorize, /authorize/decision, /connections — the
//     human consents in the browser using their existing Alcoves session.
type OAuthServerHandler struct {
	oauth *oauthservice.Service
}

func NewOAuthServerHandler(oauthSvc *oauthservice.Service) *OAuthServerHandler {
	return &OAuthServerHandler{oauth: oauthSvc}
}

func (h *OAuthServerHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/authorize", h.Authorize)
	g.POST("/authorize/decision", h.Decision)
	g.POST("/token", h.Token)
	g.POST("/register", h.Register)
	g.POST("/revoke", h.Revoke)
	g.GET("/connections", h.ListConnections)
	g.DELETE("/connections/:clientId", h.RevokeConnection)
}

// RegisterWellKnown mounts the discovery documents at the domain root (not under
// /api). These are public and CORS-open for client discovery (RFC 9728 §3.1).
func (h *OAuthServerHandler) RegisterWellKnown(e *echo.Echo) {
	prm := func(c echo.Context) error {
		c.Response().Header().Set("Access-Control-Allow-Origin", "*")
		return c.JSON(http.StatusOK, h.oauth.ProtectedResourceMetadata())
	}
	e.GET("/.well-known/oauth-protected-resource", prm)
	// RFC 9728 also allows the resource path appended to the well-known prefix.
	e.GET("/.well-known/oauth-protected-resource/api/mcp", prm)
	e.GET("/.well-known/oauth-authorization-server", func(c echo.Context) error {
		c.Response().Header().Set("Access-Control-Allow-Origin", "*")
		return c.JSON(http.StatusOK, h.oauth.AuthServerMetadata())
	})
}

// --- Authorization endpoint (browser, session-required) ---

// Authorize validates an authorization request and returns the data the consent
// screen needs plus a signed consent token. The browser must already carry a
// valid Alcoves session (the SvelteKit consent page redirects anon users to
// /login first); the global middleware enforces that.
func (h *OAuthServerHandler) Authorize(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	r := oauthservice.AuthorizeRequest{
		ClientID:            c.QueryParam("client_id"),
		RedirectURI:         c.QueryParam("redirect_uri"),
		ResponseType:        defaultStr(c.QueryParam("response_type"), "code"),
		CodeChallenge:       c.QueryParam("code_challenge"),
		CodeChallengeMethod: c.QueryParam("code_challenge_method"),
		Scope:               c.QueryParam("scope"),
		State:               c.QueryParam("state"),
		Resource:            c.QueryParam("resource"),
	}

	client, verr := h.validateAuthorize(c, &r)
	if verr != nil {
		// The client/redirect could not be trusted, so we must NOT redirect the
		// error back — render it to the consent page instead.
		return writeOAuthError(c, verr)
	}

	token := h.oauth.NewConsentToken(r, userID)
	return c.JSON(http.StatusOK, map[string]any{
		"consentToken": token,
		"client": map[string]any{
			"clientId":   client.ClientID,
			"clientName": client.ClientName,
		},
		"scopes":      strings.Fields(r.Scope),
		"redirectUri": r.RedirectURI,
		"state":       r.State,
	})
}

// validateAuthorize checks the request and normalizes r in place.
func (h *OAuthServerHandler) validateAuthorize(c echo.Context, r *oauthservice.AuthorizeRequest) (*clientView, error) {
	if r.ResponseType != "code" {
		return nil, &oauthservice.Error{Code: "unsupported_response_type", Description: "only response_type=code is supported"}
	}
	if r.CodeChallenge == "" {
		return nil, &oauthservice.Error{Code: "invalid_request", Description: "a PKCE code_challenge is required"}
	}
	if r.CodeChallengeMethod == "" {
		r.CodeChallengeMethod = "S256"
	}
	if r.CodeChallengeMethod != "S256" {
		return nil, &oauthservice.Error{Code: "invalid_request", Description: "code_challenge_method must be S256"}
	}
	if r.Scope == "" {
		r.Scope = oauthservice.DefaultScope
	}
	if r.Resource == "" {
		r.Resource = h.oauth.Resource()
	}

	client, err := h.oauth.GetClient(c.Request().Context(), r.ClientID)
	if err != nil {
		return nil, err
	}
	if client == nil {
		return nil, oauthservice.ErrInvalidClient
	}
	if !oauthservice.RedirectAllowed(client, r.RedirectURI) {
		return nil, &oauthservice.Error{Code: "invalid_redirect_uri", Description: "redirect_uri does not match a registered URI"}
	}
	return &clientView{ClientID: client.ClientID, ClientName: client.ClientName}, nil
}

type clientView struct {
	ClientID   string
	ClientName string
}

type decisionRequest struct {
	ConsentToken        string `json:"consentToken"`
	Approve             bool   `json:"approve"`
	ClientID            string `json:"clientId"`
	RedirectURI         string `json:"redirectUri"`
	CodeChallenge       string `json:"codeChallenge"`
	CodeChallengeMethod string `json:"codeChallengeMethod"`
	Scope               string `json:"scope"`
	State               string `json:"state"`
	Resource            string `json:"resource"`
}

// Decision finalizes consent. The consent token (bound to the request + user)
// guards against cross-site forgery; we re-validate the client and redirect for
// defense in depth, then either issue a code or signal denial. We return the
// redirect target as JSON so the browser performs the navigation.
func (h *OAuthServerHandler) Decision(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var req decisionRequest
	if err := c.Bind(&req); err != nil {
		return writeOAuthError(c, &oauthservice.Error{Code: "invalid_request", Description: "malformed body"})
	}

	r := oauthservice.AuthorizeRequest{
		ClientID:            req.ClientID,
		RedirectURI:         req.RedirectURI,
		ResponseType:        "code",
		CodeChallenge:       req.CodeChallenge,
		CodeChallengeMethod: defaultStr(req.CodeChallengeMethod, "S256"),
		Scope:               defaultStr(req.Scope, oauthservice.DefaultScope),
		State:               req.State,
		Resource:            defaultStr(req.Resource, h.oauth.Resource()),
	}

	if !h.oauth.VerifyConsentToken(req.ConsentToken, r, userID) {
		return writeOAuthError(c, &oauthservice.Error{Code: "invalid_request", Description: "consent token is invalid or expired"})
	}

	client, err := h.oauth.GetClient(c.Request().Context(), r.ClientID)
	if err != nil {
		return writeOAuthError(c, err)
	}
	if client == nil || !oauthservice.RedirectAllowed(client, r.RedirectURI) {
		return writeOAuthError(c, &oauthservice.Error{Code: "invalid_redirect_uri", Description: "redirect_uri does not match a registered URI"})
	}

	if !req.Approve {
		loc, lerr := appendQuery(r.RedirectURI, map[string]string{"error": "access_denied", "state": r.State})
		if lerr != nil {
			return writeOAuthError(c, &oauthservice.Error{Code: "invalid_request", Description: "bad redirect_uri"})
		}
		return c.JSON(http.StatusOK, map[string]string{"redirect": loc})
	}

	code, err := h.oauth.IssueCode(c.Request().Context(), userID, r)
	if err != nil {
		return writeOAuthError(c, err)
	}
	loc, lerr := appendQuery(r.RedirectURI, map[string]string{"code": code, "state": r.State})
	if lerr != nil {
		return writeOAuthError(c, &oauthservice.Error{Code: "invalid_request", Description: "bad redirect_uri"})
	}
	return c.JSON(http.StatusOK, map[string]string{"redirect": loc})
}

// --- Token endpoint (public, form-encoded) ---

// Token implements the authorization_code and refresh_token grants for public
// (PKCE) clients.
func (h *OAuthServerHandler) Token(c echo.Context) error {
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("Pragma", "no-cache")

	grantType := c.FormValue("grant_type")
	clientID := c.FormValue("client_id")

	var (
		res *oauthservice.TokenResult
		err error
	)
	switch grantType {
	case "authorization_code":
		res, err = h.oauth.ExchangeCode(
			c.Request().Context(),
			clientID,
			c.FormValue("code"),
			c.FormValue("redirect_uri"),
			c.FormValue("code_verifier"),
		)
	case "refresh_token":
		res, err = h.oauth.Refresh(c.Request().Context(), clientID, c.FormValue("refresh_token"))
	default:
		return writeOAuthError(c, oauthservice.ErrUnsupportedGrant)
	}
	if err != nil {
		return writeOAuthError(c, err)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"access_token":  res.AccessToken,
		"token_type":    res.TokenType,
		"expires_in":    res.ExpiresIn,
		"refresh_token": res.RefreshToken,
		"scope":         res.Scope,
	})
}

// --- Dynamic Client Registration (public, RFC 7591) ---

func (h *OAuthServerHandler) Register(c echo.Context) error {
	var reg oauthservice.ClientRegistration
	if err := c.Bind(&reg); err != nil {
		return writeOAuthError(c, &oauthservice.Error{Code: "invalid_client_metadata", Description: "malformed body"})
	}
	client, err := h.oauth.RegisterClient(c.Request().Context(), reg)
	if err != nil {
		return writeOAuthError(c, err)
	}
	return c.JSON(http.StatusCreated, map[string]any{
		"client_id":                  client.ClientID,
		"client_name":                client.ClientName,
		"redirect_uris":              client.RedirectURIs,
		"grant_types":                client.GrantTypes,
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
		"scope":                      client.Scope,
		"client_id_issued_at":        client.CreatedAt.Unix(),
	})
}

// --- Revocation (public, RFC 7009) ---

func (h *OAuthServerHandler) Revoke(c echo.Context) error {
	// RFC 7009: respond 200 regardless of whether the token was known.
	_ = h.oauth.RevokeToken(c.Request().Context(), c.FormValue("token"))
	return c.NoContent(http.StatusOK)
}

// --- Connected-apps management (session-required) ---

func (h *OAuthServerHandler) ListConnections(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	conns, err := h.oauth.ListConnections(c.Request().Context(), userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to list connections")
	}
	return c.JSON(http.StatusOK, map[string]any{"connections": conns})
}

func (h *OAuthServerHandler) RevokeConnection(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	clientID := c.Param("clientId")
	if clientID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "clientId is required")
	}
	if err := h.oauth.RevokeConnection(c.Request().Context(), userID, clientID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to revoke connection")
	}
	return c.NoContent(http.StatusNoContent)
}

// --- helpers ---

func writeOAuthError(c echo.Context, err error) error {
	if oe, ok := errors.AsType[*oauthservice.Error](err); ok {
		status := http.StatusBadRequest
		if oe.Code == "invalid_client" {
			status = http.StatusUnauthorized
		}
		return c.JSON(status, map[string]string{"error": oe.Code, "error_description": oe.Description})
	}
	return c.JSON(http.StatusInternalServerError, map[string]string{
		"error": "server_error", "error_description": "internal error",
	})
}

func appendQuery(raw string, params map[string]string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	q := u.Query()
	for k, v := range params {
		if v != "" {
			q.Set(k, v)
		}
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func defaultStr(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}
