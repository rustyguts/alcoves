package routers

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/root"
)

func RootRouter(e *echo.Echo) {
	e.GET("/health", root.GetHealthcheck)

	e.GET("/", root.GetRoot, auth.SessionAuthMiddleware())
	e.GET("/media/:assetId", root.GetMedia, auth.SessionAuthMiddleware())
}
