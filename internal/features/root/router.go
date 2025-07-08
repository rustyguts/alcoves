package root

import (
	"github.com/labstack/echo/v4"
)

func Router(e *echo.Echo) {
	e.GET("/", getRoot)
	e.GET("/health", getHealthcheck)
}
