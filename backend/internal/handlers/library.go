package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
)

type LibraryHandler struct {
	db        *gorm.DB
	accessSvc *access.Service
	faceSvc   *facedetection.Service
	objSvc    *objectdetection.Service
}

func NewLibraryHandler(db *gorm.DB, accessSvc *access.Service, faceSvc *facedetection.Service, objSvc *objectdetection.Service) *LibraryHandler {
	return &LibraryHandler{db: db, accessSvc: accessSvc, faceSvc: faceSvc, objSvc: objSvc}
}

func (h *LibraryHandler) RegisterRoutes(g *echo.Group) {
	g.GET("", h.List)
	g.POST("", h.Create)
	g.GET("/:id", h.Get)
	g.PATCH("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
}

type libraryResponse struct {
	ID                     string  `json:"id"`
	Name                   string  `json:"name"`
	Emoji                  *string `json:"emoji"`
	IsDefault              bool    `json:"isDefault"`
	FaceRecognitionEnabled bool    `json:"faceRecognitionEnabled"`
	ObjectDetectionEnabled bool    `json:"objectDetectionEnabled"`
	SharingEnabled         bool    `json:"sharingEnabled"`
	OwnerID                string  `json:"ownerId"`
	CurrentUserRole        *string `json:"currentUserRole,omitempty"`
	CanManageUsers         *bool   `json:"canManageUsers,omitempty"`
	CreatedAt              string  `json:"createdAt"`
	UpdatedAt              string  `json:"updatedAt"`
}

func toLibraryResponse(lib *models.Library, la *access.LibraryAccess) libraryResponse {
	resp := libraryResponse{
		ID:                     lib.ID.String(),
		Name:                   lib.Name,
		Emoji:                  lib.Emoji,
		IsDefault:              lib.IsDefault,
		FaceRecognitionEnabled: lib.FaceRecognitionEnabled,
		ObjectDetectionEnabled: lib.ObjectDetectionEnabled,
		SharingEnabled:         lib.SharingEnabled,
		OwnerID:                lib.OwnerID.String(),
		CreatedAt:              lib.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:              lib.UpdatedAt.Format("2006-01-02T15:04:05.000Z"),
	}
	if la != nil {
		role := string(la.Role)
		resp.CurrentUserRole = &role
		canManage := la.IsAdmin && !la.IsDefault
		resp.CanManageUsers = &canManage
	}
	return resp
}

func (h *LibraryHandler) List(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	// Get libraries the user owns
	var ownedLibs []models.Library
	h.db.Where("owner_id = ?", userID).Order("created_at").Find(&ownedLibs)

	// Get libraries the user is a member of
	var memberEntries []models.LibraryMember
	h.db.Where("user_id = ?", userID).Find(&memberEntries)

	memberLibIDs := make([]uuid.UUID, len(memberEntries))
	memberRoles := make(map[uuid.UUID]string)
	for i, m := range memberEntries {
		memberLibIDs[i] = m.LibraryID
		memberRoles[m.LibraryID] = m.Role
	}

	var memberLibs []models.Library
	if len(memberLibIDs) > 0 {
		h.db.Where("id IN ?", memberLibIDs).Order("created_at").Find(&memberLibs)
	}

	// Build response
	results := make([]libraryResponse, 0, len(ownedLibs)+len(memberLibs))
	for i := range ownedLibs {
		lib := &ownedLibs[i]
		la := &access.LibraryAccess{
			LibraryID: lib.ID,
			Role:      access.RoleOwner,
			IsOwner:   true,
			IsAdmin:   true,
			IsDefault: lib.IsDefault,
		}
		results = append(results, toLibraryResponse(lib, la))
	}
	for i := range memberLibs {
		lib := &memberLibs[i]
		role := access.LibraryAccessRole(memberRoles[lib.ID])
		la := &access.LibraryAccess{
			LibraryID: lib.ID,
			Role:      role,
			IsOwner:   false,
			IsAdmin:   role == access.RoleAdmin,
			IsDefault: lib.IsDefault,
		}
		results = append(results, toLibraryResponse(lib, la))
	}

	return c.JSON(http.StatusOK, results)
}

type createLibraryRequest struct {
	Name string `json:"name" validate:"required,min=1"`
}

func (h *LibraryHandler) Create(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var req createLibraryRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}

	library := models.Library{
		Name:      req.Name,
		IsDefault: false,
		OwnerID:   userID,
	}

	if err := h.db.Create(&library).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create library")
	}

	la := &access.LibraryAccess{
		LibraryID: library.ID,
		Role:      access.RoleOwner,
		IsOwner:   true,
		IsAdmin:   true,
		IsDefault: false,
	}

	return c.JSON(http.StatusOK, toLibraryResponse(&library, la))
}

