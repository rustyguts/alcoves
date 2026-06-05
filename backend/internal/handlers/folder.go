package handlers

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/files"
)

type FolderHandler struct {
	db          *gorm.DB
	activitySvc *activity.Service
}

func NewFolderHandler(db *gorm.DB, activitySvc *activity.Service) *FolderHandler {
	return &FolderHandler{db: db, activitySvc: activitySvc}
}

func (h *FolderHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/:id/folders", h.List)
	g.POST("/:id/folders", h.Create)
	g.PATCH("/:id/folders/:folderId", h.Update)
	g.DELETE("/:id/folders/:folderId", h.Delete)
	g.POST("/:id/folders/:folderId/move", h.Move)
	g.POST("/:id/folders/restore", h.Restore)
}

func (h *FolderHandler) List(c echo.Context) error {
	libraryID := c.Param("id")

	var folders []models.Folder
	if err := h.db.
		Preload("Owner").
		Where("library_id = ? AND trashed_at IS NULL", libraryID).
		Order("created_at ASC").
		Find(&folders).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to fetch folders")
	}

	response := make([]map[string]interface{}, 0, len(folders))
	for i := range folders {
		response = append(response, folderToJSON(&folders[i]))
	}

	return c.JSON(http.StatusOK, response)
}

type createFolderRequest struct {
	Name           string  `json:"name" validate:"required,min=1"`
	ParentFolderID *string `json:"parentFolderId"`
}

func (h *FolderHandler) Create(c echo.Context) error {
	libraryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid library ID")
	}
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	var req createFolderRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}
	if err := c.Validate(req); err != nil {
		return err
	}

	var parentFolderID *uuid.UUID
	if req.ParentFolderID != nil && *req.ParentFolderID != "" && *req.ParentFolderID != "null" {
		parsed, err := uuid.Parse(*req.ParentFolderID)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid parent folder ID")
		}
		// Verify parent folder exists
		var count int64
		h.db.Model(&models.Folder{}).Where("id = ? AND library_id = ? AND trashed_at IS NULL", parsed, libraryID).Count(&count)
		if count == 0 {
			return echo.NewHTTPError(http.StatusNotFound, "Parent folder not found")
		}
		parentFolderID = &parsed
	}

	folder := models.Folder{
		LibraryID:      libraryID,
		ParentFolderID: parentFolderID,
		OwnerID:        &userID,
		Name:           req.Name,
	}

	if err := h.db.Create(&folder).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create folder")
	}
	if err := h.db.Preload("Owner").Where("id = ?", folder.ID).First(&folder).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to load folder")
	}

	aid := userID
	emitActivity(h.activitySvc, activity.EmitParams{
		LibraryID:   libraryID,
		ActorID:     &aid,
		Action:      activity.ActionFolderCreated,
		SubjectType: activity.SubjectFolder,
		SubjectID:   &folder.ID,
		Metadata: map[string]any{
			"name":           folder.Name,
			"parentFolderId": parentFolderID,
		},
	})

	return c.JSON(http.StatusOK, folderToJSON(&folder))
}

type updateFolderRequest struct {
	Name *string `json:"name"`
}

func (h *FolderHandler) Update(c echo.Context) error {
	libraryID := c.Param("id")
	folderID := c.Param("folderId")

	var req updateFolderRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}

	if len(updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No fields to update")
	}

	updates["updated_at"] = time.Now()

	// Snapshot the old folder for the rename emit.
	var snapshot models.Folder
	_ = h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", folderID, libraryID).First(&snapshot).Error

	result := h.db.Model(&models.Folder{}).
		Where("id = ? AND library_id = ? AND trashed_at IS NULL", folderID, libraryID).
		Updates(updates)

	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Folder not found")
	}

	var folder models.Folder
	h.db.Preload("Owner").Where("id = ?", folderID).First(&folder)

	if h.activitySvc != nil && req.Name != nil && *req.Name != snapshot.Name {
		actorID := middleware.GetUserID(c)
		libUUID, _ := uuid.Parse(libraryID)
		h.activitySvc.EmitAsync(activity.EmitParams{
			LibraryID:   libUUID,
			ActorID:     &actorID,
			Action:      activity.ActionFolderRenamed,
			SubjectType: activity.SubjectFolder,
			SubjectID:   &folder.ID,
			Metadata: map[string]any{
				"oldName": snapshot.Name,
				"newName": folder.Name,
			},
		})
	}

	return c.JSON(http.StatusOK, folderToJSON(&folder))
}

func (h *FolderHandler) Delete(c echo.Context) error {
	libraryID := c.Param("id")
	folderID := c.Param("folderId")

	now := time.Now()

	// Snapshot for the activity row.
	var snapshot models.Folder
	_ = h.db.Where("id = ? AND library_id = ?", folderID, libraryID).First(&snapshot).Error

	// Soft-delete the folder
	result := h.db.Model(&models.Folder{}).
		Where("id = ? AND library_id = ? AND trashed_at IS NULL", folderID, libraryID).
		Updates(map[string]interface{}{"trashed_at": now, "updated_at": now})

	if result.RowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Folder not found")
	}

	{
		actorID := middleware.GetUserID(c)
		libUUID, _ := uuid.Parse(libraryID)
		emitActivity(h.activitySvc, activity.EmitParams{
			LibraryID:   libUUID,
			ActorID:     &actorID,
			Action:      activity.ActionFolderDeleted,
			SubjectType: activity.SubjectFolder,
			SubjectID:   &snapshot.ID,
			Metadata: map[string]any{
				"name": snapshot.Name,
			},
		})
	}

	// Cascade soft-delete to descendant folders
	descendantIDs := files.DescendantFolderIDs(h.db, libraryID, folderID)
	if len(descendantIDs) > 0 {
		h.db.Model(&models.Folder{}).
			Where("id IN ? AND trashed_at IS NULL", descendantIDs).
			Updates(map[string]interface{}{"trashed_at": now, "updated_at": now})
	}

	// Soft-delete files in this folder and all descendants
	allFolderIDs := append([]string{folderID}, descendantIDs...)
	h.db.Model(&models.File{}).
		Where("parent_folder_id IN ? AND library_id = ? AND trashed_at IS NULL", allFolderIDs, libraryID).
		Updates(map[string]interface{}{"trashed_at": now, "updated_at": now})

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

