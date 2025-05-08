package assets

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Asset struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	PublicID  string    `json:"public_id" gorm:"uniqueIndex"`
	Type      string    `json:"type"`
	Size      int64     `json:"size"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Hash      string    `json:"hash"`
	Filepath  string    `json:"filepath"`
	Filename  string    `json:"filename"`
	CTime     time.Time `json:"ctime"`
	UserID    uint      `json:"user_id" gorm:"index"`
}

func (asset *Asset) BeforeCreate(tx *gorm.DB) error {
	if asset.PublicID == "" {
		asset.PublicID = uuid.New().String()
	}
	return nil
}
