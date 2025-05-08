package assets

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(app fiber.Router) {
	router := app.Group("/assets", middleware.SessionAuthMiddleware())

	router.Get("/", func(c *fiber.Ctx) error {
		assets := GetUserAssets(c)
		return c.JSON(assets)
	})

	router.Get("/:asset_id", GetAsset)
	router.Post("/upload", UploadAssets)
}