type moveFolderRequest struct {
	ParentFolderID *string `json:"parentFolderId"`
}

func (h *FolderHandler) Move(c echo.Context) error {
	libraryID := c.Param("id")
	folderID := c.Param("folderId")

	var req moveFolderRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	// Verify folder exists
	var folder models.Folder
	if err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", folderID, libraryID).First(&folder).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Folder not found")
	}

	var newParentID *uuid.UUID
	if req.ParentFolderID != nil && *req.ParentFolderID != "" && *req.ParentFolderID != "null" {
		parsed, err := uuid.Parse(*req.ParentFolderID)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid parent folder ID")
		}

		// Cannot move into itself
		if parsed.String() == folderID {
			return echo.NewHTTPError(http.StatusBadRequest, "Folder cannot be moved into itself")
		}

		// Cycle detection: walk up from destination, ensure we don't reach the folder being moved
		if err := h.assertMoveParentValid(libraryID, folderID, parsed.String()); err != nil {
			return err
		}

		newParentID = &parsed
	}

	h.db.Model(&models.Folder{}).
		Where("id = ?", folderID).
		Updates(map[string]interface{}{
			"parent_folder_id": newParentID,
			"updated_at":       time.Now(),
		})

	h.db.Preload("Owner").Where("id = ?", folderID).First(&folder)
	return c.JSON(http.StatusOK, folderToJSON(&folder))
}

type restoreFoldersRequest struct {
	FolderIDs []string `json:"folderIds" validate:"required"`
}

func (h *FolderHandler) Restore(c echo.Context) error {
	libraryID := c.Param("id")

	var req restoreFoldersRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if len(req.FolderIDs) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "folderIds is required")
	}

	result := h.db.Model(&models.Folder{}).
		Where("id IN ? AND library_id = ? AND trashed_at IS NOT NULL", req.FolderIDs, libraryID).
		Updates(map[string]interface{}{
			"trashed_at":       nil,
			"parent_folder_id": nil, // Restore to root
			"updated_at":       time.Now(),
		})

	// Also restore descendant folders and their files
	for _, fid := range req.FolderIDs {
		descendants := files.DescendantFolderIDs(h.db, libraryID, fid)
		if len(descendants) > 0 {
			h.db.Model(&models.Folder{}).
				Where("id IN ?", descendants).
				Updates(map[string]interface{}{"trashed_at": nil, "updated_at": time.Now()})
		}
		allIDs := append([]string{fid}, descendants...)
		h.db.Model(&models.File{}).
			Where("parent_folder_id IN ? AND library_id = ? AND trashed_at IS NOT NULL", allIDs, libraryID).
			Updates(map[string]interface{}{"trashed_at": nil, "updated_at": time.Now()})
	}

	return c.JSON(http.StatusOK, map[string]int64{"restored": result.RowsAffected})
}

func (h *FolderHandler) assertMoveParentValid(libraryID, folderID, parentFolderID string) error {
	visited := map[string]bool{}
	currentID := parentFolderID

	for currentID != "" {
		if visited[currentID] {
			return echo.NewHTTPError(http.StatusBadRequest, "Invalid folder hierarchy")
		}
		visited[currentID] = true

		if currentID == folderID {
			return echo.NewHTTPError(http.StatusBadRequest, "Folder cannot be moved into a descendant folder")
		}

		var folder struct {
			ID             string  `gorm:"column:id"`
			ParentFolderID *string `gorm:"column:parent_folder_id"`
		}
		err := h.db.Raw(
			"SELECT id, parent_folder_id FROM folders WHERE id = ? AND library_id = ? AND trashed_at IS NULL",
			currentID, libraryID,
		).Scan(&folder).Error
		if err != nil || folder.ID == "" {
			return echo.NewHTTPError(http.StatusNotFound, "Destination folder not found")
		}

		if folder.ParentFolderID != nil {
			currentID = *folder.ParentFolderID
		} else {
			currentID = ""
		}
	}

	return nil
}

func folderToJSON(f *models.Folder) map[string]interface{} {
	var owner map[string]interface{}
	if f.Owner != nil {
		owner = map[string]interface{}{
			"id":          f.Owner.ID.String(),
			"displayName": f.Owner.DisplayName,
			"avatarUrl":   f.Owner.AvatarUrl,
		}
	}

	return map[string]interface{}{
		"id":             f.ID.String(),
		"libraryId":      f.LibraryID.String(),
		"parentFolderId": uuidPtr(f.ParentFolderID),
		"name":           f.Name,
		"kind":           "folder",
		"trashedAt":      timeStr(f.TrashedAt),
		"createdAt":      f.CreatedAt.Format(time.RFC3339Nano),
		"updatedAt":      f.UpdatedAt.Format(time.RFC3339Nano),
		"owner":          owner,
		"tags":           []interface{}{},
	}
}
