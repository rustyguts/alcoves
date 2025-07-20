package routers

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/assets"
	"github.com/rustyguts/alcoves/internal/auth"
)

func AssetsRouter(e *echo.Echo) {
	assetGroup := e.Group("/assets", auth.SessionAuthMiddleware())

	assetGroup.GET("/", func(c echo.Context) error {
		assets := assets.GetUserAssets(c)
		return c.JSON(200, assets)
	})

	assetGroup.GET("/:asset_id", assets.GetAsset)
	assetGroup.POST("/upload", assets.UploadAssets)
	assetGroup.POST("/delete", assets.DeleteAssets)
	assetGroup.POST("/restore", assets.RestoreAssets)
	assetGroup.GET("/download/:asset_id", assets.DownloadAsset)
	assetGroup.GET("/download", assets.DownloadAssets)
}
