package assets

import "github.com/gofiber/fiber/v2"

func Router(app fiber.Router) {
	app.Get("/assets/:asset_id", GetAsset)
	app.Post("/assets/upload", UploadAssets)
}
