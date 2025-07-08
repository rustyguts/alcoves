package auth

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(e *echo.Echo) {
	e.GET("/login", GetLogin)
	e.POST("/login", PostLogin)

	e.GET("/register", GetRegister)
	e.POST("/register", PostRegister)

	e.POST("/logout", PostLogout, middleware.SessionAuthMiddleware())
}
