package auth

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
)

func FindUserByEmail(email string) (*models.User, error) {
	var users []models.User
	result := db.Connection.Where("email = ?", email).Find(&users)
	if result.Error != nil {
		return nil, result.Error
	}
	if len(users) == 0 {
		return nil, nil
	}
	return &users[0], nil
}

func FindUserByID(userID uint) (*models.User, error) {
	var user models.User
	result := db.Connection.First(&user, userID)
	if result.Error != nil {
		return nil, result.Error
	}
	return &user, nil
}

func UpdateUserTheme(userID uint, theme string) error {
	result := db.Connection.Model(&models.User{}).Where("id = ?", userID).Update("theme", theme)
	return result.Error
}

func PostUpdateTheme(c echo.Context) error {
	// Extract user ID from context
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
