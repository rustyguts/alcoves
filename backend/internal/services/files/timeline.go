package files

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// MapPointLimit caps how many geotagged points the map endpoint returns. Beyond
// this the response is marked truncated and the client is expected to cluster /
// warn. Server-side clustering is a future enhancement.
const MapPointLimit = 5000

// TimelineCursorPayload is the base64-JSON keyset cursor for the timeline. It
// pages on the effective capture date then the id, both DESC.
type TimelineCursorPayload struct {
	CapturedAt string `json:"capturedAt"` // RFC3339Nano of effective_captured_at
	ID         string `json:"id"`
}

type timelineCursor struct {
	capturedAt time.Time
	id         string
}

// timelineRow carries the file columns plus extracted metadata and the computed
// effective capture date used for ordering.
type timelineRow struct {
	ID                  string
	LibraryID           string
	ParentFolderID      *string
	OwnerID             *string
	Name                string
	MimeType            *string
	Size                *int64
	Duration            *int
	Width               *int
	Height              *int
	ProxyStatus         *string
	ProxyProgress       *int
	ProxyEtaSeconds     *int
	ThumbnailFileID     *string
	SourceFileID        *string
	OriginalCreatedAt   *time.Time
	Hash                *string
	CapturedAt          *time.Time
	GpsLat              *float64
	GpsLon              *float64
	EffectiveCapturedAt time.Time
	TrashedAt           *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// ListLibraryTimeline returns library files (no folders) flattened and sorted
// newest-first by effective capture date — COALESCE(captured_at,
// original_created_at, created_at). type=media (default) limits to images +
// videos; type=all includes every file. Cursor-paginated via keyset.
func (s *Service) ListLibraryTimeline(libraryID string, c echo.Context) (*PaginatedFiles, error) {
	limit := parseLimit(c.QueryParam("limit"))
	mediaOnly := c.QueryParam("type") != "all"

	cursor, err := parseTimelineCursor(c.QueryParam("cursor"))
	if err != nil {
		return nil, err
	}

	where := "library_id = ? AND trashed_at IS NULL AND source_file_id IS NULL"
	args := []interface{}{libraryID}
	if mediaOnly {
		where += " AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')"
	}
	if cursor != nil {
		// Keyset predicate must repeat the COALESCE expression — Postgres can't
		// reference the SELECT alias in WHERE. Parameterized, never interpolated.
		where += " AND (COALESCE(captured_at, original_created_at, created_at) < ?" +
			" OR (COALESCE(captured_at, original_created_at, created_at) = ? AND id < ?))"
		args = append(args, cursor.capturedAt, cursor.capturedAt, cursor.id)
	}

	listQuery := `SELECT id, library_id, parent_folder_id, owner_id, name,
		mime_type, size, duration, width, height,
		proxy_status, proxy_progress, proxy_eta_seconds, thumbnail_file_id,
		source_file_id, original_created_at, hash,
		captured_at, gps_lat, gps_lon,
		COALESCE(captured_at, original_created_at, created_at) AS effective_captured_at,
		trashed_at, created_at, updated_at
		FROM files WHERE ` + where + `
		ORDER BY effective_captured_at DESC, id DESC LIMIT ?`

	listArgs := append(append([]interface{}{}, args...), limit+1)

	var rows []timelineRow
	if err := s.db.Raw(listQuery, listArgs...).Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Total count uses the same filter sans cursor.
	countQuery := "SELECT COUNT(*) FROM files WHERE library_id = ? AND trashed_at IS NULL AND source_file_id IS NULL"
	countArgs := []interface{}{libraryID}
	if mediaOnly {
		countQuery += " AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')"
	}
	var totalCount int
	s.db.Raw(countQuery, countArgs...).Scan(&totalCount)

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	// Batch-load tags / owners / duplicate flags (reuse the listing loaders).
	fileIDs := make([]string, 0, len(rows))
	ownerIDSet := map[string]bool{}
	for _, r := range rows {
		fileIDs = append(fileIDs, r.ID)
		if r.OwnerID != nil {
			ownerIDSet[*r.OwnerID] = true
		}
	}
	tagsByFileID := s.loadFileTags(fileIDs)
	ownerIDs := make([]string, 0, len(ownerIDSet))
	for id := range ownerIDSet {
		ownerIDs = append(ownerIDs, id)
	}
	ownersByID := s.loadOwners(ownerIDs)
	dupSet := s.loadHasDuplicates(libraryID, fileIDs)

	entries := make([]interface{}, len(rows))
	for i, row := range rows {
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
			CapturedAt:        timePtr(row.CapturedAt),
			GpsLat:            row.GpsLat,
			GpsLon:            row.GpsLon,
			Hash:              row.Hash,
			HasDuplicates:     dupSet[row.ID],
			TrashedAt:         timePtr(row.TrashedAt),
			CreatedAt:         row.CreatedAt.Format(time.RFC3339Nano),
			UpdatedAt:         row.UpdatedAt.Format(time.RFC3339Nano),
			Owner:             owner,
			Tags:              tags,
		}
	}

	var nextCursor *string
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		payload := TimelineCursorPayload{
			CapturedAt: last.EffectiveCapturedAt.Format(time.RFC3339Nano),
			ID:         last.ID,
		}
		data, _ := json.Marshal(payload)
		encoded := base64.StdEncoding.EncodeToString(data)
		nextCursor = &encoded
	}

	return &PaginatedFiles{
		Entries:         entries,
		NextCursor:      nextCursor,
		TotalCount:      totalCount,
		Breadcrumbs:     []FolderBreadcrumb{},
		CurrentFolderID: nil,
	}, nil
}

