package libraries

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
)

func RegisterRoutes(e *echo.Echo) {
	libraryGroup := e.Group("/libraries", auth.SessionAuthMiddleware())

	libraryGroup.POST("/create", PostCreateLibrary)
	libraryGroup.PUT("/rename", PutRenameLibrary)
	libraryGroup.DELETE("/:publicID", DeleteLibraryHandler)
	libraryGroup.GET("/:publicID", GetLibraryView)
}
