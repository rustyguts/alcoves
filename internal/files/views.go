package files

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/components"
	"github.com/rustyguts/alcoves/internal/libraries"
	"github.com/rustyguts/alcoves/internal/models"
)

func GetHealthcheck(c echo.Context) error {
	return c.String(http.StatusOK, "OK")
}

func GetRoot(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		log.Println("Failed to find user for root handler", "error", err, "user_id", userID)
	}

	var userEmail string
	theme := "dark"
	var createdAt time.Time
	if currentUser != nil {
		userEmail = currentUser.Email
		theme = currentUser.Theme
		createdAt = currentUser.CreatedAt
	}

	userLibraries, err := libraries.GetUserLibraries(userID)
	if err != nil {
		log.Println("Failed to load user libraries", "error", err, "user_id", userID)
	}

	data := components.LayoutData{
		Title:     "Home",
		UserEmail: userEmail,
		Theme:     theme,
		CreatedAt: createdAt,
		Assets:    []models.File{}, // Empty slice for home page
		Libraries: userLibraries,
	}

	component := components.Home(data)
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
