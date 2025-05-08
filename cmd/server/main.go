package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/contrib/otelfiber/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/template/html/v2"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/features/assets"
	"github.com/rustyguts/alcoves/internal/features/auth"
	"github.com/rustyguts/alcoves/internal/features/root"
)

func main() {
	db.InitDB()

	db.DBConn.AutoMigrate(&auth.User{})
	db.DBConn.AutoMigrate(&assets.Asset{})

	config.EnsureDirectories()

	config.InitOtel()
	config.InitVips()

	app := fiber.New(fiber.Config{
		StreamRequestBody: true,
		ViewsLayout:       "layouts/main",
		Views:             html.New("./web/views", ".html"),
	})

	app.Use(recover.New())
	app.Use(otelfiber.Middleware())

	root.Router(app)
	auth.Router(app)
	assets.Router(app)

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-c
		log.Println("Gracefully shutting down...")
		_ = app.Shutdown()
		config.ShutdownVips()
	}()

	log.Println("Starting server on :3000")
	if err := app.Listen(":3000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
