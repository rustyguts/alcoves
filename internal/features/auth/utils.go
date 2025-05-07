package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/db"
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

func CreateUserSession(c *fiber.Ctx, user User) error {
	sess, err := db.SessionStore.Get(c)
	if err != nil {
		panic(err)
	}
	sess.Set("ip", c.IP())
	sess.Set("user_agent", c.Get("User-Agent"))
	sess.Set("user", user.ID)
	sess.Set("email", user.Email)

	if err := sess.Save(); err != nil {
		panic(err)
	}

	return c.Redirect("/")
}
