package root

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/assets"
)

func GetRoot(c echo.Context) error {
	user := c.Get("user")
	userAssets := assets.GetUserAssets(c)
	data := map[string]interface{}{
		"title":  "Alcoves",
		"User":   user,
		"Assets": userAssets,
	}
	return c.Render(http.StatusOK, "home", data)
}

func GetHealthcheck(c echo.Context) error {
	return c.String(http.StatusOK, "OK")
}
