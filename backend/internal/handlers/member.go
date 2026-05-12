package handlers

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
)

type MemberHandler struct {
	db          *gorm.DB
	accessSvc   *access.Service
	activitySvc *activity.Service
}

func NewMemberHandler(db *gorm.DB, accessSvc *access.Service, activitySvc *activity.Service) *MemberHandler {
	return &MemberHandler{db: db, accessSvc: accessSvc, activitySvc: activitySvc}
}

func (h *MemberHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/users", h.ListUsers)
	g.PATCH("/:id/users/:memberUserId", h.UpdateMemberRole)
	g.DELETE("/:id/users/:memberUserId", h.RemoveMember)
	g.POST("/:id/users/invite-link", h.CreateInviteLink)
	g.DELETE("/:id/users/invites/:inviteId", h.RevokeInvite)
}

func (h *MemberHandler) ListUsers(c echo.Context) error {
	libraryID := c.Param("id")
	la := middleware.GetLibraryAccess(c)

	// Get members with user details
	type memberRow struct {
		ID          string    `gorm:"column:id"`
		UserID      string    `gorm:"column:user_id"`
		Role        string    `gorm:"column:role"`
		CreatedAt   time.Time `gorm:"column:created_at"`
		Email       string    `gorm:"column:email"`
		DisplayName string    `gorm:"column:display_name"`
		AvatarUrl   *string   `gorm:"column:avatar_url"`
	}

	var members []memberRow
	h.db.Raw(`
		SELECT lm.id, lm.user_id, lm.role, lm.created_at, u.email, u.display_name, u.avatar_url
		FROM library_members lm
		INNER JOIN users u ON u.id = lm.user_id
		WHERE lm.library_id = ?
		ORDER BY lm.created_at
	`, libraryID).Scan(&members)

	// Get owner
	var library models.Library
	h.db.Select("owner_id").Where("id = ?", libraryID).First(&library)
	var owner models.User
	h.db.Select("id, email, display_name, avatar_url").Where("id = ?", library.OwnerID).First(&owner)

	// Build member list with owner first
	memberList := []map[string]interface{}{
		{
			"id":        "",
			"userId":    owner.ID.String(),
			"role":      "owner",
			"isOwner":   true,
			"createdAt": owner.CreatedAt.Format(time.RFC3339Nano),
			"user": map[string]interface{}{
				"id":          owner.ID.String(),
				"email":       owner.Email,
				"displayName": owner.DisplayName,
				"avatarUrl":   owner.AvatarUrl,
			},
		},
	}

	for _, m := range members {
		memberList = append(memberList, map[string]interface{}{
			"id":        m.ID,
			"userId":    m.UserID,
			"role":      m.Role,
			"isOwner":   false,
			"createdAt": m.CreatedAt.Format(time.RFC3339Nano),
			"user": map[string]interface{}{
				"id":          m.UserID,
				"email":       m.Email,
				"displayName": m.DisplayName,
				"avatarUrl":   m.AvatarUrl,
			},
		})
	}

	canManage := la != nil && la.IsAdmin && !la.IsDefault

	// Invite links — visible only to managers.
	type inviteRow struct {
		ID            string     `gorm:"column:id"`
		Token         string     `gorm:"column:token"`
		MaxUses       *int       `gorm:"column:max_uses"`
		UseCount      int        `gorm:"column:use_count"`
		ExpiresAt     *time.Time `gorm:"column:expires_at"`
		CreatedAt     time.Time  `gorm:"column:created_at"`
		InviterID     string     `gorm:"column:invited_by_user_id"`
		InviterName   string     `gorm:"column:display_name"`
		InviterAvatar *string    `gorm:"column:avatar_url"`
	}

	var rows []inviteRow
	if canManage {
		h.db.Raw(`
			SELECT li.id, li.token, li.max_uses, li.use_count, li.expires_at, li.created_at,
				   li.invited_by_user_id, u.display_name, u.avatar_url
			FROM library_invites li
			INNER JOIN users u ON u.id = li.invited_by_user_id
			WHERE li.library_id = ? AND li.revoked_at IS NULL
			ORDER BY li.created_at DESC
		`, libraryID).Scan(&rows)
	}

	type useRow struct {
		InviteID    string    `gorm:"column:invite_id"`
		UserID      string    `gorm:"column:user_id"`
		UsedAt      time.Time `gorm:"column:used_at"`
		Email       string    `gorm:"column:email"`
		DisplayName string    `gorm:"column:display_name"`
		AvatarUrl   *string   `gorm:"column:avatar_url"`
	}

	usesByInvite := map[string][]map[string]interface{}{}
	if canManage && len(rows) > 0 {
		ids := make([]string, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
		}
		var uses []useRow
		h.db.Raw(`
			SELECT liu.invite_id, liu.user_id, liu.used_at, u.email, u.display_name, u.avatar_url
			FROM library_invite_uses liu
			INNER JOIN users u ON u.id = liu.user_id
			WHERE liu.invite_id IN ?
			ORDER BY liu.used_at DESC
		`, ids).Scan(&uses)
		for _, u := range uses {
			usesByInvite[u.InviteID] = append(usesByInvite[u.InviteID], map[string]interface{}{
				"usedAt": u.UsedAt.Format(time.RFC3339Nano),
				"user": map[string]interface{}{
					"id":          u.UserID,
					"email":       u.Email,
					"displayName": u.DisplayName,
					"avatarUrl":   u.AvatarUrl,
				},
			})
		}
	}

	inviteLinks := make([]map[string]interface{}, len(rows))
	for i, r := range rows {
		var expires *string
		if r.ExpiresAt != nil {
			s := r.ExpiresAt.Format(time.RFC3339Nano)
			expires = &s
		}
		inviteLinks[i] = map[string]interface{}{
			"id":        r.ID,
			"token":     r.Token,
			"maxUses":   r.MaxUses,
			"useCount":  r.UseCount,
			"expiresAt": expires,
			"createdAt": r.CreatedAt.Format(time.RFC3339Nano),
			"inviteUrl": "/invites/" + r.Token,
			"invitedBy": map[string]interface{}{
				"id":          r.InviterID,
				"displayName": r.InviterName,
				"avatarUrl":   r.InviterAvatar,
			},
			"uses": usesByInvite[r.ID],
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"libraryId":      libraryID,
		"canManageUsers": canManage,
		"members":        memberList,
		"inviteLinks":    inviteLinks,
	})
}

