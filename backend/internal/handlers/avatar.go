package handlers

import (
	"io"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
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

	// TODO: Convert to WebP if not already WebP
	// For now, store as-is (the frontend sends WebP)
	if err := h.storageSvc.StoreAvatar(userID.String(), data); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to store avatar")
	}

	// Update user's avatarUrl to reference their avatar
	avatarUrl := "/api/auth/me/avatar"
	h.db.Model(&models.User{}).Where("id = ?", userID).Update("avatar_url", avatarUrl)

	return c.JSON(http.StatusOK, map[string]string{"avatarUrl": avatarUrl})
}
