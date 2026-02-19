package handlers

import (
	"fmt"
	"net/http"
	"strings"

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
	ID             string   `gorm:"column:id" json:"id"`
	LibraryID      string   `gorm:"column:library_id" json:"libraryId"`
	LibraryName    string   `gorm:"column:library_name" json:"libraryName"`
	ParentFolderID *string  `gorm:"column:parent_folder_id" json:"parentFolderId"`
	TargetFolderID *string  `json:"targetFolderId"`
	Name           string   `gorm:"column:name" json:"name"`
	Kind           string   `gorm:"column:kind" json:"kind"`
	LocationPath   string   `json:"locationPath"`
	MimeType        *string  `gorm:"column:mime_type" json:"mimeType,omitempty"`
	Size            *int64   `gorm:"column:size" json:"size,omitempty"`
	ThumbnailFileID *string  `gorm:"column:thumbnail_file_id" json:"thumbnailFileId,omitempty"`
	UpdatedAt       string   `gorm:"column:updated_at" json:"updatedAt"`
	MatchReason    string   `gorm:"-" json:"matchReason,omitempty"`
	MatchedLabels  []string `gorm:"-" json:"matchedLabels,omitempty"`
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

	// Search files across accessible libraries (by filename)
	var fileResults []searchResult
	h.db.Raw(`
		SELECT f.id, f.library_id, l.name as library_name, f.parent_folder_id,
		       f.name, 'file' as kind, f.mime_type, f.size, f.thumbnail_file_id,
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

	// Search files by detected object labels
	type objectMatch struct {
		ID              string  `gorm:"column:id"`
		LibraryID       string  `gorm:"column:library_id"`
		LibraryName     string  `gorm:"column:library_name"`
		ParentFolderID  *string `gorm:"column:parent_folder_id"`
		Name            string  `gorm:"column:name"`
		Kind            string  `gorm:"column:kind"`
		MimeType        *string `gorm:"column:mime_type"`
		Size            *int64  `gorm:"column:size"`
		ThumbnailFileID *string `gorm:"column:thumbnail_file_id"`
		UpdatedAt       string  `gorm:"column:updated_at"`
		MatchedLabel    string  `gorm:"column:matched_label"`
	}
	var objectResults []objectMatch
	h.db.Raw(`
		SELECT DISTINCT ON (f.id)
		       f.id, f.library_id, l.name as library_name, f.parent_folder_id,
		       f.name, 'file' as kind, f.mime_type, f.size, f.thumbnail_file_id,
		       to_char(f.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
		       od.label as matched_label
		FROM files f
		INNER JOIN libraries l ON l.id = f.library_id
		INNER JOIN object_detections od ON od.file_id = f.id
		LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
		WHERE f.trashed_at IS NULL
		  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
		  AND od.label ILIKE ?
		ORDER BY f.id, od.confidence DESC
		LIMIT 50
	`, userID, userID, searchPattern).Scan(&objectResults)

	// Collect all matched labels per file (a file may match multiple labels)
	fileLabels := map[string][]string{}
	if len(objectResults) > 0 {
		// Run a second query to get all matching labels per file
		fileIDs := make([]string, len(objectResults))
		for i, r := range objectResults {
			fileIDs[i] = r.ID
		}
		type labelRow struct {
			FileID string `gorm:"column:file_id"`
			Label  string `gorm:"column:label"`
		}
		var allLabels []labelRow
		h.db.Raw(`
			SELECT DISTINCT file_id, label
			FROM object_detections
			WHERE file_id IN ?
			  AND label ILIKE ?
		`, fileIDs, searchPattern).Scan(&allLabels)
		for _, row := range allLabels {
			fileLabels[row.FileID] = append(fileLabels[row.FileID], row.Label)
		}
	}

	// Build a set of file IDs already found by filename search
	fileNameMatchIDs := map[string]bool{}
	for _, r := range fileResults {
		fileNameMatchIDs[r.ID] = true
	}

	// Combine results: folders first, then files by name, then object matches (deduped)
	allResults := make([]searchResult, 0, len(fileResults)+len(folderResults)+len(objectResults))

	for _, r := range folderResults {
		r.TargetFolderID = &r.ID
		r.LocationPath = r.LibraryName
		r.MatchReason = "name"
		allResults = append(allResults, r)
	}
	for _, r := range fileResults {
		r.LocationPath = r.LibraryName
		r.MatchReason = "name"
		// If this file also matched by object labels, annotate it
		if labels, ok := fileLabels[r.ID]; ok {
			r.MatchReason = "name+object"
			r.MatchedLabels = dedup(labels)
		}
		allResults = append(allResults, r)
	}
	for _, r := range objectResults {
		// Skip files already included from filename search
		if fileNameMatchIDs[r.ID] {
			continue
		}
		result := searchResult{
			ID:              r.ID,
			LibraryID:       r.LibraryID,
			LibraryName:     r.LibraryName,
			ParentFolderID:  r.ParentFolderID,
			Name:            r.Name,
			Kind:            r.Kind,
			MimeType:        r.MimeType,
			Size:            r.Size,
			ThumbnailFileID: r.ThumbnailFileID,
			UpdatedAt:       r.UpdatedAt,
			LocationPath:    r.LibraryName,
			MatchReason:     "object",
			MatchedLabels:   dedup(fileLabels[r.ID]),
		}
		if len(result.MatchedLabels) == 0 {
			result.MatchedLabels = []string{r.MatchedLabel}
		}
		allResults = append(allResults, result)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"query":      query,
		"totalCount": len(allResults),
		"results":    allResults,
	})
}

// dedup returns unique strings from a slice, preserving order.
func dedup(items []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(items))
	for _, item := range items {
		lower := strings.ToLower(item)
		if !seen[lower] {
			seen[lower] = true
			result = append(result, item)
		}
	}
	return result
}
