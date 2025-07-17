package auth

import (
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
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

func CreateUserSession(c echo.Context, user models.User) error {
	sess, err := session.Get("session", c)
	if err != nil {
		return err
	}

	sess.Values["ip"] = c.RealIP()
	sess.Values["user_agent"] = c.Request().Header.Get("User-Agent")
	sess.Values["user"] = user.ID
	sess.Values["email"] = user.Email

	if err := sess.Save(c.Request(), c.Response()); err != nil {
		return err
	}

	return nil
}
