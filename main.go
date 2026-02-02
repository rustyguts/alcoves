package main

import (
	"log"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rustyguts/alcoves/internal/admin"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/files"
	"github.com/rustyguts/alcoves/internal/libraries"
)

//go:generate templ generate -path internal/components
//go:generate tailwindcss -i static/css/input.css -o static/css/main.css

// https://dev.to/b_myers/golang-api-structure-for-beginners-1of6
func main() {
	e := echo.New()
	log.Println("starting Alcoves server...")

	log.Println("initializing image processing library...")
	vips.Startup(nil)
	defer vips.Shutdown()

	log.Println("initializing global config...")
	cfg := config.InitializeConfig()
	log.Println("configuration loaded:", cfg)

	log.Println("initializing database...")
	_, err := db.Initialize()
	if err != nil {
		panic("Failed to initialize database: " + err.Error())
	}

	log.Println("setting up middleware...")
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	log.Println("setting up routers...")

	auth.RegisterRoutes(e)
	files.RegisterRoutes(e)
	libraries.RegisterRoutes(e)
	admin.RegisterRoutes(e)

	log.Println("setting up static routers...")
	e.Static("/", "./static")
	e.GET("/", files.GetRoot, auth.SessionAuthMiddleware())

	log.Fatal(e.Start(":8080"))
}
