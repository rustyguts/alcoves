package root

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

func getRoot(c echo.Context) error {
	user := c.Get("user")
	data := map[string]interface{}{
		"title": "Alcoves",
		"User":  user,
		// "Assets": assets.GetUserAssets(c),
	}
	return c.Render(http.StatusOK, "index.html", data)
}

func getHealthcheck(c echo.Context) error {
	return c.String(http.StatusOK, "OK")
}
