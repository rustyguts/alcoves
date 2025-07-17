package auth

import (
	"fmt"
	"net/http"

	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
)

func SessionAuthMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			sess, err := session.Get("session", c)
			if err != nil {
				return c.Redirect(http.StatusFound, "/login")
			}

			userID := sess.Values["user"]
			fmt.Println("userID", userID, c.Request().Host, c.Request().URL.Path)

			if userID == nil {
				return c.Redirect(http.StatusFound, "/login")
			}

			c.Set("user", userID)
			return next(c)
		}
	}
}
