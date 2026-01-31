package folders

import (
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/libraries"
)

// CreateFolderRequest represents a request to create a folder
type CreateFolderRequest struct {
	LibraryPublicID string  `json:"libraryPublicID"`
	ParentPublicID  *string `json:"parentPublicID,omitempty"`
	Name            string  `json:"name"`
}

// PostCreateFolder creates a new folder
func PostCreateFolder(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	var req CreateFolderRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request"})
	}

	if req.Name == "" || req.LibraryPublicID == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Name and library are required"})
	}

	// Get library
	library, err := libraries.GetLibraryByPublicID(req.LibraryPublicID, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Library not found"})
	}

	// Get parent folder if specified
	var parentID *uint
	if req.ParentPublicID != nil {
		parent, err := GetFolderByPublicID(*req.ParentPublicID, userID)
		if err != nil {
			return c.JSON(http.StatusNotFound, echo.Map{"error": "Parent folder not found"})
		}
		parentID = &parent.ID
	}

	folder, err := CreateFolder(library.ID, parentID, userID, req.Name)
	if err != nil {
		slog.Error("Failed to create folder", "error", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to create folder"})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message":   "Folder created successfully",
		"folder":    folder,
		"public_id": folder.PublicID,
	})
}

// RenameFolderRequest represents a request to rename a folder
type RenameFolderRequest struct {
	PublicID string `json:"publicID"`
	Name     string `json:"name"`
}

// PutRenameFolder renames a folder
func PutRenameFolder(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	var req RenameFolderRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request"})
	}

	if req.Name == "" || req.PublicID == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Name and folder ID are required"})
	}

	folder, err := RenameFolder(req.PublicID, userID, req.Name)
	if err != nil {
		slog.Error("Failed to rename folder", "error", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to rename folder"})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": "Folder renamed successfully",
		"folder":  folder,
	})
}

// DeleteFolderHandler deletes a folder
func DeleteFolderHandler(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	publicID := c.Param("publicID")
	deleteContents := c.QueryParam("deleteContents") == "true"

	if err := DeleteFolder(publicID, userID, deleteContents); err != nil {
		slog.Error("Failed to delete folder", "error", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": "Folder deleted successfully",
	})
}

// MoveFileRequest represents a request to move a file to a folder
type MoveFileRequest struct {
	FilePublicID   string  `json:"filePublicID"`
	FolderPublicID *string `json:"folderPublicID,omitempty"`
}

// PostMoveFileToFolder moves a file to a folder
func PostMoveFileToFolder(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	var req MoveFileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request"})
	}

	if req.FilePublicID == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "File ID is required"})
	}

	if err := MoveFileToFolder(req.FilePublicID, req.FolderPublicID, userID); err != nil {
		slog.Error("Failed to move file", "error", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": "File moved successfully",
	})
}

// MoveFolderRequest represents a request to move a folder
type MoveFolderRequest struct {
	NewParentPublicID *string `json:"newParentPublicID,omitempty"`
}

// PostMoveFolder moves a folder to a new parent
func PostMoveFolder(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	publicID := c.Param("publicID")

	var req MoveFolderRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request"})
	}

	var newParentID *uint
	if req.NewParentPublicID != nil {
		parent, err := GetFolderByPublicID(*req.NewParentPublicID, userID)
		if err != nil {
			return c.JSON(http.StatusNotFound, echo.Map{"error": "Parent folder not found"})
		}
		newParentID = &parent.ID
	}

	if err := MoveFolder(publicID, newParentID, userID); err != nil {
		slog.Error("Failed to move folder", "error", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": "Folder moved successfully",
	})
}

// GetFolderContents returns the contents of a folder (subfolders and files)
func GetFolderContents(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	publicID := c.Param("publicID")

	folder, children, files, err := GetFolderWithContents(publicID, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Folder not found"})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"folder":   folder,
		"children": children,
		"files":    files,
	})
}
