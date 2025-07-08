package main

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"text/template"

	"github.com/gorilla/sessions"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/features/assets"
	"github.com/rustyguts/alcoves/internal/features/auth"
	"github.com/rustyguts/alcoves/internal/features/root"
)

type Template struct {
	templates *template.Template
}

func (t *Template) Render(w io.Writer, name string, data interface{}, c echo.Context) error {
	return t.templates.ExecuteTemplate(w, name, data)
}

func main() {
	db.Initialize()
	config.InitVips()
	e := echo.New()

	// Load templates
	tmpl := template.New("")
	tmpl = template.Must(tmpl.ParseGlob("web/layouts/*.html"))
	tmpl = template.Must(tmpl.ParseGlob("web/partials/*.html"))
	tmpl = template.Must(tmpl.ParseGlob("web/views/*.html"))
	t := &Template{
		templates: tmpl,
	}
	e.Renderer = t

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	// Session middleware
	e.Use(session.Middleware(sessions.NewCookieStore([]byte("secret-key-change-in-production"))))

	// Setup routers
	root.Router(e)
	auth.Router(e)
	assets.Router(e)

	e.Static("/", "./web/public")

	if err := e.Start(":8080"); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("failed to start server", "error", err)
	}
}
