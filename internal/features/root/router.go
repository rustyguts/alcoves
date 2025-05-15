package root

import (
	"github.com/gin-gonic/gin"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(router *gin.Engine) {
	// Serve static files
	router.Static("/static", "./web/static")

	// Root route with authentication
	router.GET("/", middleware.SessionAuthMiddleware(), GetRoot)
}
