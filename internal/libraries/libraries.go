package libraries

import (
	"fmt"

	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
)

// CreatePersonalLibrary creates a personal library for a user
func CreatePersonalLibrary(userID uint, userName string) (*models.Library, error) {
	library := models.Library{
		Name:        fmt.Sprintf("%s's Library", userName),
		Description: "Personal library",
		OwnerID:     userID,
		IsPersonal:  true,
	}

	if err := db.Connection.Create(&library).Error; err != nil {
		return nil, fmt.Errorf("failed to create personal library: %w", err)
	}

	return &library, nil
}
