package models

import (
	"fmt"

	"gorm.io/gorm"
)

type Library struct {
	gorm.Model
	Name        string `json:"name" gorm:"not null"`
	Description string `json:"description"`
	OwnerID     uint   `json:"owner_id" gorm:"not null;index"`
	Owner       User   `json:"owner" gorm:"foreignKey:OwnerID"`
	IsPersonal  bool   `json:"is_personal" gorm:"default:false;index"`
	Files       []File `json:"files" gorm:"foreignKey:LibraryID"`
}

// CreatePersonalLibrary creates a personal library for a user
func CreatePersonalLibrary(db *gorm.DB, userID uint, userName string) (*Library, error) {
	library := Library{
		Name:        fmt.Sprintf("%s's Library", userName),
		Description: "Personal library",
		OwnerID:     userID,
		IsPersonal:  true,
	}

	if err := db.Create(&library).Error; err != nil {
		return nil, fmt.Errorf("failed to create personal library: %w", err)
	}

	return &library, nil
}
