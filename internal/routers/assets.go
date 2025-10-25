package routers

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/auth"
	"github.com/rustyguts/alcoves/internal/files"
)

func AssetsRouter(e *echo.Echo) {
	assetGroup := e.Group("/assets", auth.SessionAuthMiddleware())

	assetGroup.GET("/", func(c echo.Context) error {
		userFiles := files.GetUserFiles(c)
		return c.JSON(200, userFiles)
	})

	assetGroup.GET("/:asset_id", files.GetFile)
	assetGroup.POST("/upload", files.UploadFiles)
	assetGroup.POST("/delete", files.DeleteFiles)
	assetGroup.POST("/restore", files.RestoreFiles)
	assetGroup.GET("/download/:asset_id", files.DownloadFile)
	assetGroup.GET("/download", files.DownloadFiles)
}
