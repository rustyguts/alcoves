package root

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/features/assets"
)

func GetRoot(c *fiber.Ctx) error {
	user := c.Locals("user").(uint)

	var userAssets []assets.Asset
	result := db.DBConn.Where("user_id = ?", user).Order("created_at DESC").Find(&userAssets)
	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to fetch assets")
	}

	return c.Render("index", fiber.Map{
		"title":  "Alcoves",
		"User":   c.Locals("user"),
		"Assets": userAssets,
	})
}
