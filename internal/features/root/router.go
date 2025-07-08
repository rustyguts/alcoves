package root

import (
	"github.com/labstack/echo/v4"
)

func Router(e *echo.Echo) {
	e.Static("/static", "./web/static")

	e.GET("/", getRoot)
	e.GET("/health", getHealthcheck)
}
