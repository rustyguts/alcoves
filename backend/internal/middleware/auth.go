package middleware

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

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
	// Public file proxy
	if strings.HasPrefix(path, "/api/files/proxy/") {
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
