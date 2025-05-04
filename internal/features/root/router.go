package root

import (
	"github.com/gofiber/fiber/v2"
)

func Router(app fiber.Router) {
	app.Get("/", GetRoot)
}
