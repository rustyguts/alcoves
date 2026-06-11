package handlers

import (
	"fmt"
	"log"
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
	Width           *int     `gorm:"column:width" json:"width,omitempty"`
	Height          *int     `gorm:"column:height" json:"height,omitempty"`
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

	// Object-label matching is fuzzy: searching "birds" should match the
	// "bird" label and "planes" should match "airplane". We expand the query
	// into singular/plural variants, match each as a substring of the label,
	// AND match the label as a substring of the query (so "airplanes" finds
	// "airplane"). Conditions are OR'd into one clause reused by both object
	// queries below.
	labelClause, labelArgs := buildLabelMatchClause(query)

	// Search files across accessible libraries (by filename)
	var fileResults []searchResult
	if err := h.db.Raw(`
		SELECT f.id, f.library_id, l.name as library_name, f.parent_folder_id,
		       f.name, 'file' as kind, f.mime_type, f.size, f.thumbnail_file_id,
		       f.width, f.height,
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
	`, userID, userID, searchPattern).Scan(&fileResults).Error; err != nil {
		return internalError("Search failed", err)
	}

	// Search folders across accessible libraries
	var folderResults []searchResult
	if err := h.db.Raw(`
		SELECT fo.id, fo.library_id, l.name as library_name, fo.parent_folder_id,
		       fo.name, 'folder' as kind, NULL as mime_type, NULL as size, NULL as thumbnail_file_id,
		       NULL as width, NULL as height,
		       to_char(fo.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
		FROM folders fo
		INNER JOIN libraries l ON l.id = fo.library_id
		LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
		WHERE fo.trashed_at IS NULL
		  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
		  AND fo.name ILIKE ?
		ORDER BY fo.name ASC
		LIMIT 50
	`, userID, userID, searchPattern).Scan(&folderResults).Error; err != nil {
		return internalError("Search failed", err)
	}

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
		Width           *int    `gorm:"column:width"`
		Height          *int    `gorm:"column:height"`
		UpdatedAt       string  `gorm:"column:updated_at"`
		MatchedLabel    string  `gorm:"column:matched_label"`
	}
	var objectResults []objectMatch
	objectArgs := append([]interface{}{userID, userID}, labelArgs...)
	if err := h.db.Raw(fmt.Sprintf(`
		SELECT DISTINCT ON (f.id)
		       f.id, f.library_id, l.name as library_name, f.parent_folder_id,
		       f.name, 'file' as kind, f.mime_type, f.size, f.thumbnail_file_id,
		       f.width, f.height,
		       to_char(f.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
		       od.label as matched_label
		FROM files f
		INNER JOIN libraries l ON l.id = f.library_id
		INNER JOIN object_detections od ON od.file_id = f.id
		LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
		WHERE f.trashed_at IS NULL
		  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
		  AND %s
		ORDER BY f.id, od.confidence DESC
		LIMIT 50
	`, labelClause), objectArgs...).Scan(&objectResults).Error; err != nil {
		return internalError("Search failed", err)
	}

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
		allLabelArgs := append([]interface{}{fileIDs}, labelArgs...)
		if err := h.db.Raw(fmt.Sprintf(`
			SELECT DISTINCT file_id, label
			FROM object_detections
			WHERE file_id IN ?
			  AND %s
		`, labelClause), allLabelArgs...).Scan(&allLabels).Error; err != nil {
			log.Printf("search: failed to fetch matched labels: %v", err)
		} else {
			for _, row := range allLabels {
				fileLabels[row.FileID] = append(fileLabels[row.FileID], row.Label)
			}
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
			Width:           r.Width,
			Height:          r.Height,
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

// buildLabelMatchClause builds a parameterized SQL OR clause (and its args)
// for fuzzy-matching object-detection labels against a search query. Each
// expanded query term is matched as a substring of the label, and the label
// is also matched as a substring of the raw query so longer plurals like
// "airplanes" still find the "airplane" label.
func buildLabelMatchClause(query string) (string, []interface{}) {
	terms := expandSearchTerms(query)
	conds := make([]string, 0, len(terms)+1)
	args := make([]interface{}, 0, len(terms)+1)
	for _, t := range terms {
		conds = append(conds, "od.label ILIKE ?")
		args = append(args, "%"+t+"%")
	}
	// Label is a substring of the query (e.g. query "airplanes" → label "airplane").
	conds = append(conds, "? ILIKE '%' || od.label || '%'")
	args = append(args, query)
	return "(" + strings.Join(conds, " OR ") + ")", args
}

// expandSearchTerms returns the lowercased query plus singular/plural variants
// so that e.g. "birds" also matches "bird" and "berries" also matches "berry".
// Variants must be at least 2 characters to avoid runaway substring matches.
func expandSearchTerms(query string) []string {
	q := strings.ToLower(strings.TrimSpace(query))
	seen := map[string]bool{}
	var terms []string
	add := func(t string) {
		if len(t) >= 2 && !seen[t] {
			seen[t] = true
			terms = append(terms, t)
		}
	}
	add(q)
	switch {
	case strings.HasSuffix(q, "ies") && len(q) > 3:
		add(q[:len(q)-3] + "y") // berries → berry
		add(q[:len(q)-2])       // ...ies → ...ie fallback
	case strings.HasSuffix(q, "es") && len(q) > 2:
		add(q[:len(q)-2]) // boxes → box
		add(q[:len(q)-1]) // planes → plane
	case strings.HasSuffix(q, "s") && len(q) > 1:
		add(q[:len(q)-1]) // birds → bird
	default:
		add(q + "s") // bird → birds (label stored plural)
	}
	return terms
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
