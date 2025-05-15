package assets

import (
	"github.com/gin-gonic/gin"
	"github.com/rustyguts/alcoves/internal/middleware"
)

func Router(router *gin.Engine) {
	assetGroup := router.Group("/assets", middleware.SessionAuthMiddleware())
	{
		assetGroup.GET("/", func(c *gin.Context) {
			assets := GetUserAssets(c)
			c.JSON(200, assets)
		})

		assetGroup.GET("/:asset_id", GetAsset)
		assetGroup.POST("/upload", UploadAssets)
	}
}
