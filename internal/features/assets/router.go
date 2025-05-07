package assets

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(app fiber.Router) {
	router := app.Group("/assets", middleware.SessionAuthMiddleware())

	router.Get("/assets/:asset_id", GetAsset)
	router.Post("/assets/upload", UploadAssets)
}
