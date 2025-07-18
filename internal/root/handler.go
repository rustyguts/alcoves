package root

import (
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/assets"
)

func GetHealthcheck(c echo.Context) error {
	return c.String(http.StatusOK, "OK")
}

func GetRoot(c echo.Context) error {
	user := c.Get("user")
	userAssets := assets.GetUserAssets(c)
	data := echo.Map{
		"title":  "Alcoves",
		"User":   user,
		"Assets": userAssets,
	}
	return c.Render(http.StatusOK, "home", data)
}

func GetMedia(c echo.Context) error {
	assetId := c.Param("assetId")
	fmt.Println(assetId)

	asset := assets.GetAssetByPublicID(assetId)

	user := c.Get("user")
	data := echo.Map{
		"title": "Media - Alcoves",
		"User":  user,
		"Asset": asset,
	}
	return c.Render(http.StatusOK, "media", data)
}
