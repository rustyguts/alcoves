package root

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(e *echo.Echo) {
	e.GET("/", getRoot, middleware.SessionAuthMiddleware())
	e.GET("/health", getHealthcheck)
}
