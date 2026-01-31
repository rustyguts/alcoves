package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Folder represents a hierarchical folder structure within a library
type Folder struct {
	gorm.Model
	PublicID  string   `json:"public_id" gorm:"uniqueIndex;not null"`
	Name      string   `json:"name" gorm:"not null"`
	LibraryID uint     `json:"library_id" gorm:"not null;index"`
	Library   Library  `json:"library" gorm:"foreignKey:LibraryID"`
	ParentID  *uint    `json:"parent_id" gorm:"index"` // Nullable for root folders
	Parent    *Folder  `json:"parent" gorm:"foreignKey:ParentID"`
	Children  []Folder `json:"children" gorm:"foreignKey:ParentID"`
	Files     []File   `json:"files" gorm:"foreignKey:FolderID"`
	UserID    uint     `json:"user_id" gorm:"not null;index"`
}

func (folder *Folder) BeforeCreate(tx *gorm.DB) error {
	if folder.PublicID == "" {
		folder.PublicID = uuid.New().String()
	}
	return nil
}
