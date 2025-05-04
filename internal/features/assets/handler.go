package assets

import (
	"fmt"
	"net/http"
	"os"
	"strconv"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/google/uuid"
	"github.com/rustyguts/alcoves/internal/config"
)

func GetAsset(c *fiber.Ctx) error {
	filename := c.Params("filename")
	filepath := "/data/uploads/" + filename

	m := c.Queries()
	fmt.Print(m)

	img, err := vips.NewImageFromFile(filepath)
	if err != nil {
		fmt.Println("Error opening image:", err)
		return fiber.NewError(fiber.StatusBadRequest, "Failed to open image")
	}

	original_width := img.Width()
	original_height := img.Height()

	max_width := original_width
	recommended_width := original_height

	width, _ := strconv.Atoi(m["width"])
	if width <= 0 {
		width = recommended_width
	}

	if width > max_width {
		width = max_width
	}

	image, err := vips.NewThumbnailFromFile(filepath, width, 0, vips.InterestingNone)
	if err != nil {
		fmt.Println("Error opening image:", err)
	}

	fmt.Println("Width:", width)
	fmt.Println("Filepath:", filepath)

	// https://www.libvips.org/API/current/libvips-conversion.html#VipsInteresting

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
}

func UploadAssets(c *fiber.Ctx) error {
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
		asset := Asset{}
		asset.SourceFilename = file.Filename
		// get a uuud
		asset.SourceFilename = uuid.New().String() + ".jpg"
		err := c.SaveFile(file, config.DATA_STORAGE_PATH+file.Filename)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save file: " + err.Error(),
			})
		}
	}

	return c.Redirect("/", fiber.StatusSeeOther)
}
