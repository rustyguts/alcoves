package middleware

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/alcoves/alcoves-backend/internal/services/access"
)

const ContextKeyLibraryAccess = "libraryAccess"

var readMethods = map[string]bool{
	"GET":     true,
	"HEAD":    true,
	"OPTIONS": true,
}

// LibraryAccessMiddleware validates library access for /api/libraries/:id/* routes.
func LibraryAccessMiddleware(accessSvc *access.Service) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path
			if !strings.HasPrefix(path, "/api/libraries/") {
				return next(c)
			}

			// Extract library ID from path: /api/libraries/{id}/...
			parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
			if len(parts) < 3 || parts[0] != "api" || parts[1] != "libraries" || parts[2] == "" {
				return next(c)
			}

			libraryID, err := uuid.Parse(parts[2])
			if err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
			}

			userID := GetUserID(c)
			if userID == uuid.Nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "Unauthorized")
			}

			var libraryAccess *access.LibraryAccess
			if readMethods[c.Request().Method] {
				libraryAccess, err = accessSvc.RequireLibraryAccess(c, userID, libraryID)
			} else {
				libraryAccess, err = accessSvc.RequireLibraryAdmin(c, userID, libraryID)
			}
			if err != nil {
				return err
			}

			c.Set(ContextKeyLibraryAccess, libraryAccess)
			return next(c)
		}
	}
}

// GetLibraryAccess extracts the library access from context.
func GetLibraryAccess(c echo.Context) *access.LibraryAccess {
	a, _ := c.Get(ContextKeyLibraryAccess).(*access.LibraryAccess)
	return a
}
