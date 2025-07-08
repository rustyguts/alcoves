package main

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/signal"
	"text/template"
	"time"

	"github.com/davidbyttow/govips/v2/vips"
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
	vips.Startup(nil)
	defer vips.Shutdown()

	config.EnsureDirectories()

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

	// Graceful shutdown setup
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// Start server in a goroutine
	go func() {
		if err := e.Start(":8080"); err != nil && err != http.ErrServerClosed {
			e.Logger.Fatal("shutting down the server")
		}
	}()

	// Wait for interrupt signal to gracefully shut down the server with a timeout of 10 seconds.
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(shutdownCtx); err != nil {
		e.Logger.Fatal(err)
	}
}
