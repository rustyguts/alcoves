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
)

type MemberHandler struct {
	db        *gorm.DB
	accessSvc *access.Service
}

func NewMemberHandler(db *gorm.DB, accessSvc *access.Service) *MemberHandler {
	return &MemberHandler{db: db, accessSvc: accessSvc}
}

func (h *MemberHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/users", h.ListUsers)
	g.PATCH("/:id/users/:memberUserId", h.UpdateMemberRole)
	g.DELETE("/:id/users/:memberUserId", h.RemoveMember)
	g.POST("/:id/users/invite-link", h.CreateInviteLink)
	g.POST("/:id/users/invite-email", h.CreateEmailInvite)
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
			"id":      "",
			"userId":  owner.ID.String(),
			"role":    "owner",
			"isOwner": true,
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
			"id":      m.ID,
			"userId":  m.UserID,
			"role":    m.Role,
			"isOwner": false,
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

	// Get pending invites
	type inviteRow struct {
		ID             string    `gorm:"column:id"`
		InvitedEmail   *string   `gorm:"column:invited_email"`
		Role           string    `gorm:"column:role"`
		UseCount       int       `gorm:"column:use_count"`
		Token          string    `gorm:"column:token"`
		CreatedAt      time.Time `gorm:"column:created_at"`
		InviterID      string    `gorm:"column:invited_by_user_id"`
		InviterName    string    `gorm:"column:display_name"`
		InviterAvatar  *string   `gorm:"column:avatar_url"`
	}

	var invites []inviteRow
	if canManage {
		h.db.Raw(`
			SELECT li.id, li.invited_email, li.role, li.use_count, li.token, li.created_at,
				   li.invited_by_user_id, u.display_name, u.avatar_url
			FROM library_invites li
			INNER JOIN users u ON u.id = li.invited_by_user_id
			WHERE li.library_id = ? AND li.revoked_at IS NULL AND li.accepted_at IS NULL
			  AND (li.expires_at IS NULL OR li.expires_at > NOW())
			ORDER BY li.created_at DESC
		`, libraryID).Scan(&invites)
	}

	pendingInvites := make([]map[string]interface{}, len(invites))
	for i, inv := range invites {
		pendingInvites[i] = map[string]interface{}{
			"id":           inv.ID,
			"invitedEmail": inv.InvitedEmail,
			"role":         inv.Role,
			"useCount":     inv.UseCount,
			"createdAt":    inv.CreatedAt.Format(time.RFC3339Nano),
			"inviteUrl":    "/invite/" + inv.Token,
			"invitedBy": map[string]interface{}{
				"id":          inv.InviterID,
				"displayName": inv.InviterName,
				"avatarUrl":   inv.InviterAvatar,
			},
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"libraryId":      libraryID,
		"canManageUsers": canManage,
		"members":        memberList,
		"pendingInvites": pendingInvites,
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

	result := h.db.Where("library_id = ? AND user_id = ?", libraryID, memberUserID).Delete(&models.LibraryMember{})
	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Member not found")
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

type createInviteLinkRequest struct {
	Role string `json:"role" validate:"required,oneof=admin viewer"`
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
	if err := c.Validate(req); err != nil {
		return err
	}

	token := uuid.New().String()
	invite := models.LibraryInvite{
		LibraryID:       libraryID,
		InvitedByUserID: userID,
		Role:            req.Role,
		Token:           token,
	}

	if err := h.db.Create(&invite).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create invite")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":        invite.ID.String(),
		"token":     token,
		"inviteUrl": "/invite/" + token,
		"role":      req.Role,
	})
}

type createEmailInviteRequest struct {
	Email string `json:"email" validate:"required,email"`
	Role  string `json:"role" validate:"required,oneof=admin viewer"`
}

func (h *MemberHandler) CreateEmailInvite(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var req createEmailInviteRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}

	email := normalizeEmail(req.Email)
	token := uuid.New().String()

	invite := models.LibraryInvite{
		LibraryID:       libraryID,
		InvitedByUserID: userID,
		InvitedEmail:    &email,
		Role:            req.Role,
		Token:           token,
	}

	if err := h.db.Create(&invite).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create invite")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":        invite.ID.String(),
		"token":     token,
		"inviteUrl": "/invite/" + token,
		"role":      req.Role,
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
