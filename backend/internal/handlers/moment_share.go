package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

// RegisterShareRoutes attaches share CRUD endpoints to the moment handler's route group.
// Called from MomentHandler.RegisterRoutes.
func (h *MomentHandler) RegisterShareRoutes(g *echo.Group) {
	g.GET("/:id/files/:fileId/moments/:momentId/shares", h.ListShares)
	g.POST("/:id/files/:fileId/moments/:momentId/shares", h.CreateShare)
	g.DELETE("/:id/files/:fileId/moments/:momentId/shares/:token", h.RevokeShare)
}

type momentShareResponse struct {
	ID        string  `json:"id"`
	MomentID  string  `json:"momentId"`
	LibraryID string  `json:"libraryId"`
	Token     string  `json:"token"`
	URL       string  `json:"url"`
	RevokedAt *string `json:"revokedAt"`
	CreatedAt string  `json:"createdAt"`
}

func toMomentShareResponse(s *models.MomentShare, baseURL string) momentShareResponse {
	return momentShareResponse{
		ID:        s.ID.String(),
		MomentID:  s.MomentID.String(),
		LibraryID: s.LibraryID.String(),
		Token:     s.Token,
		URL:       baseURL + "/s/" + s.Token,
		RevokedAt: formatMomentTimePtr(s.RevokedAt),
		CreatedAt: formatMomentTime(s.CreatedAt),
	}
}

// ListShares returns all active share rows for a moment.
func (h *MomentHandler) ListShares(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}

	var shares []models.MomentShare
	if err := h.db.
		Where("moment_id = ? AND revoked_at IS NULL", moment.ID).
		Order("created_at DESC").
		Find(&shares).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to list shares")
	}

	baseURL := h.baseURLFor(c)
	resp := make([]momentShareResponse, 0, len(shares))
	for i := range shares {
		resp = append(resp, toMomentShareResponse(&shares[i], baseURL))
	}
	return c.JSON(http.StatusOK, resp)
}

// CreateShare generates a new public-link token for the moment.
// Requires the library to have sharing_enabled=true.
func (h *MomentHandler) CreateShare(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}

	var lib models.Library
	if err := h.db.Where("id = ?", moment.LibraryID).First(&lib).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load library")
	}
	if !lib.SharingEnabled {
		return echo.NewHTTPError(http.StatusForbidden, "Sharing is disabled for this library")
	}

	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Unauthorized")
	}

	token, err := generateShareToken()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}

	share := models.MomentShare{
		MomentID:    moment.ID,
		LibraryID:   moment.LibraryID,
		CreatedByID: userID,
		Token:       token,
	}
	if err := h.db.Create(&share).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create share")
	}

	if h.activitySvc != nil {
		aid := userID
		h.activitySvc.EmitAsync(activity.EmitParams{
			LibraryID:   moment.LibraryID,
			ActorID:     &aid,
			Action:      activity.ActionMomentShared,
			SubjectType: activity.SubjectShare,
			SubjectID:   &share.ID,
			Metadata: map[string]any{
				"momentId":   moment.ID.String(),
				"momentName": moment.Name,
				"token":      share.Token,
			},
		})
	}

	return c.JSON(http.StatusCreated, toMomentShareResponse(&share, h.baseURLFor(c)))
}

// RevokeShare marks a share as revoked. Public lookups return 404 thereafter.
func (h *MomentHandler) RevokeShare(c echo.Context) error {
	moment, err := h.loadMoment(c)
	if err != nil {
		return err
	}
	token := c.Param("token")
	if token == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Missing token")
	}

	var share models.MomentShare
	if err := h.db.Where("moment_id = ? AND token = ?", moment.ID, token).First(&share).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "Share not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load share")
	}

	now := time.Now()
	if err := h.db.Model(&models.MomentShare{}).Where("id = ?", share.ID).
		Update("revoked_at", &now).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to revoke share")
	}
	return c.NoContent(http.StatusNoContent)
}

// generateShareToken produces a ~192-bit random URL-safe string.
func generateShareToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// baseURLFor resolves the public-facing base URL for the current request.
// Order:
//   1. Origin header  — browsers set this on fetch(). Most reliable for our SPA.
//   2. X-Forwarded-Proto + X-Forwarded-Host — reverse proxies / tunnels.
//   3. cfg.BaseURL (ALCOVES_BASE_URL).
//   4. request scheme + Host — last resort, may be internal docker hostname.
func (h *MomentHandler) baseURLFor(c echo.Context) string {
	req := c.Request()

	if origin := strings.TrimSpace(req.Header.Get("Origin")); origin != "" && origin != "null" {
		return strings.TrimRight(origin, "/")
	}

	if fwdHost := strings.TrimSpace(req.Header.Get("X-Forwarded-Host")); fwdHost != "" {
		proto := strings.TrimSpace(req.Header.Get("X-Forwarded-Proto"))
		if proto == "" {
			proto = c.Scheme()
		}
		if proto == "" {
			proto = "http"
		}
		return proto + "://" + fwdHost
	}

	if h.baseURL != "" {
		return strings.TrimRight(h.baseURL, "/")
	}

	scheme := c.Scheme()
	if scheme == "" {
		scheme = "http"
	}
	return scheme + "://" + req.Host
}
