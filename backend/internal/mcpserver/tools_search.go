package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// search mirrors the web app's cross-library search (handlers/search.go): it
// matches files + folders by name and files by detected object label, scoped to
// libraries the caller can access. The fuzzy label helpers below are kept in
// sync with the handler's expandSearchTerms / buildLabelMatchClause.

type searchInput struct {
	Query string `json:"query" jsonschema:"the text to search for; matched against file names, folder names, and detected object labels"`
	Limit int    `json:"limit,omitempty" jsonschema:"max results per source (1-50, default 50)"`
}

type searchHit struct {
	ID             string   `json:"id"`
	Kind           string   `json:"kind"` // "file" or "folder"
	Name           string   `json:"name"`
	LibraryID      string   `json:"libraryId"`
	LibraryName    string   `json:"libraryName"`
	ParentFolderID *string  `json:"parentFolderId,omitempty"`
	MimeType       *string  `json:"mimeType,omitempty"`
	Size           *int64   `json:"size,omitempty"`
	MatchReason    string   `json:"matchReason"` // "name", "object", or "name+object"
	MatchedLabels  []string `json:"matchedLabels,omitempty"`
}

type searchOutput struct {
	Query      string      `json:"query"`
	TotalCount int         `json:"totalCount"`
	Results    []searchHit `json:"results"`
}

func registerSearchTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "search",
		Description: "Search across every library you can access. Matches file names, folder names, and AI-detected object labels (e.g. \"dog\", \"car\", \"beach\"). Returns the library each result lives in. No library ID needed — results are automatically scoped to your access.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in searchInput) (*mcp.CallToolResult, searchOutput, error) {
		id, err := d.identity(ctx)
		if err != nil {
			return nil, searchOutput{}, err
		}
		userID := id.UserID()

		query := strings.TrimSpace(in.Query)
		if query == "" {
			return nil, searchOutput{Query: "", Results: []searchHit{}}, nil
		}
		limit := in.Limit
		if limit <= 0 || limit > 50 {
			limit = 50
		}
		pattern := "%" + query + "%"

		type row struct {
			ID             string  `gorm:"column:id"`
			LibraryID      string  `gorm:"column:library_id"`
			LibraryName    string  `gorm:"column:library_name"`
			ParentFolderID *string `gorm:"column:parent_folder_id"`
			Name           string  `gorm:"column:name"`
			Kind           string  `gorm:"column:kind"`
			MimeType       *string `gorm:"column:mime_type"`
			Size           *int64  `gorm:"column:size"`
		}

		// Files by name.
		var fileRows []row
		if err := d.DB.Raw(`
			SELECT f.id, f.library_id, l.name as library_name, f.parent_folder_id,
			       f.name, 'file' as kind, f.mime_type, f.size
			FROM files f
			INNER JOIN libraries l ON l.id = f.library_id
			LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
			WHERE f.trashed_at IS NULL AND f.source_file_id IS NULL
			  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
			  AND f.name ILIKE ?
			ORDER BY f.name ASC
			LIMIT ?
		`, userID, userID, pattern, limit).Scan(&fileRows).Error; err != nil {
			return nil, searchOutput{}, fmt.Errorf("search failed")
		}

		// Folders by name.
		var folderRows []row
		if err := d.DB.Raw(`
			SELECT fo.id, fo.library_id, l.name as library_name, fo.parent_folder_id,
			       fo.name, 'folder' as kind, NULL as mime_type, NULL as size
			FROM folders fo
			INNER JOIN libraries l ON l.id = fo.library_id
			LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
			WHERE fo.trashed_at IS NULL
			  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
			  AND fo.name ILIKE ?
			ORDER BY fo.name ASC
			LIMIT ?
		`, userID, userID, pattern, limit).Scan(&folderRows).Error; err != nil {
			return nil, searchOutput{}, fmt.Errorf("search failed")
		}

		// Files by detected object label (fuzzy singular/plural matching).
		labelClause, labelArgs := buildMCPLabelMatchClause(query)
		// Flat row (not an embedded struct): GORM's raw Scan does not reliably
		// populate promoted fields of an anonymous embedded struct.
		type objRow struct {
			ID             string  `gorm:"column:id"`
			LibraryID      string  `gorm:"column:library_id"`
			LibraryName    string  `gorm:"column:library_name"`
			ParentFolderID *string `gorm:"column:parent_folder_id"`
			Name           string  `gorm:"column:name"`
			MimeType       *string `gorm:"column:mime_type"`
			Size           *int64  `gorm:"column:size"`
			MatchedLabel   string  `gorm:"column:matched_label"`
		}
		var objRows []objRow
		objArgs := append([]any{userID, userID}, labelArgs...)
		objArgs = append(objArgs, limit)
		if err := d.DB.Raw(fmt.Sprintf(`
			SELECT DISTINCT ON (f.id)
			       f.id, f.library_id, l.name as library_name, f.parent_folder_id,
			       f.name, 'file' as kind, f.mime_type, f.size, od.label as matched_label
			FROM files f
			INNER JOIN libraries l ON l.id = f.library_id
			INNER JOIN object_detections od ON od.file_id = f.id
			LEFT JOIN library_members lm ON lm.library_id = l.id AND lm.user_id = ?
			WHERE f.trashed_at IS NULL
			  AND (l.owner_id = ? OR lm.user_id IS NOT NULL)
			  AND %s
			ORDER BY f.id, od.confidence DESC
			LIMIT ?
		`, labelClause), objArgs...).Scan(&objRows).Error; err != nil {
			return nil, searchOutput{}, fmt.Errorf("search failed")
		}

		nameMatched := map[string]bool{}
		results := make([]searchHit, 0, len(fileRows)+len(folderRows)+len(objRows))
		for _, r := range folderRows {
			results = append(results, searchHit{
				ID: r.ID, Kind: "folder", Name: r.Name, LibraryID: r.LibraryID,
				LibraryName: r.LibraryName, ParentFolderID: r.ParentFolderID, MatchReason: "name",
			})
		}
		for _, r := range fileRows {
			nameMatched[r.ID] = true
			results = append(results, searchHit{
				ID: r.ID, Kind: "file", Name: r.Name, LibraryID: r.LibraryID,
				LibraryName: r.LibraryName, ParentFolderID: r.ParentFolderID,
				MimeType: r.MimeType, Size: r.Size, MatchReason: "name",
			})
		}
		for _, r := range objRows {
			if nameMatched[r.ID] {
				// Annotate the existing name match instead of duplicating.
				for i := range results {
					if results[i].ID == r.ID && results[i].Kind == "file" {
						results[i].MatchReason = "name+object"
						results[i].MatchedLabels = []string{r.MatchedLabel}
					}
				}
				continue
			}
			results = append(results, searchHit{
				ID: r.ID, Kind: "file", Name: r.Name, LibraryID: r.LibraryID,
				LibraryName: r.LibraryName, ParentFolderID: r.ParentFolderID,
				MimeType: r.MimeType, Size: r.Size, MatchReason: "object",
				MatchedLabels: []string{r.MatchedLabel},
			})
		}

		return nil, searchOutput{Query: query, TotalCount: len(results), Results: results}, nil
	})
}

