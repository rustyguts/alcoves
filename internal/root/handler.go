package root

import (
	"fmt"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/assets"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/user"
)

func GetHealthcheck(c echo.Context) error {
	return c.String(http.StatusOK, "OK")
}

func GetRoot(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	userAssets := assets.GetUserAssets(c)

	currentUser, err := user.FindUserByID(userID)
	theme := "dark" // default theme
	if err != nil {
		log.Println("Failed to find user for root handler", "error", err, "user_id", userID)
		// Fallback to just user ID if we can't fetch user details
		currentUser = nil
	} else if currentUser != nil {
		theme = currentUser.Theme
	}

	data := echo.Map{
		"title":  "Alcoves",
		"User":   currentUser,
		"Assets": userAssets,
		"Theme":  theme,
	}
	return c.Render(http.StatusOK, "home", data)
}

func GetMedia(c echo.Context) error {
	assetId := c.Param("assetId")
	fmt.Println(assetId)

	asset := assets.GetAssetByPublicID(assetId)

	userID := auth.GetCurrentUserID(c)
	currentUser, err := user.FindUserByID(userID)
	theme := "dark" // default theme
	if err != nil {
		log.Println("Failed to find user for media handler", "error", err, "user_id", userID)
		currentUser = nil
	} else if currentUser != nil {
		theme = currentUser.Theme
	}

	data := echo.Map{
		"title": "Media - Alcoves",
		"User":  currentUser,
		"Asset": asset,
		"Theme": theme,
	}
	return c.Render(http.StatusOK, "media", data)
}

func GetTrash(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	userAssets := assets.GetUserDeletedAssets(c)

	currentUser, err := user.FindUserByID(userID)
	theme := "dark" // default theme
	if err != nil {
		log.Println("Failed to find user for trash handler", "error", err, "user_id", userID)
		currentUser = nil
	} else if currentUser != nil {
		theme = currentUser.Theme
	}

	data := echo.Map{
		"title":  "Trash - Alcoves",
		"User":   currentUser,
		"Assets": userAssets,
		"Theme":  theme,
	}
	return c.Render(http.StatusOK, "trash", data)
}
