package assets

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"mime/multipart"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/google/uuid"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
)

// URLNamespace is the UUID namespace for URL-based identifiers (RFC 4122)
// This is used to generate deterministic UUIDs for image proxies
const URLNamespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

func GetAsset(c *fiber.Ctx) error {
	// Get and sort query parameters for deterministic proxy ID
	queryParams := c.Queries()
	keys := make([]string, 0, len(queryParams))
	for k := range queryParams {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Build deterministic name from public ID and sorted query params
	var nameBuilder strings.Builder
	nameBuilder.WriteString(c.Params("asset_id"))
	for _, k := range keys {
		nameBuilder.WriteString(k)
		nameBuilder.WriteString(queryParams[k])
	}

	// Generate deterministic UUID v5 using the URL namespace and sorted query params
	proxyID := uuid.NewSHA1(uuid.MustParse(URLNamespace), []byte(nameBuilder.String())).String()

	// Check if proxy already exists in cache
	proxyPath := filepath.Join(config.ASSETS_CACHE_PATH, proxyID+".jpg")
	if _, err := os.Stat(proxyPath); err == nil {
		// Proxy exists, serve it directly
		return filesystem.SendFile(c, http.Dir("."), proxyPath)
	}

	// Cache miss, fetch asset from database
	var asset Asset
	asset.PublicID = c.Params("asset_id")

	db.DBConn.Where("public_id = ?", asset.PublicID).First(&asset)

	if asset.ID == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Asset not found"})
	}

	// Generate new proxy
	img, err := vips.NewImageFromFile(asset.Filepath)
	if err != nil {
		fmt.Println("Error opening image:", err)
		return fiber.NewError(fiber.StatusBadRequest, "Failed to open image")
	}

	original_width := img.Width()
	original_height := img.Height()

	max_width := original_width
	recommended_width := original_height

	width, _ := strconv.Atoi(queryParams["width"])
	if width <= 0 {
		width = recommended_width
	}

	if width > max_width {
		width = max_width
	}

	image, err := vips.NewThumbnailFromFile(asset.Filepath, width, 0, vips.InterestingNone)
	if err != nil {
		fmt.Println("Error opening image:", err)
	}

	fmt.Println("Width:", width)
	fmt.Println("Filepath:", asset.Filepath)

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

	// Save the proxy image
	err = os.WriteFile(proxyPath, imageBytes, 0644)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Failed to save image")
	}

	return filesystem.SendFile(c, http.Dir("."), proxyPath)
}

// createAsset handles the creation of a single asset, including file storage and metadata extraction
func CreateAsset(c *fiber.Ctx, file *multipart.FileHeader) (*Asset, error) {
	user := c.Locals("user").(uint)

	// Create initial asset record
	asset := Asset{
		Type:     file.Header.Get("Content-Type"),
		Size:     file.Size,
		Filename: file.Filename,
		UserID:   user,
	}

	// This will trigger BeforeCreate hook to generate PublicID
	if err := db.DBConn.Create(&asset).Error; err != nil {
		return nil, fmt.Errorf("failed to create asset record: %w", err)
	}

	// Save the original file
	ext := filepath.Ext(file.Filename)
	originalPath := filepath.Join(config.ASSETS_PATH, asset.PublicID+ext)

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open uploaded file: %w", err)
	}
	defer src.Close()

	// Create the destination file
	dst, err := os.Create(originalPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dst.Close()

	// Copy the file contents
	if _, err = io.Copy(dst, src); err != nil {
		return nil, fmt.Errorf("failed to save file: %w", err)
	}

	// Process image with libvips to get metadata
	img, err := vips.NewImageFromFile(originalPath)
	if err != nil {
		return nil, fmt.Errorf("failed to process image: %w", err)
	}

	// Get image dimensions
	asset.Width = img.Width()
	asset.Height = img.Height()

	// Get EXIF data for creation time
	exif := img.GetExif()
	if exif != nil {
		if dateTime, ok := exif["DateTimeOriginal"]; ok {
			if t, err := time.Parse("2006:01:02 15:04:05", fmt.Sprintf("%v", dateTime)); err == nil {
				asset.CTime = t
			}
		}
	}

	// Calculate file hash
	fileData, err := os.ReadFile(originalPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file for hashing: %w", err)
	}
	hash := sha256.Sum256(fileData)
	asset.Hash = hex.EncodeToString(hash[:])

	// Update asset record with metadata
	asset.Filepath = originalPath
	if err := db.DBConn.Save(&asset).Error; err != nil {
		return nil, fmt.Errorf("failed to update asset metadata: %w", err)
	}

	return &asset, nil
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
		_, err := CreateAsset(c, file)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
	}

	return c.Redirect("/", fiber.StatusSeeOther)
}

func GetUserAssets(c *fiber.Ctx) error {
	user := c.Locals("user").(uint)

	var assets []Asset
	result := db.DBConn.Where("user_id = ?", user).Order("created_at DESC").Find(&assets)
	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch assets",
		})
	}

	return c.JSON(assets)
}