type updateMemberRoleRequest struct {
	Role string `json:"role" validate:"required,oneof=admin viewer"`
}

func (h *MemberHandler) UpdateMemberRole(c echo.Context) error {
	libraryID := c.Param("id")
	memberUserID := c.Param("memberUserId")

	var req updateMemberRoleRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}

	result := h.db.Model(&models.LibraryMember{}).
		Where("library_id = ? AND user_id = ?", libraryID, memberUserID).
		Updates(map[string]interface{}{"role": req.Role, "updated_at": time.Now()})

	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Member not found")
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func (h *MemberHandler) RemoveMember(c echo.Context) error {
	libraryID := c.Param("id")
	memberUserID := c.Param("memberUserId")
	userID, _ := middleware.RequireUserID(c)

	// Cannot remove self
	if memberUserID == userID.String() {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot remove yourself from the library")
	}

	// Snapshot the user's display name before the delete so the activity
	// row still renders something meaningful.
	var removed models.User
	memberUUID, _ := uuid.Parse(memberUserID)
	_ = h.db.Select("id, display_name").Where("id = ?", memberUUID).First(&removed).Error

	result := h.db.Where("library_id = ? AND user_id = ?", libraryID, memberUserID).Delete(&models.LibraryMember{})
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Member not found")
	}

	if h.activitySvc != nil {
		libUUID, _ := uuid.Parse(libraryID)
		actor := userID
		h.activitySvc.EmitAsync(activity.EmitParams{
			LibraryID:   libUUID,
			ActorID:     &actor,
			Action:      activity.ActionMemberRemoved,
			SubjectType: activity.SubjectMember,
			SubjectID:   &memberUUID,
			Metadata: map[string]any{
				"userId":      memberUserID,
				"displayName": removed.DisplayName,
			},
		})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

type createInviteLinkRequest struct {
	MaxUses   *int       `json:"maxUses,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

func (h *MemberHandler) CreateInviteLink(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var req createInviteLinkRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if req.MaxUses != nil && *req.MaxUses <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "maxUses must be positive")
	}
	if req.ExpiresAt != nil && req.ExpiresAt.Before(time.Now()) {
		return echo.NewHTTPError(http.StatusBadRequest, "expiresAt must be in the future")
	}

	token := uuid.New().String()
	invite := models.LibraryInvite{
		LibraryID:       libraryID,
		InvitedByUserID: userID,
		Token:           token,
		MaxUses:         req.MaxUses,
		ExpiresAt:       req.ExpiresAt,
	}

	if err := h.db.Create(&invite).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create invite")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":        invite.ID.String(),
		"token":     token,
		"inviteUrl": "/invites/" + token,
		"maxUses":   invite.MaxUses,
		"expiresAt": invite.ExpiresAt,
	})
}

func (h *MemberHandler) RevokeInvite(c echo.Context) error {
	libraryID := c.Param("id")
	inviteID := c.Param("inviteId")

	now := time.Now()
	result := h.db.Model(&models.LibraryInvite{}).
		Where("id = ? AND library_id = ? AND revoked_at IS NULL", inviteID, libraryID).
		Update("revoked_at", now)

	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Invite not found")
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}
