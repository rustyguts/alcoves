package testing

import (
	"io"

	"github.com/labstack/echo/v4"
)

type MockRenderer struct{}

func (m *MockRenderer) Render(w io.Writer, name string, data any, c echo.Context) error {
	return nil
}

func SetupTestEcho() *echo.Echo {
	e := echo.New()
	e.Renderer = &MockRenderer{}
	return e
}
