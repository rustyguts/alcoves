package models

import (
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Library struct {
	gorm.Model
	PublicID    string `json:"public_id" gorm:"uniqueIndex;not null"`
	Name        string `json:"name" gorm:"not null"`
	Description string `json:"description"`
	OwnerID     uint   `json:"owner_id" gorm:"not null;index"`
	Owner       User   `json:"owner" gorm:"foreignKey:OwnerID"`
	IsPersonal  bool   `json:"is_personal" gorm:"default:false;index"`
	Files       []File `json:"files" gorm:"foreignKey:LibraryID"`
}

func (library *Library) BeforeCreate(tx *gorm.DB) error {
	if library.PublicID == "" {
		library.PublicID = uuid.New().String()
	}
	return nil
}

// CreatePersonalLibrary creates a personal library for a user
func CreatePersonalLibrary(db *gorm.DB, userID uint, userName string) (*Library, error) {
	library := Library{
		Name:        "My Library",
		Description: "Personal library",
		OwnerID:     userID,
		IsPersonal:  true,
	}

	if err := db.Create(&library).Error; err != nil {
		return nil, fmt.Errorf("failed to create personal library: %w", err)
	}

	return &library, nil
}
