package handlers

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// ShareHandler exposes public moment share endpoints. The HTML landing page is
// rendered by the Nuxt frontend; this handler only serves API data (metadata,
// video bytes, thumbnail redirect).
type ShareHandler struct {
	db      *gorm.DB
	storage *storage.Service
	baseURL string
}

func NewShareHandler(db *gorm.DB, storageSvc *storage.Service, baseURL string) *ShareHandler {
	return &ShareHandler{db: db, storage: storageSvc, baseURL: baseURL}
}

// RegisterRoutes mounts the public share endpoints under the provided group
// (typically /api/share). All routes bypass session auth via auth middleware
// allowlist.
func (h *ShareHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:token", h.Metadata)
	g.GET("/:token/video", h.Video)
	g.GET("/:token/thumbnail", h.Thumbnail)
}

type shareMetadataResponse struct {
	Token        string `json:"token"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	ShareURL     string `json:"shareUrl"`
	AppURL       string `json:"appUrl"`
	VideoURL     string `json:"videoUrl,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	Ready        bool   `json:"ready"`
}

type resolvedShare struct {
	share  models.MomentShare
	moment models.Moment
	file   models.File
}

func (h *ShareHandler) resolve(token string) (*resolvedShare, error) {
	var share models.MomentShare
	if err := h.db.Where("token = ? AND revoked_at IS NULL", token).First(&share).Error; err != nil {
		return nil, err
	}
	var moment models.Moment
	if err := h.db.Where("id = ? AND trashed_at IS NULL", share.MomentID).First(&moment).Error; err != nil {
		return nil, err
	}
	var file models.File
	if err := h.db.Where("id = ? AND trashed_at IS NULL", moment.FileID).First(&file).Error; err != nil {
		return nil, err
	}
	return &resolvedShare{share: share, moment: moment, file: file}, nil
}

// Metadata returns JSON describing a share, consumed by Nuxt SSR to render the landing page.
func (h *ShareHandler) Metadata(c echo.Context) error {
	token := c.Param("token")
	if token == "" {
		return echo.NewHTTPError(http.StatusNotFound, "Not found")
	}

	rs, err := h.resolve(token)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "Share not found")
		}
		return internalError("Failed to load share", err)
	}

	base := h.resolveBase(c)

	ready := rs.moment.ExportedVersion != nil &&
		rs.moment.ExportStatus != nil &&
		*rs.moment.ExportStatus == "ready"

	resp := shareMetadataResponse{
		Token:       token,
		Title:       firstNonEmpty(rs.moment.Name, rs.file.Name, "Moment"),
		Description: rs.moment.Description,
		ShareURL:    base + "/s/" + token,
		AppURL:      base,
		Ready:       ready,
	}
	if ready {
		resp.VideoURL = base + "/api/share/" + token + "/video"
		resp.ThumbnailURL = base + "/api/share/" + token + "/thumbnail"
	}

	return c.JSON(http.StatusOK, resp)
}

// Video streams the cached exported MP4 with HTTP Range support.
func (h *ShareHandler) Video(c echo.Context) error {
	token := c.Param("token")
	rs, err := h.resolve(token)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "Not found")
		}
		return internalError("Failed to load share", err)
	}
	if rs.moment.ExportedVersion == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Export not ready")
	}

	cacheKey := momentexport.CacheKey(
		rs.moment.LibraryID.String(),
		rs.moment.ID.String(),
		*rs.moment.ExportedVersion,
	)
	size, err := h.storage.CacheStat(cacheKey)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Export file missing")
	}

	etag := fmt.Sprintf(`"v%d"`, *rs.moment.ExportedVersion)
	c.Response().Header().Set("Accept-Ranges", "bytes")
	c.Response().Header().Set("Content-Type", "video/mp4")
	c.Response().Header().Set("Cache-Control", "private, max-age=60")
	c.Response().Header().Set("ETag", etag)

	rangeHeader := c.Request().Header.Get("Range")
	if rangeHeader == "" {
		c.Response().Header().Set("Content-Length", strconv.FormatInt(size, 10))
		reader, err := h.storage.OpenCacheReadStream(cacheKey)
		if err != nil {
			return internalError("Failed to read export", err)
		}
		defer reader.Close()
		c.Response().WriteHeader(http.StatusOK)
		_, _ = io.Copy(c.Response(), reader)
		return nil
	}

	matches := rangeRegex.FindStringSubmatch(rangeHeader)
	if matches == nil {
		return echo.NewHTTPError(http.StatusRequestedRangeNotSatisfiable, "Invalid range")
	}
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
	reader, err := h.storage.OpenCacheReadStreamRange(cacheKey, &storage.ByteRange{Start: start, End: end})
	if err != nil {
		return internalError("Failed to read range", err)
	}
	defer reader.Close()
	length := end - start + 1
	c.Response().Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
	c.Response().Header().Set("Content-Length", strconv.FormatInt(length, 10))
	c.Response().WriteHeader(http.StatusPartialContent)
	_, _ = io.Copy(c.Response(), reader)
	return nil
}

