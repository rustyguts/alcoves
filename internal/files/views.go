package files

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/components"
	"github.com/rustyguts/alcoves/internal/libraries"
	"github.com/rustyguts/alcoves/internal/models"
	"github.com/starfederation/datastar-go/datastar"
)

func GetHealthcheck(c echo.Context) error {
	return c.String(http.StatusOK, "OK")
}

func GetRoot(c echo.Context) error {
	if c.QueryParam("_fragment") == "1" {
		return getHomeFragment(c)
	}

	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		slog.Error("Failed to find user for root handler", "error", err, "user_id", userID)
	}

	var userEmail string
	var userRole string
	theme := "dark"
	var createdAt time.Time
	if currentUser != nil {
		userEmail = currentUser.Email
		userRole = currentUser.Role
		theme = currentUser.Theme
		createdAt = currentUser.CreatedAt
	}

	userLibraries, err := libraries.GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries", "error", err, "user_id", userID)
	}

	data := components.LayoutData{
		Title:     "Home",
		UserEmail: userEmail,
		UserRole:  userRole,
		Theme:     theme,
		CreatedAt: createdAt,
		Assets:    []models.File{}, // Empty slice for home page
		Libraries: userLibraries,
	}

	component := components.Home(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func getHomeFragment(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)

	userLibraries, err := libraries.GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries for fragment", "error", err, "user_id", userID)
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	sse.PatchElementTempl(
		components.HomeContent(),
		datastar.WithSelectorID("main-content"),
		datastar.WithModeInner(),
		datastar.WithViewTransitions(),
	)

	sse.PatchElementTempl(
		components.SidebarLibraries(components.SidebarData{
			Libraries:       userLibraries,
			ActiveLibraryID: "",
		}),
		datastar.WithSelectorID("sidebar-libraries"),
	)

	if c.QueryParam("push") == "1" {
		sse.ExecuteScript("history.pushState(null, '', '/'); document.title = 'Home'")
	} else {
		sse.ExecuteScript("document.title = 'Home'")
	}

	return nil
}

func GetMedia(c echo.Context) error {
	fileId := c.Param("assetId")

	file := GetFileByPublicID(fileId)
	if file == nil {
		return c.String(http.StatusNotFound, "File not found")
	}

	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		slog.Error("Failed to find user for media handler", "error", err, "user_id", userID)
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

func GetProfile(c echo.Context) error {
	if c.QueryParam("_fragment") == "1" {
		return getProfileFragment(c)
	}

	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		slog.Error("Failed to find user for profile handler", "error", err, "user_id", userID)
		return c.String(http.StatusInternalServerError, "Failed to load profile")
	}

	if currentUser == nil {
		return c.Redirect(http.StatusFound, "/login")
	}

	userLibraries, err := libraries.GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries", "error", err, "user_id", userID)
	}

	data := components.ProfileData{
		Title:     "Profile",
		UserEmail: currentUser.Email,
		UserRole:  currentUser.Role,
		Theme:     currentUser.Theme,
		CreatedAt: currentUser.CreatedAt,
		Libraries: userLibraries,
	}

	component := components.Profile(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func getProfileFragment(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		slog.Error("Failed to find user for profile fragment", "error", err, "user_id", userID)
		return c.String(http.StatusInternalServerError, "Failed to load profile")
	}

	if currentUser == nil {
		return c.Redirect(http.StatusFound, "/login")
	}

	userLibraries, err := libraries.GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries for fragment", "error", err, "user_id", userID)
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	profileContent := components.ProfileContent(components.ProfileData{
		Title:     "Profile",
		UserEmail: currentUser.Email,
		UserRole:  currentUser.Role,
		Theme:     currentUser.Theme,
		CreatedAt: currentUser.CreatedAt,
		Libraries: userLibraries,
	})

	sse.PatchElementTempl(
		profileContent,
		datastar.WithSelectorID("main-content"),
		datastar.WithModeInner(),
		datastar.WithViewTransitions(),
	)

	sse.PatchElementTempl(
		components.SidebarLibraries(components.SidebarData{
			Libraries:       userLibraries,
			ActiveLibraryID: "",
		}),
		datastar.WithSelectorID("sidebar-libraries"),
	)

	if c.QueryParam("push") == "1" {
		sse.ExecuteScript("history.pushState(null, '', '/profile'); document.title = 'Profile'")
	} else {
		sse.ExecuteScript("document.title = 'Profile'")
	}

	return nil
}
