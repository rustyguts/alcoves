package auth

import (
	"github.com/rustyguts/alcoves/internal/features/assets"
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Assets []assets.Asset `gorm:"foreignKey:OwnerID"`
}
