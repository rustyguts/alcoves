package assets

import "gorm.io/gorm"

type Asset struct {
	gorm.Model
	OwnerID        uint
	SourceFilename string
}
