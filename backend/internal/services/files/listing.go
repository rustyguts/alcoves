package files

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// CursorPayload matches the TypeScript cursor format exactly.
type CursorPayload struct {
	KindRank int    `json:"kindRank"`
	SortName string `json:"sortName"`
	ID       string `json:"id"`
}

// TagResponse matches LibraryTag from the API types.
type TagResponse struct {
	ID        string `json:"id"`
	LibraryID string `json:"libraryId"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// OwnerSummary matches LibraryUserSummary.
type OwnerSummary struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarUrl   *string `json:"avatarUrl"`
}

// FileResponse matches LibraryFile.
type FileResponse struct {
	ID                string        `json:"id"`
	LibraryID         string        `json:"libraryId"`
	ParentFolderID    *string       `json:"parentFolderId"`
	Name              string        `json:"name"`
	Kind              string        `json:"kind"`
	MimeType          string        `json:"mimeType"`
	Size              int64         `json:"size"`
	Duration          *int          `json:"duration"`
	Width             *int          `json:"width"`
	Height            *int          `json:"height"`
	ProxyStatus       *string       `json:"proxyStatus"`
	ProxyProgress     *int          `json:"proxyProgress"`
	ProxyEtaSeconds   *int          `json:"proxyEtaSeconds"`
	ThumbnailFileID   *string       `json:"thumbnailFileId"`
	SourceFileID      *string       `json:"sourceFileId"`
	OriginalCreatedAt *string       `json:"originalCreatedAt"`
	TrashedAt         *string       `json:"trashedAt"`
	CreatedAt         string        `json:"createdAt"`
	UpdatedAt         string        `json:"updatedAt"`
	Owner             *OwnerSummary `json:"owner"`
	Tags              []TagResponse `json:"tags"`
}

// FolderResponse matches LibraryFolder.
type FolderResponse struct {
	ID             string        `json:"id"`
	LibraryID      string        `json:"libraryId"`
	ParentFolderID *string       `json:"parentFolderId"`
	Name           string        `json:"name"`
	Kind           string        `json:"kind"`
	TrashedAt      *string       `json:"trashedAt"`
	TrashFileCount *int          `json:"trashFileCount,omitempty"`
	CreatedAt      string        `json:"createdAt"`
	UpdatedAt      string        `json:"updatedAt"`
	Owner          *OwnerSummary `json:"owner"`
	Tags           []TagResponse `json:"tags"`
}

type FolderBreadcrumb struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type PaginatedFiles struct {
	Entries         []interface{}      `json:"entries"`
	NextCursor      *string            `json:"nextCursor"`
	TotalCount      int                `json:"totalCount"`
	Breadcrumbs     []FolderBreadcrumb `json:"breadcrumbs"`
	CurrentFolderID *string            `json:"currentFolderId"`
}

// listingRow is the internal union type for sorting folders and files together.
type listingRow struct {
	ID                string
	LibraryID         string
	ParentFolderID    *string
	OwnerID           *string
	Name              string
	Kind              string // "folder" or "file"
	KindRank          int    // 0=folder, 1=file
	SortName          string // lower(name)
	MimeType          *string
	Size              *int64
	Duration          *int
	Width             *int
	Height            *int
	ProxyStatus       *string
	ProxyProgress     *int
	ProxyEtaSeconds   *int
	ThumbnailFileID   *string
	SourceFileID      *string
	OriginalCreatedAt *time.Time
	TrashedAt         *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func (s *Service) ListLibraryFiles(libraryID string, c echo.Context) (*PaginatedFiles, error) {
	showTrashed := c.QueryParam("trashed") == "true"
	limit := parseLimit(c.QueryParam("limit"))
	requestedFolderID := normalizeFolderID(c.QueryParam("folder"))

	var currentFolderID *string
	if !showTrashed {
		currentFolderID = requestedFolderID
	}

	// Get breadcrumbs
	var breadcrumbs []FolderBreadcrumb
	if !showTrashed && currentFolderID != nil {
		var err error
		breadcrumbs, err = s.getFolderBreadcrumbs(libraryID, *currentFolderID)
		if err != nil {
			return nil, err
		}
	}
	if breadcrumbs == nil {
		breadcrumbs = []FolderBreadcrumb{}
	}

	// Parse cursor
	cursor, err := parseCursor(c.QueryParam("cursor"))
	if err != nil {
		return nil, err
	}

	// Build folder query
	folderQuery, folderCountQuery := s.buildFolderQueries(libraryID, showTrashed, currentFolderID, cursor, limit)

	// Build file query
	fileQuery, fileCountQuery := s.buildFileQueries(libraryID, showTrashed, currentFolderID, cursor, limit)

	// Execute counts
	var folderCount, fileCount int
	s.db.Raw(folderCountQuery).Scan(&folderCount)
	s.db.Raw(fileCountQuery).Scan(&fileCount)
	totalCount := folderCount + fileCount

	// Execute listing queries
	var folderRows, fileRows []listingRow
	s.db.Raw(folderQuery).Scan(&folderRows)
	s.db.Raw(fileQuery).Scan(&fileRows)

	// Merge and sort: folders first (kindRank=0), then files (kindRank=1), both by name ASC
	combined := append(folderRows, fileRows...)
	sort.Slice(combined, func(i, j int) bool {
		if combined[i].KindRank != combined[j].KindRank {
			return combined[i].KindRank < combined[j].KindRank
		}
		if combined[i].SortName != combined[j].SortName {
			return combined[i].SortName < combined[j].SortName
		}
		return combined[i].ID < combined[j].ID
	})

	hasMore := len(combined) > limit
	if hasMore {
		combined = combined[:limit]
	}

	// Collect IDs for batch loading tags and owners
	var fileIDs, folderIDs []string
	ownerIDSet := map[string]bool{}
	for _, row := range combined {
		if row.Kind == "file" {
			fileIDs = append(fileIDs, row.ID)
		} else {
			folderIDs = append(folderIDs, row.ID)
		}
		if row.OwnerID != nil {
			ownerIDSet[*row.OwnerID] = true
		}
	}

	// Load tags for files
	tagsByFileID := s.loadFileTags(fileIDs)
	tagsByFolderID := s.loadFolderTags(folderIDs)

	// Load owners
	ownerIDs := make([]string, 0, len(ownerIDSet))
	for id := range ownerIDSet {
		ownerIDs = append(ownerIDs, id)
	}
	ownersByID := s.loadOwners(ownerIDs)

	// Load trash file counts for folders (only in trash view)
	var trashedFolderFileCounts map[string]int
	if showTrashed && len(folderIDs) > 0 {
		trashedFolderFileCounts = s.getTrashedFolderFileCounts(libraryID, folderIDs)
	}

	// Build response entries
	entries := make([]interface{}, len(combined))
	for i, row := range combined {
		if row.Kind == "folder" {
			tags := tagsByFolderID[row.ID]
			if tags == nil {
				tags = []TagResponse{}
			}
			sortTags(tags)

			var owner *OwnerSummary
			if row.OwnerID != nil {
				if o, ok := ownersByID[*row.OwnerID]; ok {
					owner = &o
				}
			}

			resp := FolderResponse{
				ID:             row.ID,
				LibraryID:      row.LibraryID,
				ParentFolderID: row.ParentFolderID,
				Name:           row.Name,
				Kind:           "folder",
				TrashedAt:      timePtr(row.TrashedAt),
				CreatedAt:      row.CreatedAt.Format(time.RFC3339Nano),
				UpdatedAt:      row.UpdatedAt.Format(time.RFC3339Nano),
				Owner:          owner,
				Tags:           tags,
			}
			if showTrashed {
				count := trashedFolderFileCounts[row.ID]
				resp.TrashFileCount = &count
			}
			entries[i] = resp
		} else {
			tags := tagsByFileID[row.ID]
			if tags == nil {
				tags = []TagResponse{}
			}
			sortTags(tags)

			var owner *OwnerSummary
			if row.OwnerID != nil {
				if o, ok := ownersByID[*row.OwnerID]; ok {
					owner = &o
				}
			}

			mimeType := "application/octet-stream"
			if row.MimeType != nil {
				mimeType = *row.MimeType
			}
			var size int64
			if row.Size != nil {
				size = *row.Size
			}

			entries[i] = FileResponse{
				ID:                row.ID,
				LibraryID:         row.LibraryID,
				ParentFolderID:    row.ParentFolderID,
				Name:              row.Name,
				Kind:              "file",
				MimeType:          mimeType,
				Size:              size,
				Duration:          row.Duration,
				Width:             row.Width,
				Height:            row.Height,
				ProxyStatus:       row.ProxyStatus,
				ProxyProgress:     row.ProxyProgress,
				ProxyEtaSeconds:   row.ProxyEtaSeconds,
				ThumbnailFileID:   row.ThumbnailFileID,
				SourceFileID:      row.SourceFileID,
				OriginalCreatedAt: timePtr(row.OriginalCreatedAt),
				TrashedAt:         timePtr(row.TrashedAt),
				CreatedAt:         row.CreatedAt.Format(time.RFC3339Nano),
				UpdatedAt:         row.UpdatedAt.Format(time.RFC3339Nano),
				Owner:             owner,
				Tags:              tags,
			}
		}
	}

	// Build next cursor
	var nextCursor *string
	if hasMore && len(combined) > 0 {
		last := combined[len(combined)-1]
		payload := CursorPayload{
			KindRank: last.KindRank,
			SortName: last.SortName,
			ID:       last.ID,
		}
		data, _ := json.Marshal(payload)
		encoded := base64.StdEncoding.EncodeToString(data)
		nextCursor = &encoded
	}

	return &PaginatedFiles{
		Entries:         entries,
		NextCursor:      nextCursor,
		TotalCount:      totalCount,
		Breadcrumbs:     breadcrumbs,
		CurrentFolderID: currentFolderID,
	}, nil
}

func (s *Service) buildFolderQueries(libraryID string, showTrashed bool, currentFolderID *string, cursor *CursorPayload, limit int) (string, string) {
	var where string
	if showTrashed {
		where = fmt.Sprintf(
			"library_id = '%s' AND trashed_at IS NOT NULL AND (parent_folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM folders pf WHERE pf.id = folders.parent_folder_id AND pf.trashed_at IS NOT NULL))",
			libraryID,
		)
	} else if currentFolderID != nil {
		where = fmt.Sprintf("library_id = '%s' AND trashed_at IS NULL AND parent_folder_id = '%s'", libraryID, *currentFolderID)
	} else {
		where = fmt.Sprintf("library_id = '%s' AND trashed_at IS NULL AND parent_folder_id IS NULL", libraryID)
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM folders WHERE %s", where)

	// Add cursor condition
	cursorWhere := ""
	if cursor != nil {
		if cursor.KindRank == 0 {
			cursorWhere = fmt.Sprintf(
				" AND (lower(name) > '%s' OR (lower(name) = '%s' AND id > '%s'))",
				escapeSQLString(cursor.SortName), escapeSQLString(cursor.SortName), escapeSQLString(cursor.ID),
			)
		} else {
			// Cursor is past all folders
			cursorWhere = " AND false"
		}
	}

	query := fmt.Sprintf(
		`SELECT id, library_id, parent_folder_id, owner_id, name,
		'folder' as kind, 0 as kind_rank, lower(name) as sort_name,
		NULL as mime_type, NULL as size, NULL as duration, NULL as width, NULL as height,
		NULL as proxy_status, NULL as proxy_progress, NULL as proxy_eta_seconds,
		NULL as thumbnail_file_id,
		NULL as source_file_id, NULL as original_created_at,
		trashed_at, created_at, updated_at
		FROM folders WHERE %s%s
		ORDER BY lower(name) ASC, id ASC LIMIT %d`,
		where, cursorWhere, limit+1,
	)

	return query, countQuery
}

func (s *Service) buildFileQueries(libraryID string, showTrashed bool, currentFolderID *string, cursor *CursorPayload, limit int) (string, string) {
	var where string
	if showTrashed {
		where = fmt.Sprintf(
			"library_id = '%s' AND source_file_id IS NULL AND trashed_at IS NOT NULL AND (parent_folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM folders tp WHERE tp.id = files.parent_folder_id AND tp.trashed_at IS NOT NULL))",
			libraryID,
		)
	} else if currentFolderID != nil {
		where = fmt.Sprintf("library_id = '%s' AND source_file_id IS NULL AND trashed_at IS NULL AND parent_folder_id = '%s'", libraryID, *currentFolderID)
	} else {
		where = fmt.Sprintf("library_id = '%s' AND source_file_id IS NULL AND trashed_at IS NULL AND parent_folder_id IS NULL", libraryID)
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM files WHERE %s", where)

	cursorWhere := ""
	if cursor != nil {
		if cursor.KindRank == 0 {
			// Cursor is still in folders — include all files
			cursorWhere = ""
		} else {
			cursorWhere = fmt.Sprintf(
				" AND (lower(name) > '%s' OR (lower(name) = '%s' AND id > '%s'))",
				escapeSQLString(cursor.SortName), escapeSQLString(cursor.SortName), escapeSQLString(cursor.ID),
			)
		}
	}

	query := fmt.Sprintf(
		`SELECT id, library_id, parent_folder_id, owner_id, name,
		'file' as kind, 1 as kind_rank, lower(name) as sort_name,
		mime_type, size, duration, width, height,
		proxy_status, proxy_progress, proxy_eta_seconds, thumbnail_file_id,
		source_file_id, original_created_at,
		trashed_at, created_at, updated_at
		FROM files WHERE %s%s
		ORDER BY lower(name) ASC, id ASC LIMIT %d`,
		where, cursorWhere, limit+1,
	)

	return query, countQuery
}

func (s *Service) getFolderBreadcrumbs(libraryID, folderID string) ([]FolderBreadcrumb, error) {
	var breadcrumbs []FolderBreadcrumb
	visited := map[string]bool{}
	currentID := folderID

	for currentID != "" {
		if visited[currentID] {
			return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid folder hierarchy")
		}
		visited[currentID] = true

		var folder struct {
			ID             string  `gorm:"column:id"`
			Name           string  `gorm:"column:name"`
			ParentFolderID *string `gorm:"column:parent_folder_id"`
		}
		err := s.db.Raw(
			"SELECT id, name, parent_folder_id FROM folders WHERE id = ? AND library_id = ? AND trashed_at IS NULL",
			currentID, libraryID,
		).Scan(&folder).Error
		if err != nil || folder.ID == "" {
			return nil, echo.NewHTTPError(http.StatusNotFound, "Folder not found")
		}

		breadcrumbs = append(breadcrumbs, FolderBreadcrumb{ID: folder.ID, Name: folder.Name})
		if folder.ParentFolderID != nil {
			currentID = *folder.ParentFolderID
		} else {
			currentID = ""
		}
	}

	// Reverse
	for i, j := 0, len(breadcrumbs)-1; i < j; i, j = i+1, j-1 {
		breadcrumbs[i], breadcrumbs[j] = breadcrumbs[j], breadcrumbs[i]
	}
	return breadcrumbs, nil
}

type fileTagRow struct {
	FileID    string    `gorm:"column:file_id"`
	ID        string    `gorm:"column:id"`
	LibraryID string    `gorm:"column:library_id"`
	Name      string    `gorm:"column:name"`
	Color     string    `gorm:"column:color"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (s *Service) loadFileTags(fileIDs []string) map[string][]TagResponse {
	result := map[string][]TagResponse{}
	if len(fileIDs) == 0 {
		return result
	}

	var rows []fileTagRow
	s.db.Raw(
		"SELECT ft.file_id, t.id, t.library_id, t.name, t.color, t.created_at, t.updated_at FROM file_tags ft INNER JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id IN ?",
		fileIDs,
	).Scan(&rows)

	for _, row := range rows {
		result[row.FileID] = append(result[row.FileID], TagResponse{
			ID:        row.ID,
			LibraryID: row.LibraryID,
			Name:      row.Name,
			Color:     row.Color,
			CreatedAt: row.CreatedAt.Format(time.RFC3339Nano),
			UpdatedAt: row.UpdatedAt.Format(time.RFC3339Nano),
		})
	}
	return result
}

type folderTagRow struct {
	FolderID  string    `gorm:"column:folder_id"`
	ID        string    `gorm:"column:id"`
	LibraryID string    `gorm:"column:library_id"`
	Name      string    `gorm:"column:name"`
	Color     string    `gorm:"column:color"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (s *Service) loadFolderTags(folderIDs []string) map[string][]TagResponse {
	result := map[string][]TagResponse{}
	if len(folderIDs) == 0 {
		return result
	}

	var rows []folderTagRow
	s.db.Raw(
		"SELECT ft.folder_id, t.id, t.library_id, t.name, t.color, t.created_at, t.updated_at FROM folder_tags ft INNER JOIN tags t ON t.id = ft.tag_id WHERE ft.folder_id IN ?",
		folderIDs,
	).Scan(&rows)

	for _, row := range rows {
		result[row.FolderID] = append(result[row.FolderID], TagResponse{
			ID:        row.ID,
			LibraryID: row.LibraryID,
			Name:      row.Name,
			Color:     row.Color,
			CreatedAt: row.CreatedAt.Format(time.RFC3339Nano),
			UpdatedAt: row.UpdatedAt.Format(time.RFC3339Nano),
		})
	}
	return result
}

func (s *Service) loadOwners(ownerIDs []string) map[string]OwnerSummary {
	result := map[string]OwnerSummary{}
	if len(ownerIDs) == 0 {
		return result
	}

	type ownerRow struct {
		ID          string  `gorm:"column:id"`
		DisplayName string  `gorm:"column:display_name"`
		AvatarUrl   *string `gorm:"column:avatar_url"`
	}

	var rows []ownerRow
	s.db.Raw("SELECT id, display_name, avatar_url FROM users WHERE id IN ?", ownerIDs).Scan(&rows)

	for _, row := range rows {
		result[row.ID] = OwnerSummary{
			ID:          row.ID,
			DisplayName: row.DisplayName,
			AvatarUrl:   row.AvatarUrl,
		}
	}
	return result
}

func (s *Service) getTrashedFolderFileCounts(libraryID string, folderIDs []string) map[string]int {
	counts := map[string]int{}
	if len(folderIDs) == 0 {
		return counts
	}

	// Load all folders in library to build tree
	type folderNode struct {
		ID             string  `gorm:"column:id"`
		ParentFolderID *string `gorm:"column:parent_folder_id"`
	}
	var allFolders []folderNode
	s.db.Raw("SELECT id, parent_folder_id FROM folders WHERE library_id = ?", libraryID).Scan(&allFolders)

	childrenByParent := map[string][]string{}
	for _, f := range allFolders {
		if f.ParentFolderID != nil {
			childrenByParent[*f.ParentFolderID] = append(childrenByParent[*f.ParentFolderID], f.ID)
		}
	}

	// For each root folder, collect subtree
	allSubtreeIDs := map[string]bool{}
	subtreeByRoot := map[string][]string{}

	for _, rootID := range folderIDs {
		var subtree []string
		visited := map[string]bool{}
		stack := []string{rootID}

		for len(stack) > 0 {
			fid := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if visited[fid] {
				continue
			}
			visited[fid] = true
			subtree = append(subtree, fid)
			allSubtreeIDs[fid] = true
			stack = append(stack, childrenByParent[fid]...)
		}
		subtreeByRoot[rootID] = subtree
	}

	if len(allSubtreeIDs) == 0 {
		return counts
	}

	// Count files grouped by parent_folder_id
	ids := make([]string, 0, len(allSubtreeIDs))
	for id := range allSubtreeIDs {
		ids = append(ids, id)
	}

	type countRow struct {
		ParentFolderID string `gorm:"column:parent_folder_id"`
		Count          int    `gorm:"column:count"`
	}
	var countRows []countRow
	s.db.Raw(
		"SELECT parent_folder_id, COUNT(*) as count FROM files WHERE library_id = ? AND trashed_at IS NOT NULL AND parent_folder_id IN ? GROUP BY parent_folder_id",
		libraryID, ids,
	).Scan(&countRows)

	countByFolder := map[string]int{}
	for _, row := range countRows {
		countByFolder[row.ParentFolderID] = row.Count
	}

	for _, rootID := range folderIDs {
		total := 0
		for _, fid := range subtreeByRoot[rootID] {
			total += countByFolder[fid]
		}
		counts[rootID] = total
	}

	return counts
}

func parseCursor(cursorStr string) (*CursorPayload, error) {
	if cursorStr == "" {
		return nil, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(cursorStr)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}

	var payload CursorPayload
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}

	if payload.KindRank != 0 && payload.KindRank != 1 {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}

	// Validate ID is a UUID
	if _, err := uuid.Parse(payload.ID); err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}

	return &payload, nil
}

func parseLimit(s string) int {
	if s == "" {
		return DefaultLimit
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return DefaultLimit
	}
	return int(math.Min(math.Max(float64(n), 1), MaxLimit))
}

func normalizeFolderID(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" {
		return nil
	}
	return &s
}

func timePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339Nano)
	return &s
}

func sortTags(tags []TagResponse) {
	sort.Slice(tags, func(i, j int) bool {
		return tags[i].Name < tags[j].Name
	})
}

func escapeSQLString(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}
