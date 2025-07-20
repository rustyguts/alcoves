package user

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

func PostUpdateTheme(c echo.Context) error {
	// Extract user ID from context (same logic as auth.GetCurrentUserID)
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}
	
	theme := c.FormValue("theme")
	if theme == "" {
		return c.String(http.StatusBadRequest, "Theme is required")
	}

	err := UpdateUserTheme(userID, theme)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to update theme")
	}

	return c.Redirect(http.StatusSeeOther, "/")
}