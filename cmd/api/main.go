package main

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/template/html/v2"
)

func main() {
	engine := html.New("./web/views", ".html")
	app := fiber.New(fiber.Config{
		Views:       engine,
		ViewsLayout: "layouts/main",
	})

	app.Get("/", func(c *fiber.Ctx) error {
		return c.Render("index", fiber.Map{
			"title":      "Alcoves",
			"data_theme": "dark",
		})
	})

	app.Static("/", "./web/static")

	app.Listen(":3000")
}
