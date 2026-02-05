package libraries

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/components"
	"github.com/starfederation/datastar-go/datastar"
)

// GetLibraryView displays the files in a specific library
func GetLibraryView(c echo.Context) error {
	if c.QueryParam("_fragment") == "1" {
		return getLibraryFragment(c)
	}

	userID := auth.GetCurrentUserID(c)
	publicID := c.Param("publicID")

	library, err := GetLibraryByPublicID(publicID, userID)
	if err != nil {
		return c.String(http.StatusNotFound, "Library not found")
	}

	// Preload files for this library
	assets := library.Files

	// Get user info for layout
	user, err := auth.FindUserByID(userID)
	if err != nil {
		return c.String(http.StatusInternalServerError, "User not found")
	}

	libraries, err := GetUserLibraries(userID)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to get libraries")
	}

	data := components.LibraryViewData{
		Title:             library.Name,
		UserEmail:         user.Email,
		UserRole:          user.Role,
		Theme:             user.Theme,
		CreatedAt:         user.CreatedAt,
		Assets:            assets,
		Libraries:         libraries,
		LibraryName:       library.Name,
		LibraryPublicID:   library.PublicID,
		LibraryIsPersonal: library.IsPersonal,
	}
	component := components.LibraryView(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

func getLibraryFragment(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	publicID := c.Param("publicID")

	library, err := GetLibraryByPublicID(publicID, userID)
	if err != nil {
		return c.String(http.StatusNotFound, "Library not found")
	}

	allLibraries, err := GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries for fragment", "error", err, "user_id", userID)
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	sse.PatchElementTempl(
		components.LibraryContent(components.LibraryContentData{
			Assets:            library.Files,
			LibraryName:       library.Name,
			LibraryPublicID:   library.PublicID,
			LibraryIsPersonal: library.IsPersonal,
		}),
		datastar.WithSelectorID("main-content"),
		datastar.WithModeInner(),
	)

	sse.PatchElementTempl(
		components.SidebarLibraries(components.SidebarData{
			Libraries:       allLibraries,
			ActiveLibraryID: library.PublicID,
		}),
		datastar.WithSelectorID("sidebar-libraries"),
	)

	if c.QueryParam("push") == "1" {
		sse.ExecuteScript(fmt.Sprintf(
			"history.pushState(null, '', '/libraries/%s'); document.title = '%s'",
			library.PublicID, library.Name,
		))
	} else {
		sse.ExecuteScript(fmt.Sprintf("document.title = '%s'", library.Name))
	}

	return nil
}

// PostCreateLibrary creates a new library with a default name and returns updated sidebar fragment via SSE
func PostCreateLibrary(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	slog.Info("PostCreateLibrary called", "user_id", userID)

	name := "New Library"

	_, err := CreateLibrary(userID, name)
	if err != nil {
		slog.Error("Failed to create library", "error", err)
		return c.String(http.StatusInternalServerError, "Failed to create library")
	}

	slog.Info("Successfully created library", "name", name)
	return sendSidebarUpdate(c, userID, "", nil)
}

// PutRenameLibrary renames a library and returns updated sidebar fragment via SSE
func PutRenameLibrary(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)

	var signals struct {
		RenamingLibrary string `json:"renamingLibrary"`
		RenameValue     string `json:"renameValue"`
	}
	if err := datastar.ReadSignals(c.Request(), &signals); err != nil {
		return c.String(http.StatusBadRequest, "Invalid request")
	}

	if signals.RenamingLibrary == "" || signals.RenameValue == "" {
		return c.String(http.StatusBadRequest, "Library ID and new name are required")
	}

	library, err := RenameLibrary(signals.RenamingLibrary, userID, signals.RenameValue)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to rename library")
	}

	return sendSidebarUpdate(c, userID, library.Name, map[string]any{
		"renamingLibrary": "",
		"renameValue":     "",
	})
}

// DeleteLibraryHandler deletes a library and navigates to home via SSE fragment
func DeleteLibraryHandler(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	publicID := c.Param("publicID")

	err := DeleteLibrary(publicID, userID)
	if err != nil {
		return c.String(http.StatusBadRequest, err.Error())
	}

	userLibraries, err := GetUserLibraries(userID)
	if err != nil {
		slog.Error("Failed to load user libraries after delete", "error", err, "user_id", userID)
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	sse.PatchElementTempl(
		components.HomeContent(),
		datastar.WithSelectorID("main-content"),
		datastar.WithModeInner(),
	)

	sse.PatchElementTempl(
		components.SidebarLibraries(components.SidebarData{
			Libraries:       userLibraries,
			ActiveLibraryID: "",
		}),
		datastar.WithSelectorID("sidebar-libraries"),
	)

	sse.ExecuteScript("history.pushState(null, '', '/'); document.title = 'Alcoves'")

	return nil
}

// sendSidebarUpdate fetches updated libraries and sends the sidebar fragment via SSE
func sendSidebarUpdate(c echo.Context, userID uint, newLibraryName string, signalUpdates map[string]any) error {
	libraries, err := GetUserLibraries(userID)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to load libraries")
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	if signalUpdates != nil {
		signalsJSON, err := json.Marshal(signalUpdates)
		if err != nil {
			return err
		}
		sse.PatchSignals(signalsJSON)
	}

	// Update sidebar
	component := components.SidebarLibraries(components.SidebarData{
		Libraries: libraries,
	})

	var buf bytes.Buffer
	if err := component.Render(c.Request().Context(), &buf); err != nil {
		return err
	}

	sse.PatchElements(buf.String(), datastar.WithSelectorID("sidebar-libraries"))

	// Update library name in the view if provided
	if newLibraryName != "" {
		sse.PatchElements(newLibraryName, datastar.WithSelectorID("library-name"))
	}

	return nil
}
