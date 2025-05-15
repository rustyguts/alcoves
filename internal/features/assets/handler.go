package assets

import (
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
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rustyguts/alcoves/internal/config"
	"github.com/rustyguts/alcoves/internal/db"
)

// URLNamespace is the UUID namespace for URL-based identifiers (RFC 4122)
// This is used to generate deterministic UUIDs for image proxies
const URLNamespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

func GetAsset(c *gin.Context) {
	// Get and sort query parameters for deterministic proxy ID
	queryParams := c.Request.URL.Query()
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
	proxyID := uuid.NewSHA1(uuid.MustParse(URLNamespace), []byte(nameBuilder.String())).String()

	// Check if proxy already exists in cache
	proxyPath := filepath.Join(config.ASSETS_CACHE_PATH, proxyID+".jpg")
	if _, err := os.Stat(proxyPath); err == nil {
		// Proxy exists, serve it directly
		c.File(proxyPath)
		return
	}

	// Cache miss, fetch asset from database
	var asset Asset
	asset.PublicID = c.Param("asset_id")

	db.DBConn.Where("public_id = ?", asset.PublicID).First(&asset)

	if asset.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Asset not found"})
		return
	}

	// Generate new proxy
	img, err := vips.NewImageFromFile(asset.Filepath)
	if err != nil {
		fmt.Println("Error opening image:", err)
		c.String(http.StatusBadRequest, "Failed to open image")
		return
	}

	original_width := img.Width()
	original_height := img.Height()

	max_width := original_width
	recommended_width := original_height

	width_str := queryParams.Get("width")
	width, _ := strconv.Atoi(width_str)
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
		c.String(http.StatusBadRequest, "Failed to save image")
		return
	}

	c.Data(http.StatusOK, "image/jpeg", imageBytes)
}

// createAsset handles the creation of a single asset, including file storage and metadata extraction
func CreateAsset(c *gin.Context, file *multipart.FileHeader) (*Asset, error) {
	user := c.GetUint("user")

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
	if err := db.DBConn.Save(&asset).Error; err != nil {
		return nil, fmt.Errorf("failed to update asset metadata: %w", err)
	}

	return &asset, nil
}

func UploadAssets(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Failed to process form data",
		})
		return
	}
	files := form.File["files"]

	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "No files uploaded",
		})
		return
	}

	for _, file := range files {
		_, err := CreateAsset(c, file)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": err.Error(),
			})
			return
		}
	}

	c.Redirect(http.StatusSeeOther, "/")
}

func GetUserAssets(c *gin.Context) []Asset {
	user, exists := c.Get("user")
	if !exists {
		return nil
	}

	userID, ok := user.(uint)
	if !ok {
		return nil
	}

	var assets []Asset
	result := db.DBConn.Where("user_id = ?", userID).Order("c_time DESC").Find(&assets)
	if result.Error != nil {
		return nil
	}

	return assets
}
