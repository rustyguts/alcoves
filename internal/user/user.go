package user

import (
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
)

func FindUserByEmail(email string) (*models.User, error) {
	var users []models.User
	result := db.Connection.Where("email = ?", email).Find(&users)
	if result.Error != nil {
		return nil, result.Error
	}
	if len(users) == 0 {
		return nil, nil
	}
	return &users[0], nil
}
