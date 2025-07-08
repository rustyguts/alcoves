package auth

import (
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/rustyguts/alcoves/internal/models"
	"golang.org/x/crypto/bcrypt"
)

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func CreateUserSession(c *gin.Context, user models.User) error {
	session := sessions.Default(c)
	session.Set("ip", c.ClientIP())
	session.Set("user_agent", c.GetHeader("User-Agent"))
	session.Set("user", user.ID)
	session.Set("email", user.Email)

	if err := session.Save(); err != nil {
		return err
	}

	return nil
}
