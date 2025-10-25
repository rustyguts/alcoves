package files

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
)

func RegisterRoutes(e *echo.Echo) {
	// Asset/File routes
	assetGroup := e.Group("/assets", auth.SessionAuthMiddleware())

	assetGroup.GET("/", func(c echo.Context) error {
		userFiles := GetUserFiles(c)
		return c.JSON(200, userFiles)
	})

	assetGroup.GET("/:asset_id", GetFile)
	assetGroup.POST("/upload", UploadFiles)
	assetGroup.POST("/delete", DeleteFiles)
	assetGroup.POST("/restore", RestoreFiles)
	assetGroup.GET("/download/:asset_id", DownloadFile)
	assetGroup.GET("/download", DownloadFiles)

	// Page view routes (from root/)
	e.GET("/health", GetHealthcheck)
	e.GET("/", GetRoot, auth.SessionAuthMiddleware())
	e.GET("/media/:assetId", GetMedia, auth.SessionAuthMiddleware())
	e.GET("/trash", GetTrash, auth.SessionAuthMiddleware())
}
