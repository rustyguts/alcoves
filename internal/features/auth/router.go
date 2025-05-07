package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(app fiber.Router) {
	app.Get("/login", GetLogin)
	app.Post("/login", PostLogin)

	app.Get("/register", GetRegister)
	app.Post("/register", PostRegister)

	app.Post("/logout", middleware.SessionAuthMiddleware(), PostLogout)
}
