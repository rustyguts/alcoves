package middleware

import (
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/db"
)

func SessionAuthMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		sess, err := db.SessionStore.Get(c)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to get session")
		}

		userID := sess.Get("user")
		fmt.Println("userID", userID, c.BaseURL(), c.Path())

		if userID == nil {
			return c.Redirect("/login")
		}

		c.Locals("user", userID)

		return c.Next()
	}
}
