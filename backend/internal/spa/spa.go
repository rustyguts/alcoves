//go:build !dev

package spa

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

//go:embed dist/*
var distFS embed.FS

// RegisterRoutes serves the embedded SPA frontend.
// Must be called AFTER all /api routes are registered.
func RegisterRoutes(e *echo.Echo) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic("spa: failed to open embedded dist: " + err.Error())
	}

	fileServer := http.FileServer(http.FS(sub))

	e.GET("/*", echo.WrapHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Skip API routes
		if strings.HasPrefix(path, "/api") {
			http.NotFound(w, r)
			return
		}

		// Try to serve the exact file first
		cleanPath := strings.TrimPrefix(path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		if f, err := sub.Open(cleanPath); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for all non-file routes
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})))
}
