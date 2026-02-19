package handlers

import (
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/middleware"
)

type SearchHandler struct {
	db *gorm.DB
}

func NewSearchHandler(db *gorm.DB) *SearchHandler {
	return &SearchHandler{db: db}
}

func (h *SearchHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/search", h.Search)
}

type searchResult struct {
	ID             string  `gorm:"column:id" json:"id"`
	LibraryID      string  `gorm:"column:library_id" json:"libraryId"`
	LibraryName    string  `gorm:"column:library_name" json:"libraryName"`
	ParentFolderID *string `gorm:"column:parent_folder_id" json:"parentFolderId"`
	TargetFolderID *string `json:"targetFolderId"`
	Name           string  `gorm:"column:name" json:"name"`
	Kind           string  `gorm:"column:kind" json:"kind"`
	LocationPath   string  `json:"locationPath"`
	MimeType       *string `gorm:"column:mime_type" json:"mimeType,omitempty"`
	Size           *int64  `gorm:"column:size" json:"size,omitempty"`
	UpdatedAt      string  `gorm:"column:updated_at" json:"updatedAt"`
}

func (h *SearchHandler) Search(c echo.Context) error {
	userID, err := middleware.RequireUserID(c)
	if err != nil {
		return err
	}

	query := c.QueryParam("q")
	if query == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"query":      "",
			"totalCount": 0,
			"results":    []interface{}{},
		})
	}

	searchPattern := fmt.Sprintf("%%%s%%", query)

	// Search files across accessible libraries
	var fileResults []searchResult
	h.db.Raw(`
		SELECT f.id, f.library_id, l.name as library_name, f.parent_folder_id,
		       f.name, 'file' as kind, f.mime_type, f.size,
		       to_char(f.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
		FROM files f
		INNER JOIN libraries l ON l.id = f.library_id
		LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
		WHERE f.trashed_at IS NULL
		  AND f.source_file_id IS NULL
		  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
		  AND f.name ILIKE ?
		ORDER BY f.name ASC
		LIMIT 50
	`, userID, userID, searchPattern).Scan(&fileResults)

	// Search folders across accessible libraries
	var folderResults []searchResult
	h.db.Raw(`
		SELECT fo.id, fo.library_id, l.name as library_name, fo.parent_folder_id,
		       fo.name, 'folder' as kind, NULL as mime_type, NULL as size,
		       to_char(fo.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
		FROM folders fo
		INNER JOIN libraries l ON l.id = fo.library_id
		LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
		WHERE fo.trashed_at IS NULL
		  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
		  AND fo.name ILIKE ?
		ORDER BY fo.name ASC
		LIMIT 50
	`, userID, userID, searchPattern).Scan(&folderResults)

	// Combine results
	allResults := make([]searchResult, 0, len(fileResults)+len(folderResults))
	for _, r := range folderResults {
		r.TargetFolderID = &r.ID
		r.LocationPath = r.LibraryName
		allResults = append(allResults, r)
	}
	for _, r := range fileResults {
		r.LocationPath = r.LibraryName
		allResults = append(allResults, r)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"query":      query,
		"totalCount": len(allResults),
		"results":    allResults,
	})
}
