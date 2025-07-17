package routers

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/root"
)

func RootRouter(e *echo.Echo) {
	e.GET("/", root.GetRoot, auth.SessionAuthMiddleware())
	e.GET("/health", root.GetHealthcheck)
}
