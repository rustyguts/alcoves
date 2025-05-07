package root

import "github.com/gofiber/fiber/v2"

func GetRoot(c *fiber.Ctx) error {
	return c.Render("index", fiber.Map{
		"title":      "Alcoves",
		"data_theme": "dark",
		"User":       c.Locals("user"),
	})
}
