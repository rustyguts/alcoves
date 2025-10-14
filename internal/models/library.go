package models

import (
	"gorm.io/gorm"
)

type Library struct {
	gorm.Model
	Name string `json:"name"`
}
