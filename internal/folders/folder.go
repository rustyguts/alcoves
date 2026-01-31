package folders

import (
	"fmt"
	"log/slog"

	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	"gorm.io/gorm"
)

// GetFoldersByLibrary returns all folders in a library, optionally filtered by parent
func GetFoldersByLibrary(libraryID uint, parentID *uint, userID uint) ([]models.Folder, error) {
	var folders []models.Folder
	query := db.Connection.Where("library_id = ? AND user_id = ?", libraryID, userID)

	if parentID != nil {
		query = query.Where("parent_id = ?", *parentID)
	} else {
		query = query.Where("parent_id IS NULL")
	}

	if err := query.Find(&folders).Error; err != nil {
		return nil, fmt.Errorf("failed to get folders: %w", err)
	}

	return folders, nil
}

// GetFolderByPublicID returns a folder by its public ID
func GetFolderByPublicID(publicID string, userID uint) (*models.Folder, error) {
	var folder models.Folder
	if err := db.Connection.Where("public_id = ? AND user_id = ?", publicID, userID).First(&folder).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("folder not found")
		}
		return nil, fmt.Errorf("failed to get folder: %w", err)
	}
	return &folder, nil
}

// GetFolderWithContents returns a folder with its children and files
func GetFolderWithContents(publicID string, userID uint) (*models.Folder, []models.Folder, []models.File, error) {
	folder, err := GetFolderByPublicID(publicID, userID)
	if err != nil {
		return nil, nil, nil, err
	}

	// Get child folders
	var children []models.Folder
	if err := db.Connection.Where("parent_id = ? AND user_id = ?", folder.ID, userID).Find(&children).Error; err != nil {
		return nil, nil, nil, fmt.Errorf("failed to get child folders: %w", err)
	}

	// Get files in this folder
	var files []models.File
	if err := db.Connection.Where("folder_id = ? AND user_id = ?", folder.ID, userID).Find(&files).Error; err != nil {
		return nil, nil, nil, fmt.Errorf("failed to get files: %w", err)
	}

	return folder, children, files, nil
}

// CreateFolder creates a new folder
func CreateFolder(libraryID uint, parentID *uint, userID uint, name string) (*models.Folder, error) {
	folder := models.Folder{
		Name:      name,
		LibraryID: libraryID,
		ParentID:  parentID,
		UserID:    userID,
	}

	if err := db.Connection.Create(&folder).Error; err != nil {
		return nil, fmt.Errorf("failed to create folder: %w", err)
	}

	slog.Info("Created folder", "name", name, "public_id", folder.PublicID)
	return &folder, nil
}

// RenameFolder renames a folder
func RenameFolder(publicID string, userID uint, newName string) (*models.Folder, error) {
	folder, err := GetFolderByPublicID(publicID, userID)
	if err != nil {
		return nil, err
	}

	folder.Name = newName
	if err := db.Connection.Save(folder).Error; err != nil {
		return nil, fmt.Errorf("failed to rename folder: %w", err)
	}

	slog.Info("Renamed folder", "public_id", publicID, "new_name", newName)
	return folder, nil
}

// DeleteFolder deletes a folder and optionally its contents
func DeleteFolder(publicID string, userID uint, deleteContents bool) error {
	folder, err := GetFolderByPublicID(publicID, userID)
	if err != nil {
		return err
	}

	// Check if folder has children
	var childCount int64
	db.Connection.Model(&models.Folder{}).Where("parent_id = ?", folder.ID).Count(&childCount)

	if childCount > 0 && !deleteContents {
		return fmt.Errorf("folder is not empty")
	}

	// Delete children recursively if deleteContents is true
	if deleteContents && childCount > 0 {
		if err := deleteChildrenRecursively(folder.ID, userID); err != nil {
			return fmt.Errorf("failed to delete child folders: %w", err)
		}
	}

	// Move files to root (null folder_id) if not deleting contents
	if !deleteContents {
		if err := db.Connection.Model(&models.File{}).Where("folder_id = ?", folder.ID).Update("folder_id", nil).Error; err != nil {
			return fmt.Errorf("failed to move files: %w", err)
		}
	} else {
		// Delete files in this folder
		if err := db.Connection.Where("folder_id = ?", folder.ID).Delete(&models.File{}).Error; err != nil {
			return fmt.Errorf("failed to delete files: %w", err)
		}
	}

	if err := db.Connection.Delete(folder).Error; err != nil {
		return fmt.Errorf("failed to delete folder: %w", err)
	}

	slog.Info("Deleted folder", "public_id", publicID)
	return nil
}

// deleteChildrenRecursively recursively deletes all child folders and their contents
func deleteChildrenRecursively(parentID uint, userID uint) error {
	var children []models.Folder
	if err := db.Connection.Where("parent_id = ? AND user_id = ?", parentID, userID).Find(&children).Error; err != nil {
		return err
	}

	for _, child := range children {
		// Recursively delete grandchildren
		if err := deleteChildrenRecursively(child.ID, userID); err != nil {
			return err
		}

		// Delete files in child folder
		if err := db.Connection.Where("folder_id = ?", child.ID).Delete(&models.File{}).Error; err != nil {
			return err
		}

		// Delete child folder
		if err := db.Connection.Delete(&child).Error; err != nil {
			return err
		}
	}

	return nil
}

// MoveFileToFolder moves a file to a folder
func MoveFileToFolder(filePublicID string, folderPublicID *string, userID uint) error {
	var file models.File
	if err := db.Connection.Where("public_id = ? AND user_id = ?", filePublicID, userID).First(&file).Error; err != nil {
		return fmt.Errorf("file not found: %w", err)
	}

	var folderID *uint
	if folderPublicID != nil {
		folder, err := GetFolderByPublicID(*folderPublicID, userID)
		if err != nil {
			return fmt.Errorf("folder not found: %w", err)
		}
		folderID = &folder.ID
	}

	file.FolderID = folderID
	if err := db.Connection.Save(&file).Error; err != nil {
		return fmt.Errorf("failed to move file: %w", err)
	}

	return nil
}

// MoveFolder moves a folder to a new parent
func MoveFolder(publicID string, newParentID *uint, userID uint) error {
	folder, err := GetFolderByPublicID(publicID, userID)
	if err != nil {
		return err
	}

	// Prevent moving a folder into itself or its descendants
	if newParentID != nil {
		if folder.ID == *newParentID {
			return fmt.Errorf("cannot move folder into itself")
		}

		// Check if newParent is a descendant of folder
		if isDescendant(*newParentID, folder.ID, userID) {
			return fmt.Errorf("cannot move folder into its own subfolder")
		}
	}

	folder.ParentID = newParentID
	if err := db.Connection.Save(folder).Error; err != nil {
		return fmt.Errorf("failed to move folder: %w", err)
	}

	slog.Info("Moved folder", "public_id", publicID)
	return nil
}

// isDescendant checks if potentialDescendantID is a descendant of ancestorID
func isDescendant(potentialDescendantID uint, ancestorID uint, userID uint) bool {
	var folder models.Folder
	if err := db.Connection.Where("id = ? AND user_id = ?", potentialDescendantID, userID).First(&folder).Error; err != nil {
		return false
	}

	if folder.ParentID == nil {
		return false
	}

	if *folder.ParentID == ancestorID {
		return true
	}

	return isDescendant(*folder.ParentID, ancestorID, userID)
}
