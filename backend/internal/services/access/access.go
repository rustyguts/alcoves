package access

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

type LibraryAccessRole string

const (
	RoleOwner  LibraryAccessRole = "owner"
	RoleAdmin  LibraryAccessRole = "admin"
	RoleViewer LibraryAccessRole = "viewer"
)

type LibraryAccess struct {
	LibraryID   uuid.UUID         `json:"libraryId"`
	LibraryName string            `json:"libraryName"`
	OwnerID     uuid.UUID         `json:"ownerId"`
	IsDefault   bool              `json:"isDefault"`
	Role        LibraryAccessRole `json:"role"`
	IsOwner     bool              `json:"isOwner"`
	IsAdmin     bool              `json:"isAdmin"`
}

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// GetLibraryAccess determines the user's access to a library.
func (s *Service) GetLibraryAccess(userID, libraryID uuid.UUID) (*LibraryAccess, error) {
	var library models.Library
	err := s.db.Select("id, name, owner_id, is_default").
		Where("id = ?", libraryID).First(&library).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Owner always has access
	if library.OwnerID == userID {
		return &LibraryAccess{
			LibraryID:   library.ID,
			LibraryName: library.Name,
			OwnerID:     library.OwnerID,
			IsDefault:   library.IsDefault,
			Role:        RoleOwner,
			IsOwner:     true,
			IsAdmin:     true,
		}, nil
	}

	// Personal/default libraries are never collaborative
	if library.IsDefault {
		return nil, nil
	}

	// Check membership
	var member models.LibraryMember
	err = s.db.Where("library_id = ? AND user_id = ?", library.ID, userID).
		First(&member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	role := LibraryAccessRole(member.Role)
	return &LibraryAccess{
		LibraryID:   library.ID,
		LibraryName: library.Name,
		OwnerID:     library.OwnerID,
		IsDefault:   library.IsDefault,
		Role:        role,
		IsOwner:     false,
		IsAdmin:     role == RoleAdmin,
	}, nil
}

// RequireLibraryAccess checks access and returns 404 if none.
func (s *Service) RequireLibraryAccess(c echo.Context, userID, libraryID uuid.UUID) (*LibraryAccess, error) {
	access, err := s.GetLibraryAccess(userID, libraryID)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError, "Failed to check library access")
	}
	if access == nil {
		return nil, echo.NewHTTPError(http.StatusNotFound, "Library not found")
	}
	return access, nil
}

// RequireLibraryAdmin checks admin access and returns 403 if viewer.
func (s *Service) RequireLibraryAdmin(c echo.Context, userID, libraryID uuid.UUID) (*LibraryAccess, error) {
	access, err := s.RequireLibraryAccess(c, userID, libraryID)
	if err != nil {
		return nil, err
	}
	if !access.IsAdmin {
		return nil, echo.NewHTTPError(http.StatusForbidden, "Only library admins can perform this action")
	}
	return access, nil
}

// RequireCollaborativeLibraryAdmin checks admin access on a non-personal library.
func (s *Service) RequireCollaborativeLibraryAdmin(c echo.Context, userID, libraryID uuid.UUID) (*LibraryAccess, error) {
	access, err := s.RequireLibraryAdmin(c, userID, libraryID)
	if err != nil {
		return nil, err
	}
	if access.IsDefault {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Collaboration is disabled for personal libraries")
	}
	return access, nil
}
