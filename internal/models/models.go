package models

import "gorm.io/gorm"

type User struct {
	gorm.Model
	Assets []Asset `gorm:"foreignKey:OwnerID"`
}

type Asset struct {
	gorm.Model
	OwnerID        uint
	SourceFilename string
}
