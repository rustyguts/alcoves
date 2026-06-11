package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/signing"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// SignedHandler serves the curl-friendly large-file endpoints used by remote
// MCP clients. Both routes authenticate via a short-lived signed token (not a
// session/bearer) so a bare `curl` works:
//
//	curl -C - -o out "<base>/api/files/signed?token=..."     (resumable GET)
//	curl -T file      "<base>/api/files/upload-signed?token=..." (PUT)
//
// Access was authorized when the token was minted, so these routes are public
// (excluded from the auth middleware).
type SignedHandler struct {
	db         *gorm.DB
	storageSvc *storage.Service
	fileSvc    *files.Service // ingest-configured
	signer     *signing.Signer
}

func NewSignedHandler(db *gorm.DB, storageSvc *storage.Service, fileSvc *files.Service, signer *signing.Signer) *SignedHandler {
	return &SignedHandler{db: db, storageSvc: storageSvc, fileSvc: fileSvc, signer: signer}
}

func (h *SignedHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/signed", h.Download)
	g.PUT("/upload-signed", h.Upload)
	g.POST("/upload-signed", h.Upload) // some clients can't PUT; accept POST too
}

// Download streams a file authorized by a signed token, with HTTP Range support
// so interrupted large downloads resume via `curl -C -`.
func (h *SignedHandler) Download(c echo.Context) error {
	claims, err := h.signer.VerifyDownload(c.QueryParam("token"))
	if err != nil {
		return echo.NewHTTPError(http.StatusForbidden, "Invalid or expired download token")
	}

	var file models.File
	if err := h.db.Select("id, name, mime_type, size").
		Where("id = ? AND library_id = ?", claims.FileID, claims.LibraryID).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}

	libStr := claims.LibraryID.String()
	fileStr := claims.FileID.String()
	size, err := h.storageSvc.FileStat(libStr, fileStr)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found on storage")
	}

	c.Response().Header().Set("Accept-Ranges", "bytes")
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, file.Name))

	if rangeHeader := c.Request().Header.Get("Range"); rangeHeader != "" {
		if matches := rangeRegex.FindStringSubmatch(rangeHeader); matches != nil {
			start, _ := strconv.ParseInt(matches[1], 10, 64)
			var end int64
			if matches[2] != "" {
				end, _ = strconv.ParseInt(matches[2], 10, 64)
			} else {
				end = size - 1
			}
			if start >= size {
				c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
				return c.NoContent(http.StatusRequestedRangeNotSatisfiable)
			}
			if end >= size {
				end = size - 1
			}
			reader, err := h.storageSvc.OpenFileReadStream(libStr, fileStr, &storage.ByteRange{Start: start, End: end})
			if err != nil {
				return internalError("Failed to read file", err)
			}
			defer reader.Close()
			c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
			c.Response().Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
			return c.Stream(http.StatusPartialContent, file.MimeType, reader)
		}
	}

	reader, err := h.storageSvc.OpenFileReadStream(libStr, fileStr, nil)
	if err != nil {
		return internalError("Failed to read file", err)
	}
	defer reader.Close()
	c.Response().Header().Set("Content-Length", strconv.FormatInt(size, 10))
	return c.Stream(http.StatusOK, file.MimeType, reader)
}

type signedUploadResponse struct {
	FileID         string  `json:"fileId"`
	Name           string  `json:"name"`
	Size           int64   `json:"size"`
	Hash           *string `json:"hash"`
	DuplicateCount int     `json:"duplicateCount"`
}

// Upload streams a request body authorized by a signed token straight into the
// shared ingest pipeline. The body is never buffered (so 25GB+ streams fine);
// the signed max-size, if any, is enforced via http.MaxBytesReader.
func (h *SignedHandler) Upload(c echo.Context) error {
	claims, err := h.signer.VerifyUpload(c.QueryParam("token"))
	if err != nil {
		return echo.NewHTTPError(http.StatusForbidden, "Invalid or expired upload token")
	}

	// Defense in depth: the destination folder must still belong to the library.
	if claims.FolderID != nil {
		var count int64
		h.db.Model(&models.Folder{}).Where("id = ? AND library_id = ?", *claims.FolderID, claims.LibraryID).Count(&count)
		if count == 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "Folder not found in library")
		}
	}

	body := c.Request().Body
	if claims.MaxSize > 0 {
		body = http.MaxBytesReader(c.Response().Writer, body, claims.MaxSize)
	}

	res, err := h.fileSvc.IngestStream(c.Request().Context(), files.IngestParams{
		LibraryID: claims.LibraryID,
		OwnerID:   claims.OwnerID,
		FolderID:  claims.FolderID,
		Name:      claims.Name,
		MimeType:  claims.MimeType,
	}, body)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "Upload exceeds maximum size")
		}
		return internalError("Failed to store upload", err)
	}

	f := res.File
	return c.JSON(http.StatusCreated, signedUploadResponse{
		FileID:         f.ID.String(),
		Name:           f.Name,
		Size:           f.Size,
		Hash:           f.Hash,
		DuplicateCount: res.DuplicateCount,
	})
}
