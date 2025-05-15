package auth

import (
	"github.com/gin-gonic/gin"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(router *gin.Engine) {
	router.GET("/login", GetLogin)
	router.POST("/login", PostLogin)

	router.GET("/register", GetRegister)
	router.POST("/register", PostRegister)

	router.POST("/logout", middleware.SessionAuthMiddleware(), PostLogout)
}
