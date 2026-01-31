package folders

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
)

// RegisterRoutes registers folder-related routes
func RegisterRoutes(e *echo.Echo) {
	folderGroup := e.Group("/folders", auth.SessionAuthMiddleware())

	folderGroup.POST("/create", PostCreateFolder)
	folderGroup.PUT("/rename", PutRenameFolder)
	folderGroup.DELETE("/:publicID", DeleteFolderHandler)
	folderGroup.POST("/:publicID/files", PostMoveFileToFolder)
	folderGroup.POST("/:publicID/move", PostMoveFolder)
	folderGroup.GET("/:publicID", GetFolderContents)
}
