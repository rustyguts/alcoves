package root

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/middleware"
)

// This router is a little different from the others.
// It does not use a router group so as not to interfere
// with the static file serving and global middleware.
func Router(app fiber.Router) {
	app.Static("/", "./web/static")
	app.Get("/", middleware.SessionAuthMiddleware(), GetRoot)
}