func (h *LibraryHandler) Get(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	la := middleware.GetLibraryAccess(c)
	if la == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Library not found")
	}

	var library models.Library
	if err := h.db.Where("id = ?", libraryID).First(&library).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Library not found")
	}

	return c.JSON(http.StatusOK, toLibraryResponse(&library, la))
}

type updateLibraryRequest struct {
	Name                   *string `json:"name"`
	Emoji                  *string `json:"emoji"`
	FaceRecognitionEnabled *bool   `json:"faceRecognitionEnabled"`
	ObjectDetectionEnabled *bool   `json:"objectDetectionEnabled"`
	SharingEnabled         *bool   `json:"sharingEnabled"`
}

func (h *LibraryHandler) Update(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	la := middleware.GetLibraryAccess(c)

	var req updateLibraryRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Emoji != nil {
		if *req.Emoji == "" {
			updates["emoji"] = nil
		} else {
			updates["emoji"] = *req.Emoji
		}
	}
	if req.FaceRecognitionEnabled != nil {
		updates["face_recognition_enabled"] = *req.FaceRecognitionEnabled
	}
	if req.ObjectDetectionEnabled != nil {
		updates["object_detection_enabled"] = *req.ObjectDetectionEnabled
	}
	if req.SharingEnabled != nil {
		updates["sharing_enabled"] = *req.SharingEnabled
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}

	if err := h.db.Model(&models.Library{}).Where("id = ?", libraryID).Updates(updates).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to update library")
	}

	// When a detection feature is enabled, enqueue all existing images
	if req.FaceRecognitionEnabled != nil && *req.FaceRecognitionEnabled && h.faceSvc != nil {
		go func() {
			enqueued, err := h.faceSvc.EnqueueExistingImages(libraryID.String())
			if err != nil {
				log.Printf("failed to enqueue existing images for face detection in library %s: %v", libraryID, err)
			} else if enqueued > 0 {
				log.Printf("enqueued %d existing images for face detection in library %s", enqueued, libraryID)
			}
		}()
	}

	if req.ObjectDetectionEnabled != nil && *req.ObjectDetectionEnabled && h.objSvc != nil {
		go func() {
			enqueued, err := h.objSvc.EnqueueExistingImages(libraryID.String())
			if err != nil {
				log.Printf("failed to enqueue existing images for object detection in library %s: %v", libraryID, err)
			} else if enqueued > 0 {
				log.Printf("enqueued %d existing images for object detection in library %s", enqueued, libraryID)
			}
		}()
	}

	var library models.Library
	h.db.Where("id = ?", libraryID).First(&library)

	return c.JSON(http.StatusOK, toLibraryResponse(&library, la))
}

func (h *LibraryHandler) Delete(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}

	la := middleware.GetLibraryAccess(c)
	if la == nil || !la.IsOwner {
		return echo.NewHTTPError(http.StatusForbidden, "Only the library owner can delete it")
	}

	if la.IsDefault {
		return echo.NewHTTPError(http.StatusBadRequest, "Cannot delete your default library")
	}

	// Library must be empty before deletion
	var fileCount int64
	h.db.Model(&models.File{}).Where("library_id = ?", libraryID).Count(&fileCount)
	if fileCount > 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "Library must be empty before it can be deleted")
	}

	if err := h.db.Where("id = ?", libraryID).Delete(&models.Library{}).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to delete library")
	}

	return c.JSON(http.StatusOK, map[string]bool{"success": true})
}
