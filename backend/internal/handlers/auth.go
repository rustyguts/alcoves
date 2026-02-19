package handlers

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
)

type AuthHandler struct {
	db                *gorm.DB
	authSvc           *authservice.Service
	googleAuthEnabled bool
}

func NewAuthHandler(db *gorm.DB, authSvc *authservice.Service, googleAuthEnabled bool) *AuthHandler {
	return &AuthHandler{db: db, authSvc: authSvc, googleAuthEnabled: googleAuthEnabled}
}

// RegisterRoutes registers all auth routes.
func (h *AuthHandler) RegisterRoutes(g *echo.Group) {
	g.POST("/register", h.Register)
	g.POST("/login", h.Login)
	g.POST("/logout", h.Logout)
	g.GET("/me", h.Me)
	g.PATCH("/me", h.UpdateMe)
	g.GET("/sessions", h.ListSessions)
	g.DELETE("/sessions/:id", h.RevokeSession)
	g.GET("/providers", h.Providers)
}

// RegisterSessionRoute registers the /_auth/session route on the given api group.
// This is separate because it lives outside /auth/*.
func (h *AuthHandler) RegisterSessionRoute(api *echo.Group) {
	api.GET("/_auth/session", h.Session)
}

// Providers returns which authentication providers are available.
// This is a public endpoint so the frontend can show/hide OAuth buttons.
func (h *AuthHandler) Providers(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"google": h.googleAuthEnabled,
	})
}

type registerRequest struct {
	Name     string `json:"name" validate:"required,min=1"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

type userResponse struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	DisplayName string  `json:"displayName"`
	AvatarUrl   *string `json:"avatarUrl"`
	Role        string  `json:"role"`
}

func toUserResponse(u *models.User) userResponse {
	return userResponse{
		ID:          u.ID.String(),
		Email:       u.Email,
		DisplayName: u.DisplayName,
		AvatarUrl:   u.AvatarUrl,
		Role:        u.Role,
	}
}

func (h *AuthHandler) Register(c echo.Context) error {
	var req registerRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}

	email := normalizeEmail(req.Email)

	// Check existing user
	var existing models.User
	if err := h.db.Where("email = ?", email).First(&existing).Error; err == nil {
		return echo.NewHTTPError(http.StatusConflict, "Email already registered")
	}

	// First user becomes owner
	var userCount int64
	h.db.Model(&models.User{}).Count(&userCount)
	role := "member"
	if userCount == 0 {
		role = "owner"
	}

	passwordHash, err := authservice.HashPassword(req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to hash password")
	}

	user := models.User{
		Email:        email,
		PasswordHash: &passwordHash,
		DisplayName:  req.Name,
		Role:         role,
	}

	if err := h.db.Create(&user).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create user")
	}

	// Create credentials account record
	account := models.Account{
		UserID:            user.ID,
		Provider:          "credentials",
		ProviderAccountID: email,
	}
	h.db.Create(&account)

	// Create default library
	library := models.Library{
		Name:      "My Library",
		IsDefault: true,
		OwnerID:   user.ID,
	}
	h.db.Create(&library)

	// Create session
	sessionToken, err := h.authSvc.CreateSession(user.ID, c)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create session")
	}

	if err := h.authSvc.SetSessionCookie(c, authservice.SessionPayload{
		SessionToken: sessionToken,
		UserID:       user.ID.String(),
	}); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to set session cookie")
	}

	return c.JSON(http.StatusOK, toUserResponse(&user))
}

type loginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=1"`
}

func (h *AuthHandler) Login(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}

	email := normalizeEmail(req.Email)

	var user models.User
	if err := h.db.Where("email = ?", email).First(&user).Error; err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid email or password")
	}

	if user.PasswordHash == nil || !authservice.VerifyPassword(req.Password, *user.PasswordHash) {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid email or password")
	}

	sessionToken, err := h.authSvc.CreateSession(user.ID, c)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create session")
	}

	if err := h.authSvc.SetSessionCookie(c, authservice.SessionPayload{
		SessionToken: sessionToken,
		UserID:       user.ID.String(),
	}); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to set session cookie")
	}

	return c.JSON(http.StatusOK, toUserResponse(&user))
}

func (h *AuthHandler) Logout(c echo.Context) error {
	payload, err := h.authSvc.GetSessionFromCookie(c)
	if err == nil && payload != nil {
		h.authSvc.DeleteSession(payload.SessionToken)
	}

	h.authSvc.ClearSessionCookie(c)
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func (h *AuthHandler) Me(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var user models.User
	if err := h.db.Where("id = ?", userID).First(&user).Error; err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "User not found")
	}

	return c.JSON(http.StatusOK, toUserResponse(&user))
}

type updateMeRequest struct {
	DisplayName *string `json:"displayName"`
	Email       *string `json:"email"`
}

func (h *AuthHandler) UpdateMe(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var req updateMeRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.DisplayName != nil {
		updates["display_name"] = *req.DisplayName
	}
	if req.Email != nil {
		updates["email"] = normalizeEmail(*req.Email)
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}

	if err := h.db.Model(&models.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to update user")
	}

	var user models.User
	h.db.Where("id = ?", userID).First(&user)

	return c.JSON(http.StatusOK, toUserResponse(&user))
}

type sessionResponse struct {
	ID        string  `json:"id"`
	UserAgent *string `json:"userAgent"`
	IPAddress *string `json:"ipAddress"`
	CreatedAt string  `json:"createdAt"`
	ExpiresAt string  `json:"expiresAt"`
	IsCurrent bool    `json:"isCurrent"`
}

func (h *AuthHandler) ListSessions(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	currentToken := c.Get(middleware.ContextKeySessionToken)

	var sessions []models.Session
	h.db.Where("user_id = ?", userID).Order("created_at").Find(&sessions)

	result := make([]sessionResponse, len(sessions))
	for i, s := range sessions {
		result[i] = sessionResponse{
			ID:        s.ID.String(),
			UserAgent: s.UserAgent,
			IPAddress: s.IPAddress,
			CreatedAt: s.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
			ExpiresAt: s.ExpiresAt.Format("2006-01-02T15:04:05.000Z"),
			IsCurrent: s.SessionToken == currentToken,
		}
	}

	return c.JSON(http.StatusOK, result)
}

func (h *AuthHandler) RevokeSession(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid session ID")
	}

	// Find the session to check it belongs to this user
	var dbSession models.Session
	if err := h.db.Where("id = ? AND user_id = ?", sessionID, userID).First(&dbSession).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Session not found")
	}

	// Prevent revoking the current session
	currentToken := c.Get(middleware.ContextKeySessionToken)
	if dbSession.SessionToken == currentToken {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot revoke the current session. Use logout instead.")
	}

	if err := h.authSvc.DeleteSessionByID(sessionID, userID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to revoke session")
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Session returns the current user's session data for the frontend.
// Returns { user: { ... } } when authenticated, {} when not.
func (h *AuthHandler) Session(c echo.Context) error {
	user, _, err := h.authSvc.GetUserBySession(c)
	if err != nil || user == nil {
		return c.JSON(http.StatusOK, map[string]interface{}{})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"user": toUserResponse(user),
	})
}

func normalizeEmail(email string) string {
	// Simple lowercase + trim
	return strings.ToLower(strings.TrimSpace(email))
}
