package auth

import (
	"github.com/labstack/echo/v4"
)

func RegisterRoutes(e *echo.Echo) {
	e.GET("/login", GetLogin)
	e.POST("/login", PostLogin)

	e.GET("/register", GetRegister)
	e.POST("/register", PostRegister)

	e.POST("/logout", PostLogout, SessionAuthMiddleware())
	e.POST("/update-theme", PostUpdateTheme, SessionAuthMiddleware())
}
