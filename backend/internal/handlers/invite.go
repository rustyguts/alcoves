package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
)

type InviteHandler struct {
	db *gorm.DB
}

func NewInviteHandler(db *gorm.DB) *InviteHandler {
	return &InviteHandler{db: db}
}

func (h *InviteHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:token", h.Lookup)
	g.POST("/:token/accept", h.Accept)
}

func (h *InviteHandler) Lookup(c echo.Context) error {
	token := c.Param("token")
	userID, _ := middleware.RequireUserID(c)

	var invite models.LibraryInvite
	if err := h.db.Where("token = ?", token).First(&invite).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Invite not found")
	}

	// Load library
	var library models.Library
	h.db.Select("id, name").Where("id = ?", invite.LibraryID).First(&library)

	// Load inviter
	var inviter models.User
	h.db.Select("id, display_name, avatar_url").Where("id = ?", invite.InvitedByUserID).First(&inviter)

	// Determine status
	status := "pending"
	canAccept := false

	if invite.RevokedAt != nil {
		status = "revoked"
	} else if invite.AcceptedAt != nil {
		status = "accepted"
	} else if invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()) {
		status = "expired"
	} else {
		// Check if user is already a member
		var memberCount int64
		h.db.Model(&models.LibraryMember{}).
			Where("library_id = ? AND user_id = ?", invite.LibraryID, userID).
			Count(&memberCount)

		if library.OwnerID == userID || memberCount > 0 {
			status = "already_member"
		} else if invite.InvitedEmail != nil {
			// Email invite — check if user email matches
			var user models.User
			h.db.Select("email").Where("id = ?", userID).First(&user)
			if strings.ToLower(user.Email) != strings.ToLower(*invite.InvitedEmail) {
				status = "not_allowed"
			} else {
				canAccept = true
			}
		} else {
			canAccept = true
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":           invite.ID.String(),
		"role":         invite.Role,
		"status":       status,
		"canAccept":    canAccept,
		"createdAt":    invite.CreatedAt.Format(time.RFC3339Nano),
		"invitedEmail": invite.InvitedEmail,
		"invitedBy": map[string]interface{}{
			"id":          inviter.ID.String(),
			"displayName": inviter.DisplayName,
			"avatarUrl":   inviter.AvatarUrl,
		},
		"library": map[string]interface{}{
			"id":   library.ID.String(),
			"name": library.Name,
		},
	})
}

func (h *InviteHandler) Accept(c echo.Context) error {
	token := c.Param("token")
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var invite models.LibraryInvite
	if err := h.db.Where("token = ?", token).First(&invite).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Invite not found")
	}

	// Validate invite is acceptable
	if invite.RevokedAt != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invite has been revoked")
	}
	if invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()) {
		return echo.NewHTTPError(http.StatusBadRequest, "Invite has expired")
	}

	// Check email match for email invites
	if invite.InvitedEmail != nil {
		var user models.User
		h.db.Select("email").Where("id = ?", userID).First(&user)
		if strings.ToLower(user.Email) != strings.ToLower(*invite.InvitedEmail) {
			return echo.NewHTTPError(http.StatusForbidden, "This invite is for a different email address")
		}
	}

	// Check already a member
	var memberCount int64
	h.db.Model(&models.LibraryMember{}).
		Where("library_id = ? AND user_id = ?", invite.LibraryID, userID).
		Count(&memberCount)

	var library models.Library
	h.db.Select("owner_id").Where("id = ?", invite.LibraryID).First(&library)

	if library.OwnerID == userID || memberCount > 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "Already a member of this library")
	}

	// Create membership
	member := models.LibraryMember{
		LibraryID: invite.LibraryID,
		UserID:    userID,
		Role:      invite.Role,
	}
	if err := h.db.Create(&member).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to join library")
	}

	// Update invite
	now := time.Now()
	h.db.Model(&invite).Updates(map[string]interface{}{
		"accepted_by_user_id": userID,
		"accepted_at":         now,
		"use_count":           gorm.Expr("use_count + 1"),
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"libraryId": invite.LibraryID.String(),
		"role":      invite.Role,
	})
}
