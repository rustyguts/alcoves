package models

import (
	"time"

	"gorm.io/gorm"
)

type Session struct {
	gorm.Model
	UserID      uint      `json:"user_id" gorm:"index"`
	UserName    string    `json:"user_name"`
	UserPicture string    `json:"user_picture"`
	SessionID   string    `json:"session_id"`
	IPAddress   string    `json:"ip_address"`
	UserAgent   string    `json:"user_agent"`
	ExpiresAt   time.Time `json:"expires_at"`
}
