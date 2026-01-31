package files

import (
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/rustyguts/alcoves/internal/libraries"
	"github.com/rustyguts/alcoves/internal/models"
)

// URLNamespace is the UUID namespace for URL-based identifiers (RFC 4122)
// This is used to generate deterministic UUIDs for image proxies
const URLNamespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

func GetFile(c echo.Context) error {
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

	// Cache miss, fetch file from database
	var file models.File
	file.PublicID = c.Param("asset_id")

	db.Connection.Where("public_id = ?", file.PublicID).First(&file)

	if file.ID == 0 {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "File not found"})
	}

	// Generate new proxy
	img, err := vips.NewImageFromFile(file.Filepath)
	if err != nil {
		return c.String(http.StatusBadRequest, "Failed to open image")
	}

	originalWidth := img.Width()
	maxWidth := 2000

	widthStr := queryParams.Get("width")
	width, _ := strconv.Atoi(widthStr)
	if width <= 0 {
		width = originalWidth
	}

	if width > maxWidth {
		width = maxWidth
	}

	image, err := vips.NewThumbnailFromFile(file.Filepath, width, 0, vips.InterestingNone)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to process image")
	}

	// https://www.libvips.org/API/current/libvips-conversion.html#VipsInteresting

	_ = image.AutoRotate()

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
		return c.String(http.StatusInternalServerError, "Failed to export image")
	}

	// Save the proxy image
	err = os.WriteFile(cachePath, imageBytes, 0644)
	if err != nil {
		return c.String(http.StatusBadRequest, "Failed to save image")
	}

	return c.Blob(http.StatusOK, "image/jpeg", imageBytes)
}

func getLibraryForFile(c echo.Context, userID uint, libraryPublicID string) (*models.Library, error) {
	if libraryPublicID != "" {
		return libraries.GetLibraryByPublicID(libraryPublicID, userID)
	}

	// Get user's personal library (creates if doesn't exist)
	var userRecord models.User
	if err := db.Connection.First(&userRecord, userID).Error; err != nil {
		return nil, fmt.Errorf("failed to find user: %w", err)
	}
	return libraries.GetUserLibrary(userID, userRecord.Email)
}

func saveUploadedFile(fileHeader *multipart.FileHeader, destPath string) error {
	src, err := fileHeader.Open()
	if err != nil {
		return fmt.Errorf("failed to open uploaded file: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return fmt.Errorf("failed to save file: %w", err)
	}

	return nil
}

func parseExifTimestamp(exif map[string]string) time.Time {
	parseExifTime := func(key string) (time.Time, error) {
		if dateTime, ok := exif[key]; ok {
			timeStr := dateTime
			if idx := strings.Index(timeStr, " ("); idx > 0 {
				timeStr = timeStr[:idx]
			}
			return time.Parse("2006:01:02 15:04:05", timeStr)
		}
		return time.Time{}, fmt.Errorf("no %s found", key)
	}

	// Try different EXIF timestamp fields in order of preference
	keys := []string{"exif-ifd2-DateTimeOriginal", "exif-ifd2-DateTimeDigitized", "exif-ifd0-DateTime"}
	var exifTime time.Time
	var err error
	for _, key := range keys {
		exifTime, err = parseExifTime(key)
		if err == nil && !exifTime.IsZero() {
			break
		}
	}

	if err != nil || exifTime.IsZero() {
		return time.Time{}
	}

	// Check for timezone offset
	if offset, ok := exif["exif-ifd2-OffsetTimeOriginal"]; ok {
		offsetStr := offset
		if idx := strings.Index(offsetStr, " ("); idx > 0 {
			offsetStr = offsetStr[:idx]
		}
		if offset, err := time.Parse("-07:00", offsetStr); err == nil {
			_, offsetHours := offset.Zone()
			exifTime = exifTime.Add(time.Duration(offsetHours) * time.Second)
		}
	}

	return exifTime
}

func extractImageMetadata(file *models.File, imagePath string) error {
	img, err := vips.NewImageFromFile(imagePath)
	if err != nil {
		return fmt.Errorf("failed to process image: %w", err)
	}

	file.Width = img.Width()
	file.Height = img.Height()

	// Get EXIF data for creation time
	exif := img.GetExif()
	if exif != nil {
		exifTime := parseExifTimestamp(exif)
		if !exifTime.IsZero() {
			file.CTime = exifTime
		} else {
			file.CTime = file.CreatedAt
		}
	} else {
		file.CTime = file.CreatedAt
	}

	return nil
}

func calculateFileHash(filePath string) (string, error) {
	fileData, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file for hashing: %w", err)
	}
	hash := sha256.Sum256(fileData)
	return hex.EncodeToString(hash[:]), nil
}

