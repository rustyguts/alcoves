package handlers

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/filehash"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
)

type AdminHandler struct {
	db          *gorm.DB
	hashSvc     *filehash.Service
	settingsSvc *settings.Service
}

func NewAdminHandler(db *gorm.DB, hashSvc *filehash.Service, settingsSvc *settings.Service) *AdminHandler {
	return &AdminHandler{db: db, hashSvc: hashSvc, settingsSvc: settingsSvc}
}

func (h *AdminHandler) RegisterRoutes(g *echo.Group) {
	g.Use(h.requireOwnerMiddleware)
	g.GET("/stats", h.Stats)
	g.GET("/users", h.ListUsers)
	g.PATCH("/users/:userId", h.UpdateUser)
	g.POST("/backfill-hashes", h.BackfillHashes)
	g.GET("/settings", h.GetSettings)
	g.PATCH("/settings", h.UpdateSettings)
}

func (h *AdminHandler) GetSettings(c echo.Context) error {
	return c.JSON(http.StatusOK, h.settingsSvc.Get())
}

type updateSettingsRequest struct {
	RegistrationMode string `json:"registration_mode,omitempty"`
	WhisperModel     string `json:"whisper_model,omitempty"`
	WhisperLanguage  string `json:"whisper_language,omitempty"`
	AudioDetectModel string `json:"audio_detect_model,omitempty"`
}

func (h *AdminHandler) UpdateSettings(c echo.Context) error {
	var req updateSettingsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	// Domain-level allow-list validation. The settings service itself only
	// validates registration_mode; everything else is gate-kept here so
	// the settings package doesn't import the inference packages.
	if req.WhisperModel != "" && !transcribe.IsValidWhisperModel(req.WhisperModel) {
		return echo.NewHTTPError(http.StatusBadRequest, "Unknown whisper_model")
	}
	if req.WhisperLanguage != "" && !transcribe.IsValidWhisperLanguage(req.WhisperLanguage) {
		return echo.NewHTTPError(http.StatusBadRequest, "Unknown whisper_language")
	}
	if req.AudioDetectModel != "" && !audiodetection.IsValidModelID(req.AudioDetectModel) {
		return echo.NewHTTPError(http.StatusBadRequest, "Unknown audio_detect_model")
	}
	userID, _ := middleware.RequireUserID(c)
	patch := settings.Settings{
		RegistrationMode: req.RegistrationMode,
		WhisperModel:     req.WhisperModel,
		WhisperLanguage:  req.WhisperLanguage,
		AudioDetectModel: req.AudioDetectModel,
	}
	updated, err := h.settingsSvc.Update(patch, &userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, updated)
}

// RequireOwnerMiddleware returns the owner-check middleware so external callers
// (e.g. AdminJobsHandler) can reuse it without duplicating the logic.
func (h *AdminHandler) RequireOwnerMiddleware() echo.MiddlewareFunc {
	return h.requireOwnerMiddleware
}

func (h *AdminHandler) requireOwnerMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID, err := middleware.RequireUserID(c)
		if err != nil {
			return err
		}

		var user models.User
		if err := h.db.Select("role").Where("id = ?", userID).First(&user).Error; err != nil {
			return echo.NewHTTPError(http.StatusUnauthorized, "User not found")
		}

		if user.Role != "owner" {
			return echo.NewHTTPError(http.StatusForbidden, "Forbidden")
		}

		return next(c)
	}
}

func (h *AdminHandler) Stats(c echo.Context) error {
	var userCount, libraryCount, fileCount, folderCount int64
	h.db.Model(&models.User{}).Count(&userCount)
	h.db.Model(&models.Library{}).Count(&libraryCount)
	h.db.Model(&models.File{}).Where("trashed_at IS NULL").Count(&fileCount)
	h.db.Model(&models.Folder{}).Where("trashed_at IS NULL").Count(&folderCount)

	var totalSize int64
	h.db.Model(&models.File{}).Where("trashed_at IS NULL").Select("COALESCE(SUM(size), 0)").Scan(&totalSize)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"users":     userCount,
		"libraries": libraryCount,
		"files":     fileCount,
		"folders":   folderCount,
		"totalSize": totalSize,
	})
}

func (h *AdminHandler) ListUsers(c echo.Context) error {
	var users []models.User
	h.db.Select("id, email, display_name, avatar_url, role, created_at, updated_at").
		Order("created_at").Find(&users)

	result := make([]map[string]interface{}, len(users))
	for i, u := range users {
		result[i] = map[string]interface{}{
			"id":          u.ID.String(),
			"email":       u.Email,
			"displayName": u.DisplayName,
			"avatarUrl":   u.AvatarUrl,
			"role":        u.Role,
			"createdAt":   u.CreatedAt.Format(time.RFC3339Nano),
			"updatedAt":   u.UpdatedAt.Format(time.RFC3339Nano),
		}
	}

	return c.JSON(http.StatusOK, result)
}

type updateUserRequest struct {
	Role *string `json:"role"`
}

func (h *AdminHandler) UpdateUser(c echo.Context) error {
	targetUserID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid user ID")
	}

	var req updateUserRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Role != nil {
		if *req.Role != "owner" && *req.Role != "member" {
			return echo.NewHTTPError(http.StatusBadRequest, "Role must be 'owner' or 'member'")
		}
		updates["role"] = *req.Role
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}
	updates["updated_at"] = time.Now()

	result := h.db.Model(&models.User{}).Where("id = ?", targetUserID).Updates(updates)
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}

	var user models.User
	h.db.Where("id = ?", targetUserID).First(&user)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":          user.ID.String(),
		"email":       user.Email,
		"displayName": user.DisplayName,
		"avatarUrl":   user.AvatarUrl,
		"role":        user.Role,
	})
}

func (h *AdminHandler) BackfillHashes(c echo.Context) error {
	count, err := h.hashSvc.EnqueueUnhashedFiles()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to enqueue hash backfill")
	}
	return c.JSON(http.StatusOK, map[string]int{"queuedCount": count})
}
