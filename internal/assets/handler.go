package assets

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
)

// URLNamespace is the UUID namespace for URL-based identifiers (RFC 4122)
// This is used to generate deterministic UUIDs for image proxies
const URLNamespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

func GetAsset(c echo.Context) error {
	// Get and sort query parameters for deterministic proxy ID
	cacheEnabled := true
	queryParams := c.Request().URL.Query()
	keys := make([]string, 0, len(queryParams))
	for k := range queryParams {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Build deterministic name from public ID and sorted query params
	var nameBuilder strings.Builder
	nameBuilder.WriteString(c.Param("asset_id"))
	for _, k := range keys {
		nameBuilder.WriteString(k)
		nameBuilder.WriteString(queryParams.Get(k))
	}

	// Generate deterministic UUID v5 using the URL namespace and sorted query params
	cacheID := uuid.NewSHA1(uuid.MustParse(URLNamespace), []byte(nameBuilder.String())).String()

	// Check if proxy already exists in cache
	cachePath := filepath.Join(config.ASSETS_CACHE_PATH, cacheID+".jpg")
	if cacheEnabled {
		if _, err := os.Stat(cachePath); err == nil {
			return c.File(cachePath)
		}
	}

	// Cache miss, fetch asset from database
	var asset models.Asset
	asset.PublicID = c.Param("asset_id")

	db.Connection.Where("public_id = ?", asset.PublicID).First(&asset)

	if asset.ID == 0 {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Asset not found"})
	}

	// Generate new proxy
	img, err := vips.NewImageFromFile(asset.Filepath)
	if err != nil {
		fmt.Println("Error opening image:", err)
		return c.String(http.StatusBadRequest, "Failed to open image")
	}

	original_width := img.Width()
	max_width := 2000

	width_str := queryParams.Get("width")
	width, _ := strconv.Atoi(width_str)
	if width <= 0 {
		width = original_width
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
	err = os.WriteFile(cachePath, imageBytes, 0644)
	if err != nil {
		return c.String(http.StatusBadRequest, "Failed to save image")
	}

	return c.Blob(http.StatusOK, "image/jpeg", imageBytes)
}

// createAsset handles the creation of a single asset, including file storage and metadata extraction
func CreateAsset(c echo.Context, file *multipart.FileHeader) (*models.Asset, error) {
	user := c.Get("user")

	userID, ok := user.(uint)
	if !ok {
		return nil, fmt.Errorf("invalid user ID")
	}

	// Create initial asset record
	asset := models.Asset{
		Type:     file.Header.Get("Content-Type"),
		Size:     file.Size,
		Filename: file.Filename,
		UserID:   userID,
	}

	// This will trigger BeforeCreate hook to generate PublicID
	if err := db.Connection.Create(&asset).Error; err != nil {
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
		// Pretty print EXIF data
		exifJSON, err := json.MarshalIndent(exif, "", "  ")
		if err == nil {
			fmt.Printf("EXIF data for %s:\n%s\n", file.Filename, string(exifJSON))
		}

		// Try to parse timestamp from EXIF data with multiple fallbacks
		parseExifTime := func(key string) (time.Time, error) {
			if dateTime, ok := exif[key]; ok {
				// Extract just the timestamp part from the EXIF value
				// Format is typically "2025:02:23 07:40:01 (2025:02:23 07:40:01, ASCII, 20 components, 20 bytes)"
				timeStr := fmt.Sprintf("%v", dateTime)
				if idx := strings.Index(timeStr, " ("); idx > 0 {
					timeStr = timeStr[:idx]
				}
				return time.Parse("2006:01:02 15:04:05", timeStr)
			}
			return time.Time{}, fmt.Errorf("no %s found", key)
		}

		// Try different EXIF timestamp fields in order of preference
		exifTime, err := parseExifTime("exif-ifd2-DateTimeOriginal")
		if err != nil {
			exifTime, err = parseExifTime("exif-ifd2-DateTimeDigitized")
			if err != nil {
				exifTime, err = parseExifTime("exif-ifd0-DateTime")
			}
		}

		// If we got a valid EXIF time, use it
		if err == nil && !exifTime.IsZero() {
			// Check for timezone offset
			if offset, ok := exif["exif-ifd2-OffsetTimeOriginal"]; ok {
				offsetStr := fmt.Sprintf("%v", offset)
				if idx := strings.Index(offsetStr, " ("); idx > 0 {
					offsetStr = offsetStr[:idx]
				}
				// Parse the offset (e.g. "-05:00")
				if offset, err := time.Parse("-07:00", offsetStr); err == nil {
					// Get the hour offset as a float
					_, offsetHours := offset.Zone()
					// Apply the offset to the time
					exifTime = exifTime.Add(time.Duration(offsetHours) * time.Second)
				}
			}
			asset.CTime = exifTime
		} else {
			// If we couldn't parse EXIF time, use CreatedAt
			asset.CTime = asset.CreatedAt
		}
	} else {
		// If no EXIF data, use CreatedAt
		asset.CTime = asset.CreatedAt
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
	if err := db.Connection.Save(&asset).Error; err != nil {
		return nil, fmt.Errorf("failed to update asset metadata: %w", err)
	}

	return &asset, nil
}

func UploadAssets(c echo.Context) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Failed to process form data",
		})
	}
	files := form.File["files"]

	if len(files) == 0 {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "No files uploaded",
		})
	}

	for _, file := range files {
		_, err := CreateAsset(c, file)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, echo.Map{
				"error": err.Error(),
			})
		}
	}

	return c.Redirect(http.StatusSeeOther, "/")
}

