package handlers

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
)

// TokenHandler is the self-service personal-access-token API. Every route is
// scoped to the authenticated user — a user can only see and revoke their own
// tokens. Tokens authenticate the MCP server as that user, so MCP calls only
// ever return data the user is authorized to view.
type TokenHandler struct {
	db      *gorm.DB
	authSvc *authservice.Service
}

func NewTokenHandler(db *gorm.DB, authSvc *authservice.Service) *TokenHandler {
	return &TokenHandler{db: db, authSvc: authSvc}
}

func (h *TokenHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/tokens", h.List)
	g.POST("/tokens", h.Create)
	g.DELETE("/tokens/:id", h.Delete)
}

type tokenResponse struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	LastUsedAt *string `json:"lastUsedAt"`
	ExpiresAt  *string `json:"expiresAt"`
	CreatedAt  string  `json:"createdAt"`
}

func toTokenResponse(t *models.PersonalAccessToken) tokenResponse {
	resp := tokenResponse{
		ID:        t.ID.String(),
		Name:      t.Name,
		CreatedAt: t.CreatedAt.Format(time.RFC3339Nano),
	}
	if t.LastUsedAt != nil {
		s := t.LastUsedAt.Format(time.RFC3339Nano)
		resp.LastUsedAt = &s
	}
	if t.ExpiresAt != nil {
		s := t.ExpiresAt.Format(time.RFC3339Nano)
		resp.ExpiresAt = &s
	}
	return resp
}

// List returns the authenticated user's tokens (never the plaintext/hash).
func (h *TokenHandler) List(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	var tokens []models.PersonalAccessToken
	h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&tokens)

	resp := make([]tokenResponse, 0, len(tokens))
	for i := range tokens {
		resp = append(resp, toTokenResponse(&tokens[i]))
	}
	return c.JSON(http.StatusOK, resp)
}

type createTokenRequest struct {
	Name          string `json:"name" validate:"required,min=1,max=100"`
	ExpiresInDays *int   `json:"expiresInDays"`
}

// Create mints a new token for the authenticated user and returns the plaintext
// exactly once.
func (h *TokenHandler) Create(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var req createTokenRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(&req); err != nil {
		return err
	}

	var expiresAt *time.Time
	if req.ExpiresInDays != nil && *req.ExpiresInDays > 0 {
		t := time.Now().AddDate(0, 0, *req.ExpiresInDays)
		expiresAt = &t
	}

	plaintext, pat, err := h.authSvc.CreatePersonalAccessToken(userID, req.Name, expiresAt)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create token")
	}

	resp := toTokenResponse(pat)
	return c.JSON(http.StatusCreated, map[string]any{
		"id":         resp.ID,
		"name":       resp.Name,
		"token":      plaintext, // shown once — never returned again
		"lastUsedAt": resp.LastUsedAt,
		"expiresAt":  resp.ExpiresAt,
		"createdAt":  resp.CreatedAt,
	})
}

// Delete revokes one of the authenticated user's tokens.
func (h *TokenHandler) Delete(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}
	id := c.Param("id")

	result := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.PersonalAccessToken{})
	if result.Error != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to revoke token")
	}
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Token not found")
	}
	return c.JSON(http.StatusOK, map[string]bool{"deleted": true})
}
