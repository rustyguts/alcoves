package middleware

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
)

// Context keys for storing auth data.
const (
	ContextKeyUserID       = "userId"
	ContextKeyUser         = "user"
	ContextKeySessionToken = "sessionToken"
)

// AuthMiddleware validates session cookies and populates context with user info.
func AuthMiddleware(authSvc *authservice.Service) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path

			// Skip auth for public routes
			if !needsAuth(path) {
				return next(c)
			}

			// A Bearer personal access token takes precedence when present —
			// this authenticates the MCP HTTP transport and out-of-band tus
			// uploads. Falls through to the session cookie otherwise.
			if user := resolveBearerUser(c, authSvc); user != nil {
				c.Set(ContextKeyUserID, user.ID.String())
				c.Set(ContextKeyUser, user)
				return next(c)
			}

			user, sessionToken, err := authSvc.GetUserBySession(c)
			if err != nil || user == nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "Unauthorized")
			}

			c.Set(ContextKeyUserID, user.ID.String())
			c.Set(ContextKeyUser, user)
			c.Set(ContextKeySessionToken, sessionToken)

			return next(c)
		}
	}
}

// resolveBearerUser returns the user identified by an Authorization: Bearer
// <personal-access-token> header, or nil if absent/invalid.
func resolveBearerUser(c echo.Context, authSvc *authservice.Service) *models.User {
	const prefix = "Bearer "
	authz := c.Request().Header.Get("Authorization")
	if !strings.HasPrefix(authz, prefix) {
		return nil
	}
	token := strings.TrimSpace(authz[len(prefix):])
	if token == "" {
		return nil
	}
	user, err := authSvc.ValidateMCPToken(c.Request().Context(), token)
	if err != nil || user == nil {
		return nil
	}
	return user
}

func needsAuth(path string) bool {
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	if strings.HasPrefix(path, "/api/auth/") {
		publicAuthPaths := []string{
			"/api/auth/login",
			"/api/auth/register",
			"/api/auth/providers",
			"/api/auth/logout",
			"/api/auth/google",
			"/api/auth/google/callback",
		}
		for _, publicPath := range publicAuthPaths {
			if path == publicPath || strings.HasPrefix(path, publicPath+"/") {
				return false
			}
		}
	}
	// Session check endpoint (used by frontend)
	if path == "/api/_auth/session" {
		return false
	}
	// Health check
	if path == "/api/health" {
		return false
	}
	// Version info (used by admin footer; no sensitive data)
	if path == "/api/version" {
		return false
	}
	// Public app metadata (registration mode, etc.)
	if strings.HasPrefix(path, "/api/_meta/") {
		return false
	}
	// Invite lookup — anon callers need to validate a token before signup.
	// GET /api/invites/:token only; POST .../accept still requires auth via
	// RequireUserID inside the handler.
	if strings.HasPrefix(path, "/api/invites/") && !strings.HasSuffix(path, "/accept") {
		return false
	}
	// Public moment share endpoints (Nuxt SSR loads metadata; video/thumbnail stream directly)
	if strings.HasPrefix(path, "/api/share/") {
		return false
	}
	// Signed curl upload/download endpoints authenticate via a signed token in
	// the query string, not a session — so a bare curl needs no header.
	if strings.HasPrefix(path, "/api/files/signed") || strings.HasPrefix(path, "/api/files/upload-signed") {
		return false
	}
	// MCP HTTP transport authenticates on the route itself via the SDK bearer
	// middleware (PAT or OAuth access token), so the global middleware skips it.
	if path == "/api/mcp" || strings.HasPrefix(path, "/api/mcp/") {
		return false
	}
	// OAuth 2.1 token / registration / revocation endpoints are called by the
	// client's backend and authenticate via the grant itself (PKCE, refresh
	// token), not a session. Note: /api/oauth/authorize and /api/oauth/connections
	// are deliberately NOT here — they require the user's session.
	if path == "/api/oauth/token" || path == "/api/oauth/register" || path == "/api/oauth/revoke" {
		return false
	}
	return true
}

// GetUserID extracts the user ID from context. Returns empty UUID if not set.
func GetUserID(c echo.Context) uuid.UUID {
	idStr, ok := c.Get(ContextKeyUserID).(string)
	if !ok {
		return uuid.Nil
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return uuid.Nil
	}
	return id
}

// RequireUserID extracts user ID from context, returns 401 if not present.
func RequireUserID(c echo.Context) (uuid.UUID, error) {
	id := GetUserID(c)
	if id == uuid.Nil {
		return uuid.Nil, echo.NewHTTPError(http.StatusUnauthorized, "Unauthorized")
	}
	return id, nil
}
