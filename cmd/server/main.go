package main

import (
	"log"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/routers"
)

//go:generate templ generate
//go:generate sh -c "cd ../ && bun install && bun run build"

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

	routers.RootRouter(e)
	routers.AuthRouter(e)
	routers.AssetsRouter(e)

	log.Println("setting up static routers...")
	e.Static("/", "./static")

	log.Fatal(e.Start(":8080"))
}