// buildMCPLabelMatchClause mirrors handlers.buildLabelMatchClause: a
// parameterized OR clause fuzzy-matching object-detection labels against the
// query (each expanded term as a substring of the label, plus the label as a
// substring of the raw query so "airplanes" still finds "airplane").
func buildMCPLabelMatchClause(query string) (string, []any) {
	terms := expandMCPSearchTerms(query)
	conds := make([]string, 0, len(terms)+1)
	args := make([]any, 0, len(terms)+1)
	for _, t := range terms {
		conds = append(conds, "od.label ILIKE ?")
		args = append(args, "%"+t+"%")
	}
	conds = append(conds, "? ILIKE '%' || od.label || '%'")
	args = append(args, query)
	return "(" + strings.Join(conds, " OR ") + ")", args
}

// expandMCPSearchTerms mirrors handlers.expandSearchTerms: the lowercased query
// plus singular/plural variants (min length 2) so e.g. "birds"→"bird".
func expandMCPSearchTerms(query string) []string {
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
		add(q[:len(q)-3] + "y")
		add(q[:len(q)-2])
	case strings.HasSuffix(q, "es") && len(q) > 2:
		add(q[:len(q)-2])
		add(q[:len(q)-1])
	case strings.HasSuffix(q, "s") && len(q) > 1:
		add(q[:len(q)-1])
	default:
		add(q + "s")
	}
	return terms
}
