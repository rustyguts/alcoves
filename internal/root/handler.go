package root

import (
	"fmt"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/assets"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/components"
	"github.com/rustyguts/alcoves/internal/models"
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
	var userEmail string
	if err != nil {
		log.Println("Failed to find user for root handler", "error", err, "user_id", userID)
		currentUser = nil
		userEmail = ""
	} else if currentUser != nil {
		theme = currentUser.Theme
		userEmail = currentUser.Email
	}

	// Convert assets to the format expected by the Layout component
	var layoutAssets []components.Asset
	for _, asset := range userAssets {
		layoutAssets = append(layoutAssets, components.Asset{
			PublicID: asset.PublicID,
			Filename: asset.Filename,
		})
	}

	data := components.LayoutData{
		Title:     "Alcoves",
		UserEmail: userEmail,
		Theme:     theme,
		Assets:    layoutAssets,
	}
	if currentUser != nil {
		data.CreatedAt = currentUser.CreatedAt
	}

	component := components.Layout(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func GetMedia(c echo.Context) error {
	assetId := c.Param("assetId")
	fmt.Println(assetId)

	asset := assets.GetAssetByPublicID(assetId)
	if asset == nil {
		return c.String(http.StatusNotFound, "Asset not found")
	}

	userID := auth.GetCurrentUserID(c)
	currentUser, err := user.FindUserByID(userID)
	if err != nil {
		log.Println("Failed to find user for media handler", "error", err, "user_id", userID)
		currentUser = nil
	}

	// Get previous and next assets
	var prevAsset, nextAsset *models.Asset
	if currentUser != nil {
		prevAsset = assets.GetPreviousAsset(userID, asset)
		nextAsset = assets.GetNextAsset(userID, asset)
	}

	data := components.MediaViewData{
		Title:     "Media - Alcoves",
		Theme:     currentUser.Theme,
		Asset:     asset,
		PrevAsset: prevAsset,
		NextAsset: nextAsset,
	}

	component := components.Media(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func GetTrash(c echo.Context) error {
	userAssets := assets.GetUserDeletedAssets(c)

	data := components.TrashViewData{
		Assets: userAssets,
	}

	component := components.Trash(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}
