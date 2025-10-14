package routers

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
)

func LibraryRouter(e *echo.Echo) {
	assetGroup := e.Group("/libraries", auth.SessionAuthMiddleware())

	assetGroup.GET("/", func(c echo.Context) error {
		// List libraries
		return c.String(200, "GET libraries")
	})
}