func GetUserAssets(c echo.Context) []models.Asset {
	user := c.Get("user")
	if user == nil {
		return nil
	}

	userID, ok := user.(uint)
	if !ok {
		return nil
	}

	var assets []models.Asset
	result := db.Connection.Where("user_id = ?", userID).Order("c_time DESC").Find(&assets)
	if result.Error != nil {
		return nil
	}

	return assets
}

func GetUserDeletedAssets(c echo.Context) []models.Asset {
	user := c.Get("user")
	if user == nil {
		return nil
	}

	userID, ok := user.(uint)
	if !ok {
		return nil
	}

	var assets []models.Asset
	result := db.Connection.Unscoped().Where("user_id = ? AND deleted_at IS NOT NULL", userID).Order("c_time DESC").Find(&assets)
	if result.Error != nil {
		return nil
	}

	return assets
}

func GetAssetByPublicID(publicID string) *models.Asset {
	var asset models.Asset
	result := db.Connection.Where("public_id = ?", publicID).First(&asset)
	if result.Error != nil {
		return nil
	}
	return &asset
}

type DeleteAssetsRequest struct {
	AssetIds []string `json:"assetIds"`
}

func DeleteAssets(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}

	var req DeleteAssetsRequest
	if err := c.Bind(&req); err != nil {
		return c.String(http.StatusBadRequest, "Invalid request")
	}

	if len(req.AssetIds) == 0 {
		return c.String(http.StatusBadRequest, "No assets specified")
	}

	// Mark assets as deleted (soft delete)
	result := db.Connection.Where("public_id IN ? AND user_id = ?", req.AssetIds, userID).Delete(&models.Asset{})

	if result.Error != nil {
		return c.String(http.StatusInternalServerError, "Failed to delete assets")
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": fmt.Sprintf("Successfully deleted %d assets", result.RowsAffected),
	})
}

func RestoreAssets(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}

	var req DeleteAssetsRequest
	if err := c.Bind(&req); err != nil {
		return c.String(http.StatusBadRequest, "Invalid request")
	}

	if len(req.AssetIds) == 0 {
		return c.String(http.StatusBadRequest, "No assets specified")
	}

	// Restore soft deleted assets by setting deleted_at to NULL
	result := db.Connection.Unscoped().Model(&models.Asset{}).
		Where("public_id IN ? AND user_id = ? AND deleted_at IS NOT NULL", req.AssetIds, userID).
		Update("deleted_at", nil)

	if result.Error != nil {
		return c.String(http.StatusInternalServerError, "Failed to restore assets")
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": fmt.Sprintf("Successfully restored %d assets", result.RowsAffected),
	})
}

func DownloadAsset(c echo.Context) error {
	publicID := c.Param("asset_id")
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}

	var asset models.Asset
	result := db.Connection.Where("public_id = ? AND user_id = ?", publicID, userID).First(&asset)
	if result.Error != nil {
		return c.String(http.StatusNotFound, "Asset not found")
	}

	// Set download headers for original file
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", asset.Filename))
	return c.File(asset.Filepath)
}

func DownloadAssets(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}

	idsParam := c.QueryParam("ids")
	if idsParam == "" {
		return c.String(http.StatusBadRequest, "No asset IDs provided")
	}

	assetIds := strings.Split(idsParam, ",")
	if len(assetIds) == 0 {
		return c.String(http.StatusBadRequest, "No asset IDs provided")
	}

	// Get assets
	var assets []models.Asset
	result := db.Connection.Where("public_id IN ? AND user_id = ?", assetIds, userID).Find(&assets)
	if result.Error != nil {
		return c.String(http.StatusInternalServerError, "Failed to fetch assets")
	}

	if len(assets) == 0 {
		return c.String(http.StatusNotFound, "No assets found")
	}

	// Set headers for ZIP download
	c.Response().Header().Set("Content-Type", "application/zip")
	c.Response().Header().Set("Content-Disposition", "attachment; filename=\"assets.zip\"")

	// Create ZIP writer
	zipWriter := zip.NewWriter(c.Response().Writer)
	defer zipWriter.Close()

	for _, asset := range assets {
		// Create a file in the ZIP
		fileWriter, err := zipWriter.Create(asset.Filename)
		if err != nil {
			return err
		}

		// Open the asset file
		file, err := os.Open(asset.Filepath)
		if err != nil {
			continue // Skip this file if we can't open it
		}

		// Copy file contents to ZIP
		_, err = io.Copy(fileWriter, file)
		file.Close()
		if err != nil {
			return err
		}
	}

	return nil
}
