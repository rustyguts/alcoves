package admin

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
)

func RegisterRoutes(e *echo.Echo) {
	adminGroup := e.Group("/admin", auth.SessionAuthMiddleware(), auth.AdminMiddleware())

	adminGroup.GET("", GetAdmin)
	adminGroup.PUT("/users/:id/role", PutUserRole)
}
