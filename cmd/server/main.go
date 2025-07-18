package main

import (
	"io"
	"log"
	"net/http"
	"text/template"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/routers"
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
	e := echo.New()
	log.Println("starting Alcoves server...")

	log.Println("initializing image processing library...")
	vips.Startup(nil)
	defer vips.Shutdown()

	log.Println("initializing global config...")
	cfg := config.InitializeConfig()
	log.Println("configuration loaded:", cfg)

	log.Println("initializing database...")
	_, err := db.Initialize()
	if err != nil {
		panic("Failed to initialize database: " + err.Error())
	}

	log.Println("initializing templates...")
	templates := make(map[string]*template.Template)
	templates["home"] = loadTemplateSet(
		"web/layouts/base.html",
		"web/layouts/index.html",
		"web/partials/*.html",
	)
	templates["media"] = loadTemplateSet(
		"web/layouts/base.html",
		"web/views/media.html",
		"",
	)
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

	log.Println("initializing template rendering...")
	t := &TemplateRegistry{
		templates: templates,
	}
	e.Renderer = t

	log.Println("setting up middleware...")
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	log.Println("setting up routers...")
	routers.RootRouter(e)
	routers.AuthRouter(e)
	routers.AssetsRouter(e)

	log.Println("setting up static routers...")
	e.Static("/", "./web/public")

	log.Fatal(e.Start(":8080"))
}
