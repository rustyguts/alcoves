package files

import (
	"fmt"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/components"
	"github.com/rustyguts/alcoves/internal/models"
)

func GetHealthcheck(c echo.Context) error {
	return c.String(http.StatusOK, "OK")
}

func GetRoot(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	userFiles := GetUserFiles(c)

	currentUser, err := auth.FindUserByID(userID)
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

	// Convert files to the format expected by the Layout component
	var layoutAssets []components.Asset
	for _, file := range userFiles {
		layoutAssets = append(layoutAssets, components.Asset{
			PublicID: file.PublicID,
			Filename: file.Filename,
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
	fileId := c.Param("assetId")
	fmt.Println(fileId)

	file := GetFileByPublicID(fileId)
	if file == nil {
		return c.String(http.StatusNotFound, "File not found")
	}

	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		log.Println("Failed to find user for media handler", "error", err, "user_id", userID)
		currentUser = nil
	}

	// Get previous and next files
	var prevFile, nextFile *models.File
	if currentUser != nil {
		prevFile = GetPreviousFile(userID, file)
		nextFile = GetNextFile(userID, file)
	}

	data := components.MediaViewData{
		Title:     "Media - Alcoves",
		Theme:     currentUser.Theme,
		Asset:     file,
		PrevAsset: prevFile,
		NextAsset: nextFile,
	}

	component := components.Media(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func GetTrash(c echo.Context) error {
	userFiles := GetUserDeletedFiles(c)

	data := components.TrashViewData{
		Assets: userFiles,
	}

	component := components.Trash(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}
