package assets

import (
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(e *echo.Echo) {
	assetGroup := e.Group("/assets", middleware.SessionAuthMiddleware())
	assetGroup.GET("/", func(c echo.Context) error {
		assets := GetUserAssets(c)
		return c.JSON(200, assets)
	})

	assetGroup.GET("/:asset_id", GetAsset)
	assetGroup.POST("/upload", UploadAssets)
}