func CreateFile(c echo.Context, fileHeader *multipart.FileHeader, libraryPublicID string) (*models.File, error) {
	user := c.Get("user")

	userID, ok := user.(uint)
	if !ok {
		return nil, fmt.Errorf("invalid user ID")
	}

	library, err := getLibraryForFile(c, userID, libraryPublicID)
	if err != nil {
		return nil, fmt.Errorf("failed to get library: %w", err)
	}

	file := models.File{
		Type:      fileHeader.Header.Get("Content-Type"),
		Size:      fileHeader.Size,
		Filename:  fileHeader.Filename,
		UserID:    userID,
		LibraryID: library.ID,
	}

	if err := db.Connection.Create(&file).Error; err != nil {
		return nil, fmt.Errorf("failed to create file record: %w", err)
	}

	ext := filepath.Ext(fileHeader.Filename)
	originalPath := filepath.Join(config.ASSETS_PATH, file.PublicID+ext)

	if err := saveUploadedFile(fileHeader, originalPath); err != nil {
		return nil, err
	}

	if err := extractImageMetadata(&file, originalPath); err != nil {
		return nil, err
	}

	hash, err := calculateFileHash(originalPath)
	if err != nil {
		return nil, err
	}
	file.Hash = hash

	file.Filepath = originalPath
	if err := db.Connection.Save(&file).Error; err != nil {
		return nil, fmt.Errorf("failed to update file metadata: %w", err)
	}

	return &file, nil
}

func UploadFiles(c echo.Context) error {
	// Parse multipart form with 32MB max memory per file
	if err := c.Request().ParseMultipartForm(32 << 20); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Failed to process form data",
		})
	}

	form := c.Request().MultipartForm
	if form == nil {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "No form data",
		})
	}

	libraryPublicID := c.FormValue("libraryPublicID")

	files := form.File["files"]
	if len(files) == 0 {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "No files uploaded",
		})
	}

	// Process all files
	successCount := 0
	var errors []string

	for _, file := range files {
		_, err := CreateFile(c, file, libraryPublicID)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", file.Filename, err))
			continue
		}
		successCount++
	}

	// Return JSON response for Uppy
	if len(errors) > 0 {
		return c.JSON(http.StatusPartialContent, echo.Map{
			"status":       "partial",
			"successCount": successCount,
			"totalCount":   len(files),
			"errors":       errors,
		})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"status":       "success",
		"successCount": successCount,
		"totalCount":   len(files),
	})
}

func GetUserFiles(c echo.Context) []models.File {
	user := c.Get("user")
	if user == nil {
		return nil
	}

	userID, ok := user.(uint)
	if !ok {
		return nil
	}

	var assets []models.File
	result := db.Connection.Where("user_id = ?", userID).Order("c_time DESC").Find(&assets)
	if result.Error != nil {
		return nil
	}

	return assets
}

func GetFileByPublicID(publicID string) *models.File {
	var file models.File
	result := db.Connection.Where("public_id = ?", publicID).First(&file)
	if result.Error != nil {
		return nil
	}
	return &file
}

func DeleteFiles(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	var publicIDs []string
	if err := c.Bind(&publicIDs); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request"})
	}

	result := db.Connection.Where("public_id IN ? AND user_id = ?", publicIDs, userID).Delete(&models.File{})
	if result.Error != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to delete files"})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": fmt.Sprintf("Successfully deleted %d assets", result.RowsAffected),
	})
}

func RestoreFiles(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	var publicIDs []string
	if err := c.Bind(&publicIDs); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request"})
	}

	result := db.Connection.Unscoped().
		Model(&models.File{}).
		Where("public_id IN ? AND user_id = ?", publicIDs, userID).
		Update("deleted_at", nil)

	if result.Error != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to restore files"})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": fmt.Sprintf("Successfully restored %d assets", result.RowsAffected),
	})
}

func DownloadFiles(c echo.Context) error {
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}

	publicID := c.QueryParam("id")
	if publicID == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "No file ID provided"})
	}

	var asset models.File
	result := db.Connection.Where("public_id = ? AND user_id = ?", publicID, userID).First(&asset)
	if result.Error != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "File not found"})
	}

	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", asset.Filename))
	return c.File(asset.Filepath)
}

func DownloadFile(c echo.Context) error {
	publicID := c.Param("asset_id")
	userID, ok := c.Get("user").(uint)
	if !ok {
		return c.String(http.StatusUnauthorized, "Unauthorized")
	}

	var asset models.File
	result := db.Connection.Where("public_id = ? AND user_id = ?", publicID, userID).First(&asset)
	if result.Error != nil {
		return c.String(http.StatusNotFound, "File not found")
	}

	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", asset.Filename))
	return c.File(asset.Filepath)
}

func GetPreviousFile(userID uint, currentFile *models.File) *models.File {
	if currentFile == nil {
		return nil
	}

	var file models.File
	result := db.Connection.
		Where("user_id = ? AND c_time < ?", userID, currentFile.CTime).
		Order("c_time DESC").
		First(&file)

	if result.Error != nil {
		return nil
	}
	return &file
}

func GetNextFile(userID uint, currentFile *models.File) *models.File {
	if currentFile == nil {
		return nil
	}

	var file models.File
	result := db.Connection.
		Where("user_id = ? AND c_time > ?", userID, currentFile.CTime).
		Order("c_time ASC").
		First(&file)

	if result.Error != nil {
		return nil
	}
	return &file
}
