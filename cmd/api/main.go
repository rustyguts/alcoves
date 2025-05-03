package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/gofiber/contrib/otelfiber/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/template/html/v2"
	"github.com/google/uuid"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	"github.com/rustyguts/alcoves/internal/otel"
)

var DATA_STORAGE_PATH = "/data/uploads/"

func EnsureDirectories() {
	if _, err := os.Stat(DATA_STORAGE_PATH); os.IsNotExist(err) {
		err := os.MkdirAll(DATA_STORAGE_PATH, os.ModePerm)
		if err != nil {
			log.Fatalf("Failed to create directory: %v", err)
		}
	}
}

func GetBook(c *fiber.Ctx) error {
	id := c.Params("id")
	var asset models.Asset
	db.DBConn.Find(&asset, id)
	return c.JSON(asset)
}

func main() {
	db.InitDB()
	db.Migrate()

	EnsureDirectories()

	vips.Startup(nil)
	defer vips.Shutdown()

	if os.Getenv("ALCOVES_ENABLE_TRACING") == "true" {
		tp := otel.InitTracer()
		defer func() {
			if err := tp.Shutdown(context.Background()); err != nil {
				log.Printf("Error shutting down tracer provider: %v", err)
			}
		}()
		log.Println("OpenTelemetry tracing enabled")
	} else {
		log.Println("OpenTelemetry tracing disabled")
	}

	engine := html.New("./web/views", ".html")

	app := fiber.New(fiber.Config{
		Views:             engine,
		ViewsLayout:       "layouts/main",
		StreamRequestBody: true,
		// BodyLimit:         100 * 1024 * 1024, // 100MB
	})

	app.Use(recover.New())
	app.Use(otelfiber.Middleware())

	app.Get("/", func(c *fiber.Ctx) error {
		return c.Render("index", fiber.Map{
			"title":      "Alcoves",
			"data_theme": "dark",
		})
	})

	app.Post("/upload", func(c *fiber.Ctx) error {
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to process form data",
			})
		}
		files := form.File["files"]

		if len(files) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "No files uploaded",
			})
		}

		for _, file := range files {
			fmt.Println(file.Filename, file.Size, file.Header["Content-Type"][0])
			asset := models.Asset{}
			asset.SourceFilename = file.Filename
			// get a uuud
			asset.SourceFilename = uuid.New().String() + ".jpg"
			err := c.SaveFile(file, DATA_STORAGE_PATH+file.Filename)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to save file: " + err.Error(),
				})
			}
		}

		return c.Redirect("/", fiber.StatusSeeOther)
	})

	app.Get("/uploads/:filename", func(c *fiber.Ctx) error {
		filename := c.Params("filename")
		filepath := "/data/uploads/" + filename

		m := c.Queries()
		fmt.Print(m)

		height := 0
		max_width := 8000
		recommended_width := 8000

		width, _ := strconv.Atoi(m["width"])
		if width <= 0 {
			width = recommended_width
		}

		if width > max_width {
			width = max_width
		}

		fmt.Println("Width:", width)
		fmt.Println("Filepath:", filepath)

		// https://www.libvips.org/API/current/libvips-conversion.html#VipsInteresting

		image, err := vips.NewThumbnailFromFile(filepath, width, height, vips.InterestingNone)
		if err != nil {
			fmt.Println("Error opening image:", err)
		}

		image.Height()
		width.Width()

		err = image.AutoRotate()
		if err != nil {
			fmt.Println("Error auto-rotating image:", err)
		}

		ep := vips.NewJpegExportParams()
		ep.StripMetadata = true
		ep.Quality = 90
		ep.Interlace = true
		ep.OptimizeCoding = true
		ep.SubsampleMode = vips.VipsForeignSubsampleAuto
		ep.TrellisQuant = true
		ep.OvershootDeringing = true
		ep.OptimizeScans = true
		ep.QuantTable = 3

		imageBytes, _, err := image.ExportJpeg(ep)
		if err != nil {
			fmt.Println("Error exporting image:", err)
		}
		// Save the image to a file
		err = os.WriteFile("output.jpg", imageBytes, 0644)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "Failed to save image")
		}

		err = filesystem.SendFile(c, http.Dir("."), "output.jpg")
		if err != nil {
			return c.Status(fiber.StatusNotFound).SendString("File not found")
		}

		return nil
	})

	app.Static("/", "./web/static")

	log.Println("Starting server on :3000")
	if err := app.Listen(":3000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
