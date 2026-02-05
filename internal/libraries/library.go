package libraries

import (
	"fmt"

	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	"gorm.io/gorm"
)

// GetUserLibrary retrieves the user's personal library, creating it if it doesn't exist
func GetUserLibrary(userID uint, userName string) (*models.Library, error) {
	var library models.Library

	// Try to find existing personal library
	err := db.Connection.Where("owner_id = ? AND is_personal = ?", userID, true).First(&library).Error

	if err == nil {
		// Library found
		return &library, nil
	}

	if err != gorm.ErrRecordNotFound {
		// Unexpected error
		return nil, fmt.Errorf("failed to query personal library: %w", err)
	}

	// Library doesn't exist, create it
	library = models.Library{
		Name:        "My Library",
		Description: "Personal library",
		OwnerID:     userID,
		IsPersonal:  true,
	}

	if err := db.Connection.Create(&library).Error; err != nil {
		return nil, fmt.Errorf("failed to create personal library: %w", err)
	}

	return &library, nil
}

// GetUserLibraries returns all libraries owned by a user, ordered with personal first then alphabetical
func GetUserLibraries(userID uint) ([]models.Library, error) {
	var libraries []models.Library
	err := db.Connection.
		Where("owner_id = ?", userID).
		Order("is_personal DESC, name ASC").
		Find(&libraries).Error
	if err != nil {
		return nil, fmt.Errorf("failed to query user libraries: %w", err)
	}
	return libraries, nil
}

// GetLibraryByPublicID returns a single library by its public ID, scoped to the user
func GetLibraryByPublicID(publicID string, userID uint) (*models.Library, error) {
	var library models.Library
	err := db.Connection.
		Preload("Files").
		Where("public_id = ? AND owner_id = ?", publicID, userID).
		First(&library).Error
	if err != nil {
		return nil, fmt.Errorf("failed to find library: %w", err)
	}
	return &library, nil
}

// CreateLibrary creates a new non-personal library for a user
func CreateLibrary(userID uint, name string) (*models.Library, error) {
	library := models.Library{
		Name:       name,
		OwnerID:    userID,
		IsPersonal: false,
	}
	if err := db.Connection.Create(&library).Error; err != nil {
		return nil, fmt.Errorf("failed to create library: %w", err)
	}
	return &library, nil
}

// RenameLibrary updates the name of a library owned by the user
func RenameLibrary(publicID string, userID uint, newName string) (*models.Library, error) {
	library, err := GetLibraryByPublicID(publicID, userID)
	if err != nil {
		return nil, err
	}

	if library.IsPersonal {
		return nil, fmt.Errorf("cannot rename your personal library")
	}

	library.Name = newName
	if err := db.Connection.Save(library).Error; err != nil {
		return nil, fmt.Errorf("failed to rename library: %w", err)
	}
	return library, nil
}

// DeleteLibrary deletes a non-personal library owned by the user
func DeleteLibrary(publicID string, userID uint) error {
	library, err := GetLibraryByPublicID(publicID, userID)
	if err != nil {
		return err
	}

	if library.IsPersonal {
		return fmt.Errorf("cannot delete your personal library")
	}

	if len(library.Files) > 0 {
		return fmt.Errorf("you must delete all items in the library first")
	}

	if err := db.Connection.Delete(library).Error; err != nil {
		return fmt.Errorf("failed to delete library: %w", err)
	}
	return nil
}
