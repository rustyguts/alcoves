package admin

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/components"
	"github.com/rustyguts/alcoves/internal/libraries"
	"github.com/starfederation/datastar-go/datastar"
)

func GetAdmin(c echo.Context) error {
	if c.QueryParam("_fragment") == "1" {
		return getAdminFragment(c)
	}

	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		slog.Error("Failed to find user for admin handler", "error", err, "user_id", userID)
		return c.String(http.StatusInternalServerError, "Failed to load admin page")
	}

	userLibraries, err := libraries.GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries", "error", err, "user_id", userID)
	}

	users, err := auth.GetAllUsers()
	if err != nil {
		slog.Error("Failed to load users for admin", "error", err)
		return c.String(http.StatusInternalServerError, "Failed to load users")
	}

	data := components.AdminData{
		Title:     "Admin",
		UserEmail: currentUser.Email,
		UserRole:  currentUser.Role,
		Theme:     currentUser.Theme,
		CreatedAt: currentUser.CreatedAt,
		Libraries: userLibraries,
		Users:     users,
	}

	component := components.Admin(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func getAdminFragment(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		slog.Error("Failed to find user for admin fragment", "error", err, "user_id", userID)
		return c.String(http.StatusInternalServerError, "Failed to load admin page")
	}

	userLibraries, err := libraries.GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries for fragment", "error", err, "user_id", userID)
	}

	users, err := auth.GetAllUsers()
	if err != nil {
		slog.Error("Failed to load users for admin fragment", "error", err)
		return c.String(http.StatusInternalServerError, "Failed to load users")
	}

	data := components.AdminData{
		Title:     "Admin",
		UserEmail: currentUser.Email,
		UserRole:  currentUser.Role,
		Theme:     currentUser.Theme,
		CreatedAt: currentUser.CreatedAt,
		Libraries: userLibraries,
		Users:     users,
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	sse.PatchElementTempl(
		components.AdminContent(data),
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
		sse.ExecuteScript("history.pushState(null, '', '/admin'); document.title = 'Admin'")
	} else {
		sse.ExecuteScript("document.title = 'Admin'")
	}

	return nil
}

func PutUserRole(c echo.Context) error {
	targetUserID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return c.String(http.StatusBadRequest, "Invalid user ID")
	}

	role := c.FormValue("role")
	if role != "admin" && role != "member" {
		return c.String(http.StatusBadRequest, "Invalid role")
	}

	if err := auth.UpdateUserRole(uint(targetUserID), role); err != nil {
		slog.Error("Failed to update user role", "error", err, "target_user_id", targetUserID)
		return c.String(http.StatusInternalServerError, "Failed to update role")
	}

	// Return updated admin content
	userID := auth.GetCurrentUserID(c)
	currentUser, err := auth.FindUserByID(userID)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to load user")
	}

	users, err := auth.GetAllUsers()
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to load users")
	}

	data := components.AdminData{
		Title:     "Admin",
		UserEmail: currentUser.Email,
		UserRole:  currentUser.Role,
		Theme:     currentUser.Theme,
		Users:     users,
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	sse.PatchElementTempl(
		components.AdminContent(data),
		datastar.WithSelectorID("main-content"),
		datastar.WithModeInner(),
	)

	return nil
}
