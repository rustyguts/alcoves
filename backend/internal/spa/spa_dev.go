//go:build dev

package spa

import "github.com/labstack/echo/v4"

// RegisterRoutes is a no-op in dev mode.
// The frontend runs via Vite dev server and proxies API calls to this backend.
func RegisterRoutes(_ *echo.Echo) {}
