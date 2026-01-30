package libraries

import (
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/components"
	datastar "github.com/starfederation/datastar/sdk/go"
)

// GetLibraryView displays the files in a specific library
func GetLibraryView(c echo.Context) error {
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
		Title:           library.Name,
		UserEmail:       user.Email,
		Theme:           user.Theme,
		CreatedAt:       user.CreatedAt,
		Assets:          assets,
		Libraries:       libraries,
		LibraryName:     library.Name,
		LibraryPublicID: library.PublicID,
	}
	component := components.LibraryView(data)
	return component.Render(c.Request().Context(), c.Response().Writer)
}

// PostCreateLibrary creates a new library and returns updated sidebar fragment via SSE
func PostCreateLibrary(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	log.Printf("PostCreateLibrary called for user ID: %d", userID)

	type Signals struct {
		NewLibraryName string `json:"newLibraryName"`
	}

	signals := &Signals{}
	if err := datastar.ReadSignals(c.Request(), signals); err != nil {
		log.Printf("Failed to read signals: %v", err)
		return c.String(http.StatusBadRequest, "Invalid request")
	}

	log.Printf("Received signals: %+v", signals)

	name := signals.NewLibraryName
	if name == "" {
		log.Println("Library name is empty")
		return c.String(http.StatusBadRequest, "Library name is required")
	}

	_, err := CreateLibrary(userID, name)
	if err != nil {
		log.Printf("Failed to create library: %v", err)
		return c.String(http.StatusInternalServerError, "Failed to create library")
	}

	log.Printf("Successfully created library: %s", name)
	return sendSidebarUpdate(c, userID, map[string]any{
		"newLibraryName":    "",
		"showCreateLibrary": false,
	})
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

	_, err := RenameLibrary(signals.RenamingLibrary, userID, signals.RenameValue)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to rename library")
	}

	return sendSidebarUpdate(c, userID, map[string]any{
		"renamingLibrary": "",
		"renameValue":     "",
	})
}

// DeleteLibraryHandler deletes a library and returns updated sidebar fragment via SSE
func DeleteLibraryHandler(c echo.Context) error {
	userID := auth.GetCurrentUserID(c)
	publicID := c.Param("publicID")

	err := DeleteLibrary(publicID, userID)
	if err != nil {
		return c.String(http.StatusBadRequest, err.Error())
	}

	return sendSidebarUpdate(c, userID, nil)
}

// sendSidebarUpdate fetches updated libraries and sends the sidebar fragment via SSE
func sendSidebarUpdate(c echo.Context, userID uint, signalUpdates map[string]any) error {
	libraries, err := GetUserLibraries(userID)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to load libraries")
	}

	sse := datastar.NewSSE(c.Response().Writer, c.Request())

	if signalUpdates != nil {
		if err := sse.MarshalAndMergeSignals(signalUpdates); err != nil {
			return err
		}
	}

	component := components.SidebarLibraries(components.SidebarData{
		Libraries: libraries,
	})
	return sse.MergeFragmentTempl(component, datastar.WithSelectorID("sidebar-libraries"))
}
