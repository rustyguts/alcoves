package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/db"
)

func PostLogin(c *fiber.Ctx) error {
	sess, err := db.SessionStore.Get(c)
	if err != nil {
		panic(err)
	}
	sess.Set("name", "alcoves")
	sess.Set("user", 1)
	// sess.Set("email", "test")
	// sess.Set("is_admin", true)

	// Save session
	if err := sess.Save(); err != nil {
		panic(err)
	}
	return c.SendString("Logged in")
}
