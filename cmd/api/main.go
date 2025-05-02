package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/gofiber/template/html/v2"
)

var DATA_STORAGE_PATH = "/data/uploads/"

func ensure_directories() {
	if _, err := os.Stat(DATA_STORAGE_PATH); os.IsNotExist(err) {
		err := os.MkdirAll(DATA_STORAGE_PATH, os.ModePerm)
		if err != nil {
			log.Fatalf("Failed to create directory: %v", err)
		}
	}
}

func main() {
	vips.Startup(nil)
	defer vips.Shutdown()

	ensure_directories()

	engine := html.New("./web/views", ".html")
	app := fiber.New(fiber.Config{
		Views:       engine,
		ViewsLayout: "layouts/main",
		BodyLimit:   100 * 1024 * 1024, // 100MB
	})

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

		uploadedFiles := []string{}

		for _, file := range files {
			fmt.Println(file.Filename, file.Size, file.Header["Content-Type"][0])
			err := c.SaveFile(file, DATA_STORAGE_PATH+file.Filename)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to save file: " + err.Error(),
				})
			}
			uploadedFiles = append(uploadedFiles, file.Filename)
		}

		return c.Redirect("/", fiber.StatusSeeOther)
	})

	app.Get("/test.jpg", func(c *fiber.Ctx) error {
		filepath := "./web/static/test.jpg"
		// https://www.libvips.org/API/current/libvips-conversion.html#VipsInteresting
		image, err := vips.NewThumbnailFromFile(filepath, 400, 0, vips.InterestingNone)
		if err != nil {
			fmt.Println("Error opening image:", err)
		}

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
