package handlers

import (
	"errors"
	"io"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/avatarproc"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

type AvatarHandler struct {
	db         *gorm.DB
	storageSvc *storage.Service
}

func NewAvatarHandler(db *gorm.DB, storageSvc *storage.Service) *AvatarHandler {
	return &AvatarHandler{db: db, storageSvc: storageSvc}
}

func (h *AvatarHandler) RegisterRoutes(g *echo.Group) {
	g.POST("/me/avatar", h.Upload)
	g.GET("/me/avatar", h.Serve)
	g.GET("/users/:userId/avatar", h.ServeByUserID)
}

func (h *AvatarHandler) Upload(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	// Try multipart form first (frontend sends FormData with "avatar" field),
	// fall back to raw body for backwards compatibility.
	var data []byte
	if file, formErr := c.FormFile("avatar"); formErr == nil {
		src, openErr := file.Open()
		if openErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Failed to read avatar file")
		}
		defer src.Close()
		var readErr error
		data, readErr = io.ReadAll(src)
		if readErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Failed to read avatar data")
		}
	} else {
		var readErr error
		data, readErr = io.ReadAll(c.Request().Body)
		if readErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Failed to read avatar data")
		}
		defer c.Request().Body.Close()
	}

	if len(data) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "Avatar data is required")
	}

	// Normalize to WebP regardless of upload format. Caller may send PNG/JPEG
	// from a native picker; storing one format keeps the GET handler simple
	// and shaves bytes off every avatar load.
	webp, err := avatarproc.Process(data)
	if err != nil {
		switch {
		case errors.Is(err, avatarproc.ErrEmptyInput):
			return echo.NewHTTPError(http.StatusBadRequest, "Avatar data is required")
		case errors.Is(err, avatarproc.ErrInputTooLarge):
			return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "Avatar exceeds 8MB limit")
		case errors.Is(err, avatarproc.ErrInvalidImage):
			return echo.NewHTTPError(http.StatusBadRequest, "Avatar must be a valid image")
		default:
			return echo.NewHTTPError(http.StatusInternalServerError, "Failed to process avatar")
		}
	}

	if err := h.storageSvc.StoreAvatar(userID.String(), webp); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to store avatar")
	}

	// Update user's avatarUrl to reference their avatar
	avatarUrl := "/api/auth/me/avatar"
	h.db.Model(&models.User{}).Where("id = ?", userID).Update("avatar_url", avatarUrl)

	return c.JSON(http.StatusOK, map[string]string{"avatarUrl": avatarUrl})
}

// Serve returns the current user's avatar bytes.
func (h *AvatarHandler) Serve(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	return h.serveByID(c, userID.String())
}

// ServeByUserID returns any user's avatar by id (callers must already be
// authenticated; authorization is at the route group level).
func (h *AvatarHandler) ServeByUserID(c echo.Context) error {
	if _, err := middleware.RequireUserID(c); err != nil {
		return err
	}
	id := c.Param("userId")
	if id == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "userId required")
	}
	return h.serveByID(c, id)
}

func (h *AvatarHandler) serveByID(c echo.Context, userID string) error {
	exists, err := h.storageSvc.AvatarExists(userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to check avatar")
	}
	if !exists {
		return echo.NewHTTPError(http.StatusNotFound, "Avatar not found")
	}
	data, err := h.storageSvc.ReadAvatarBuffer(userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to read avatar")
	}
	// Avatars are immutable per upload — short cache lets the browser skip a
	// roundtrip without pinning a stale image after a re-upload.
	c.Response().Header().Set(echo.HeaderCacheControl, "private, max-age=300")
	return c.Blob(http.StatusOK, "image/webp", data)
}
