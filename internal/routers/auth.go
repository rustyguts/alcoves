package routers

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
)

func AuthRouter(e *echo.Echo) {
	e.GET("/login", auth.GetLogin)
	e.POST("/login", auth.PostLogin)

	e.GET("/register", auth.GetRegister)
	e.POST("/register", auth.PostRegister)

	e.POST("/logout", auth.PostLogout, auth.SessionAuthMiddleware())
}
