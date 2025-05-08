package auth

import (
	"github.com/rustyguts/alcoves/internal/features/assets"
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Email    string         `gorm:"uniqueIndex;not null"`
	Password string         `gorm:"not null"`
	Assets   []assets.Asset `gorm:"foreignKey:UserID"`
}
