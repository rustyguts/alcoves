package mcpserver

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alcoves/alcoves-backend/internal/services/files"
)

// ─── get_timeline ────────────────────────────────────────────────────────────

type getTimelineInput struct {
	LibraryID  string `json:"libraryId" jsonschema:"the library UUID"`
	IncludeAll bool   `json:"includeAll,omitempty" jsonschema:"include all files; default false = images and videos only"`
	Cursor     string `json:"cursor,omitempty" jsonschema:"opaque pagination cursor from a previous call"`
	Limit      int    `json:"limit,omitempty" jsonschema:"page size, 1-200 (default 50)"`
}

type timelineEntry struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	MimeType   string   `json:"mimeType"`
	Size       int64    `json:"size"`
	Duration   *int     `json:"duration,omitempty"`
	Width      *int     `json:"width,omitempty"`
	Height     *int     `json:"height,omitempty"`
	CapturedAt *string  `json:"capturedAt,omitempty"`
	GpsLat     *float64 `json:"gpsLat,omitempty"`
	GpsLon     *float64 `json:"gpsLon,omitempty"`
	CreatedAt  string   `json:"createdAt"`
}

type getTimelineOutput struct {
	Entries    []timelineEntry `json:"entries"`
	NextCursor string          `json:"nextCursor,omitempty"`
	TotalCount int             `json:"totalCount"`
}

func registerTimelineTools(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_timeline",
		Description: "List a library's media (images + videos) newest-first by capture date, the same ordering as the Timeline view. Cursor-paginated. Set includeAll to include non-media files too.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getTimelineInput) (*mcp.CallToolResult, getTimelineOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, getTimelineOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, getTimelineOutput{}, err
		}

		p := files.TimelineParams{Cursor: in.Cursor}
		if in.IncludeAll {
			p.Type = "all"
		}
		if in.Limit > 0 {
			p.Limit = itoa(in.Limit)
		}

		page, err := d.Files.ListLibraryTimelineParams(in.LibraryID, p)
		if err != nil {
			return nil, getTimelineOutput{}, err
		}

		out := getTimelineOutput{Entries: make([]timelineEntry, 0, len(page.Entries)), TotalCount: page.TotalCount}
		if page.NextCursor != nil {
			out.NextCursor = *page.NextCursor
		}
		for _, e := range page.Entries {
			if v, ok := e.(files.FileResponse); ok {
				out.Entries = append(out.Entries, timelineEntry{
					ID: v.ID, Name: v.Name, MimeType: v.MimeType, Size: v.Size,
					Duration: v.Duration, Width: v.Width, Height: v.Height,
					CapturedAt: v.CapturedAt, GpsLat: v.GpsLat, GpsLon: v.GpsLon,
					CreatedAt: v.CreatedAt,
				})
			}
		}
		return nil, out, nil
	})

	registerMapTool(srv, d)
}

// ─── list_map_points ─────────────────────────────────────────────────────────

type listMapPointsInput struct {
	LibraryID string `json:"libraryId" jsonschema:"the library UUID"`
}

type mapPoint struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Lat        float64 `json:"lat"`
	Lon        float64 `json:"lon"`
	CapturedAt *string `json:"capturedAt,omitempty"`
}

type listMapPointsOutput struct {
	Points    []mapPoint `json:"points"`
	Truncated bool       `json:"truncated"`
}

func registerMapTool(srv *mcp.Server, d Deps) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_map_points",
		Description: "List the geotagged files in a library (those with GPS coordinates), newest-first. Capped at 5000 points; truncated=true means more exist beyond the cap.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listMapPointsInput) (*mcp.CallToolResult, listMapPointsOutput, error) {
		libraryID, err := parseUUIDArg("libraryId", in.LibraryID)
		if err != nil {
			return nil, listMapPointsOutput{}, err
		}
		if _, _, err := d.requireLibraryAccess(ctx, libraryID); err != nil {
			return nil, listMapPointsOutput{}, err
		}

		res, err := d.Files.ListLibraryMapPoints(in.LibraryID)
		if err != nil {
			return nil, listMapPointsOutput{}, err
		}
		out := listMapPointsOutput{Points: make([]mapPoint, 0, len(res.Points)), Truncated: res.Truncated}
		for _, p := range res.Points {
			out.Points = append(out.Points, mapPoint{
				ID: p.ID, Name: p.Name, Lat: p.Lat, Lon: p.Lon, CapturedAt: p.CapturedAt,
			})
		}
		return nil, out, nil
	})
}
