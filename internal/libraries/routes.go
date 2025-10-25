package libraries

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
)

func RegisterRoutes(e *echo.Echo) {
	libraryGroup := e.Group("/libraries", auth.SessionAuthMiddleware())

	libraryGroup.GET("/", func(c echo.Context) error {
		// List libraries
		return c.String(200, "GET libraries")
	})
}
