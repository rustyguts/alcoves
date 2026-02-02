package auth

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/models"
)

func SessionAuthMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			session, err := GetSession(c)
			if err != nil {
				// No valid session found, redirect to login
				return c.Redirect(http.StatusFound, "/login")
			}

			// Set user ID in context for use by handlers
			c.Set("user", session.UserID)
			c.Set("session", session)

			return next(c)
		}
	}
}

func AdminMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID := GetCurrentUserID(c)
			user, err := FindUserByID(userID)
			if err != nil || user.Role != "admin" {
				return c.String(http.StatusForbidden, "Forbidden")
			}
			return next(c)
		}
	}
}

// GetCurrentUserID extracts the user ID from the Echo context
// This should be used in handlers protected by SessionAuthMiddleware
func GetCurrentUserID(c echo.Context) uint {
	if userID, ok := c.Get("user").(uint); ok {
		return userID
	}
	return 0
}

// GetCurrentSession extracts the session from the Echo context
// This should be used in handlers protected by SessionAuthMiddleware
func GetCurrentSession(c echo.Context) *models.Session {
	if session, ok := c.Get("session").(*models.Session); ok {
		return session
	}
	return nil
}