func parseTimelineCursor(s string) (*timelineCursor, error) {
	if s == "" {
		return nil, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}
	var p TimelineCursorPayload
	if err := json.Unmarshal(decoded, &p); err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}
	if _, err := uuid.Parse(p.ID); err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, p.CapturedAt)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "Invalid cursor")
	}
	return &timelineCursor{capturedAt: t, id: p.ID}, nil
}

// MapPoint is the lightweight DTO for a single geotagged file on the map.
type MapPoint struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Lat             float64 `json:"lat"`
	Lon             float64 `json:"lon"`
	ThumbnailFileID *string `json:"thumbnailFileId"`
	CapturedAt      *string `json:"capturedAt"`
}

// LibraryMapResponse is the map endpoint payload. Truncated is true when the
// MapPointLimit cap was hit.
type LibraryMapResponse struct {
	Points    []MapPoint `json:"points"`
	Truncated bool       `json:"truncated"`
}

// ListLibraryMapPoints returns every geotagged, live, non-derived file in the
// library (newest-first), capped at MapPointLimit.
func (s *Service) ListLibraryMapPoints(libraryID string) (*LibraryMapResponse, error) {
	type mapRow struct {
		ID              string     `gorm:"column:id"`
		Name            string     `gorm:"column:name"`
		GpsLat          float64    `gorm:"column:gps_lat"`
		GpsLon          float64    `gorm:"column:gps_lon"`
		ThumbnailFileID *string    `gorm:"column:thumbnail_file_id"`
		CapturedAt      *time.Time `gorm:"column:captured_at"`
	}

	var rows []mapRow
	if err := s.db.Raw(`
		SELECT id, name, gps_lat, gps_lon, thumbnail_file_id,
		       COALESCE(captured_at, original_created_at, created_at) AS captured_at
		FROM files
		WHERE library_id = ?
		  AND gps_lat IS NOT NULL AND gps_lon IS NOT NULL
		  AND trashed_at IS NULL AND source_file_id IS NULL
		ORDER BY COALESCE(captured_at, original_created_at, created_at) DESC
		LIMIT ?
	`, libraryID, MapPointLimit+1).Scan(&rows).Error; err != nil {
		return nil, err
	}

	truncated := len(rows) > MapPointLimit
	if truncated {
		rows = rows[:MapPointLimit]
	}

	points := make([]MapPoint, len(rows))
	for i, r := range rows {
		points[i] = MapPoint{
			ID:              r.ID,
			Name:            r.Name,
			Lat:             r.GpsLat,
			Lon:             r.GpsLon,
			ThumbnailFileID: r.ThumbnailFileID,
			CapturedAt:      timePtr(r.CapturedAt),
		}
	}

	return &LibraryMapResponse{Points: points, Truncated: truncated}, nil
}
