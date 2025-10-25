package models

import (
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
