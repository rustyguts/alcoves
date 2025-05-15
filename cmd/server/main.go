package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-contrib/multitemplate"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"

	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/features/assets"
	"github.com/rustyguts/alcoves/internal/features/auth"
	"github.com/rustyguts/alcoves/internal/features/root"
)

// createRenderer creates a multitemplate renderer for handling HTML templates
func createRenderer() multitemplate.Renderer {
	r := multitemplate.NewRenderer()

	// Add individual templates
	r.AddFromFiles("login.html", "web/views/layouts/main.html", "web/views/login.html")
	r.AddFromFiles("register.html", "web/views/layouts/main.html", "web/views/register.html")
	r.AddFromFiles("index.html", "web/views/layouts/main.html", "web/views/index.html")

	// Add any partials
	// Example: r.AddFromFiles("partial.html", "web/views/partials/partial.html")

	return r
}

func main() {
	db.InitDB()

	db.DBConn.AutoMigrate(&auth.User{})
	db.DBConn.AutoMigrate(&assets.Asset{})

	config.EnsureDirectories()

	config.InitOtel()
	config.InitVips()

	// Create Gin instance with default middleware
	router := gin.Default()

	// Set up HTML rendering
	router.HTMLRender = createRenderer()

	// Set up session middleware
	router.Use(sessions.Sessions("alcoves_session", db.SessionStore))

	// Add OpenTelemetry middleware
	router.Use(otelgin.Middleware("alcoves"))

	// Apply routers
	root.Router(router)
	auth.Router(router)
	assets.Router(router)

	// Set up graceful shutdown
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-c
		log.Println("Gracefully shutting down...")
		config.ShutdownVips()
	}()

	log.Println("Starting server on :3000")
	if err := router.Run(":3000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