// Thumbnail streams the moment's poster image straight from storage. It must
// stay publicly reachable (authorized by the share token) for OG/poster
// rendering on the public /s/:token page — so it deliberately does NOT redirect
// to /api/files/proxy, which now requires a logged-in session + library
// membership.
func (h *ShareHandler) Thumbnail(c echo.Context) error {
	token := c.Param("token")
	rs, err := h.resolve(token)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "Not found")
		}
		return internalError("Failed to load share", err)
	}

	libraryID := rs.file.LibraryID
	thumbID := rs.file.ID
	mime := rs.file.MimeType
	if rs.file.ThumbnailFileID != nil {
		thumbID = *rs.file.ThumbnailFileID
		// The thumbnail is a separately stored image; look up its own mime type.
		var thumb models.File
		if err := h.db.Select("mime_type").
			Where("id = ? AND library_id = ?", thumbID, libraryID).First(&thumb).Error; err == nil && thumb.MimeType != "" {
			mime = thumb.MimeType
		} else {
			mime = "image/jpeg"
		}
	}
	if mime == "" {
		mime = "image/jpeg"
	}

	size, err := h.storage.FileStat(libraryID.String(), thumbID.String())
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Thumbnail not found")
	}
	reader, err := h.storage.OpenFileReadStream(libraryID.String(), thumbID.String(), nil)
	if err != nil {
		return internalError("Failed to read thumbnail", err)
	}
	defer reader.Close()

	c.Response().Header().Set("Content-Type", mime)
	c.Response().Header().Set("Content-Length", strconv.FormatInt(size, 10))
	c.Response().Header().Set("Cache-Control", "public, max-age=3600")
	return c.Stream(http.StatusOK, mime, reader)
}

// resolveBase picks the user-facing origin used when building share URLs.
//
// The operator-configured ALCOVES_BASE_URL is trusted first. X-Forwarded-Host is
// attacker-controllable (any client can send it) and this value is reflected into
// the public share endpoint's OG/Twitter meta tags, so preferring the header over
// config would let an attacker mint legitimate-looking share links whose previews
// and click targets resolve to an attacker host. The header is therefore only a
// fallback for deployments that have not set a base URL, and is validated to be a
// bare host[:port] with no scheme/path/control characters.
func (h *ShareHandler) resolveBase(c echo.Context) string {
	req := c.Request()
	if h.baseURL != "" {
		return strings.TrimRight(h.baseURL, "/")
	}
	if fwdHost := safeForwardedHost(req.Header.Get("X-Forwarded-Host")); fwdHost != "" {
		proto := strings.TrimSpace(req.Header.Get("X-Forwarded-Proto"))
		if proto == "" {
			proto = c.Scheme()
		}
		if proto == "" {
			proto = "http"
		}
		return proto + "://" + fwdHost
	}
	scheme := c.Scheme()
	if scheme == "" {
		scheme = "http"
	}
	return scheme + "://" + req.Host
}

// safeForwardedHost validates an X-Forwarded-Host value, returning it only if it
// is a bare host[:port]. It rejects empty values, comma lists (takes the first),
// any scheme/path ("/"), and whitespace/control characters so the result cannot
// carry an arbitrary URL into a constructed origin.
func safeForwardedHost(raw string) string {
	host := strings.TrimSpace(raw)
	if i := strings.IndexByte(host, ','); i >= 0 {
		host = strings.TrimSpace(host[:i])
	}
	if host == "" {
		return ""
	}
	if strings.ContainsAny(host, "/\\ \t\r\n") {
		return ""
	}
	return host
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
