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

type TemplateRegistry struct {
	templates map[string]*template.Template
}

func (t *TemplateRegistry) Render(w io.Writer, name string, data interface{}, c echo.Context) error {
	tmpl, ok := t.templates[name]
	if !ok {
		return echo.NewHTTPError(http.StatusInternalServerError, "Template not found")
	}
	return tmpl.ExecuteTemplate(w, "base", data)
}

// loadTemplateSet loads a set of template files for a specific page
func loadTemplateSet(baseFile string, pageFile string, partials string) *template.Template {
	tmpl := template.Must(template.ParseFiles(baseFile, pageFile))
	if partials != "" {
		tmpl = template.Must(tmpl.ParseGlob(partials))
	}
	return tmpl
}

func main() {
	db.Initialize()
	config.InitVips()
	e := echo.New()
	// Load templates with nested structure using helper function
	templates := make(map[string]*template.Template)

	// Home page template set
	templates["home"] = loadTemplateSet(
		"web/layouts/base.html",
		"web/layouts/index.html",
		"web/partials/*.html",
	)

	// Auth pages template set
	templates["login"] = loadTemplateSet(
		"web/layouts/base.html",
		"web/views/login.html",
		"",
	)

	templates["register"] = loadTemplateSet(
		"web/layouts/base.html",
		"web/views/register.html",
		"",
	)

	t := &TemplateRegistry{
		templates: templates,
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
