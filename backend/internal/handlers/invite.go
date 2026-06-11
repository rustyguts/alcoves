package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/invites"
)

type InviteHandler struct {
	db          *gorm.DB
	activitySvc *activity.Service
}

func NewInviteHandler(db *gorm.DB, activitySvc *activity.Service) *InviteHandler {
	return &InviteHandler{db: db, activitySvc: activitySvc}
}

func (h *InviteHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:token", h.Lookup)
	g.POST("/:token/accept", h.Accept)
}

// Lookup returns invite metadata. Public endpoint — anon callers are allowed
// so the register page can validate a token before sign-up.
func (h *InviteHandler) Lookup(c echo.Context) error {
	token := c.Param("token")
	userID := middleware.GetUserID(c)

	var invite models.LibraryInvite
	if err := h.db.Where("token = ?", token).First(&invite).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Invite not found")
	}

	var library models.Library
	h.db.Select("id, name, owner_id").Where("id = ?", invite.LibraryID).First(&library)

	var inviter models.User
	h.db.Select("id, display_name, avatar_url").Where("id = ?", invite.InvitedByUserID).First(&inviter)

	status := "pending"
	canAccept := false

	switch {
	case invite.RevokedAt != nil:
		status = "revoked"
	case invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()):
		status = "expired"
	case invite.MaxUses != nil && invite.UseCount >= *invite.MaxUses:
		status = "exhausted"
	default:
		if userID != uuid.Nil {
			var memberCount int64
			h.db.Model(&models.LibraryMember{}).
				Where("library_id = ? AND user_id = ?", invite.LibraryID, userID).
				Count(&memberCount)
			if library.OwnerID == userID || memberCount > 0 {
				status = "already_member"
			} else {
				canAccept = true
			}
		} else {
			canAccept = true
		}
	}

	var maxUses *int
	if invite.MaxUses != nil {
		v := *invite.MaxUses
		maxUses = &v
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":        invite.ID.String(),
		"status":    status,
		"canAccept": canAccept,
		"createdAt": invite.CreatedAt.Format(time.RFC3339Nano),
		"expiresAt": invite.ExpiresAt,
		"maxUses":   maxUses,
		"useCount":  invite.UseCount,
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

// Accept consumes an invite for the currently logged-in user.
func (h *InviteHandler) Accept(c echo.Context) error {
	token := c.Param("token")
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	invite, err := invites.LookupRedeemable(h.db, token)
	if err != nil {
		switch {
		case errors.Is(err, invites.ErrNotFound):
			return echo.NewHTTPError(http.StatusNotFound, "Invite not found")
		case errors.Is(err, invites.ErrRevoked):
			return echo.NewHTTPError(http.StatusGone, "Invite has been revoked")
		case errors.Is(err, invites.ErrExpired):
			return echo.NewHTTPError(http.StatusGone, "Invite has expired")
		case errors.Is(err, invites.ErrExhausted):
			return echo.NewHTTPError(http.StatusGone, "Invite has no remaining uses")
		default:
			return internalError("Failed to look up invite", err)
		}
	}

	result, err := invites.Redeem(h.db, invite, userID)
	if err != nil {
		if errors.Is(err, invites.ErrAlreadyMember) {
			var lib models.Library
			if dbErr := h.db.Select("owner_id").Where("id = ?", invite.LibraryID).First(&lib).Error; dbErr == nil && lib.OwnerID == userID {
				return c.JSON(http.StatusOK, map[string]interface{}{"libraryId": invite.LibraryID.String(), "role": "owner"})
			}
			var member models.LibraryMember
			if dbErr := h.db.Where("library_id = ? AND user_id = ?", invite.LibraryID, userID).First(&member).Error; dbErr == nil {
				return c.JSON(http.StatusOK, map[string]interface{}{"libraryId": invite.LibraryID.String(), "role": member.Role})
			}
			return c.JSON(http.StatusOK, map[string]interface{}{"libraryId": invite.LibraryID.String(), "role": "viewer"})
		}
		if errors.Is(err, invites.ErrExhausted) {
			return echo.NewHTTPError(http.StatusGone, "Invite has no remaining uses")
		}
		return internalError("Failed to redeem invite", err)
	}

	if result.AddedMember && h.activitySvc != nil {
		// Actor is the joining user themselves — actor exclusion in the
		// global feed query then hides this from their own bell, while
		// other members + the owner see "X joined".
		actor := userID
		var u models.User
		_ = h.db.Select("id, display_name").Where("id = ?", userID).First(&u).Error
		h.activitySvc.EmitAsync(activity.EmitParams{
			LibraryID:   invite.LibraryID,
			ActorID:     &actor,
			Action:      activity.ActionMemberJoined,
			SubjectType: activity.SubjectMember,
			SubjectID:   &userID,
			Metadata: map[string]any{
				"userId":      userID.String(),
				"displayName": u.DisplayName,
				"viaInviteId": invite.ID.String(),
			},
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"libraryId": invite.LibraryID.String(),
		"role":      "viewer",
	})
}
