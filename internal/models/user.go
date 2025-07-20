package models

import (
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Email    string    `gorm:"uniqueIndex;not null"`
	Password string    `gorm:"not null"`
	Theme    string    `gorm:"default:'dark'"`
	Sessions []Session `gorm:"foreignKey:UserID"`
	Assets   []Asset   `gorm:"foreignKey:UserID"`
}
