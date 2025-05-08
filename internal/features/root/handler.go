package root

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/features/assets"
)

func GetRoot(c *fiber.Ctx) error {
	return c.Render("index", fiber.Map{
		"title":  "Alcoves",
		"User":   c.Locals("user"),
		"Assets": assets.GetUserAssets(c),
	})
}
