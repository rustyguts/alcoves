package files

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func newTimelineCtx(query string) echo.Context {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/?"+query, nil)
	rec := httptest.NewRecorder()
	return e.NewContext(req, rec)
}

func timelineIDs(p *PaginatedFiles) []string {
	ids := make([]string, 0, len(p.Entries))
	for _, e := range p.Entries {
		if f, ok := e.(FileResponse); ok {
			ids = append(ids, f.ID)
		}
	}
	return ids
}

func tPtr(s string) *time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return &t
}

func fPtr(v float64) *float64 { return &v }

func createTimelineFile(t *testing.T, db *gorm.DB, f models.File) uuid.UUID {
	t.Helper()
	if f.MimeType == "" {
		f.MimeType = "image/jpeg"
	}
	if f.Size == 0 {
		f.Size = 1
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file %q: %v", f.Name, err)
	}
	return f.ID
}

func TestListLibraryTimeline_OrdersByCapturedAtDesc(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	low := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "low.jpg", CapturedAt: tPtr("2026-01-01T00:00:00Z")})
	high := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "high.jpg", CapturedAt: tPtr("2026-06-01T00:00:00Z")})
	mid := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "mid.jpg", CapturedAt: tPtr("2026-03-01T00:00:00Z")})

	res, err := svc.ListLibraryTimeline(fix.LibraryID.String(), newTimelineCtx(""))
	if err != nil {
		t.Fatal(err)
	}

	got := timelineIDs(res)
	want := []string{high.String(), mid.String(), low.String()}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("order = %v, want %v", got, want)
	}
	if res.TotalCount != 3 {
		t.Fatalf("totalCount = %d, want 3", res.TotalCount)
	}
}

func TestListLibraryTimeline_CoalescesFallbackDate(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// captured_at NULL → falls back to original_created_at (which is later).
	fallback := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "fallback.jpg", OriginalCreatedAt: tPtr("2026-12-01T00:00:00Z")})
	captured := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "captured.jpg", CapturedAt: tPtr("2026-05-01T00:00:00Z")})

	res, err := svc.ListLibraryTimeline(fix.LibraryID.String(), newTimelineCtx(""))
	if err != nil {
		t.Fatal(err)
	}
	got := timelineIDs(res)
	if len(got) != 2 || got[0] != fallback.String() || got[1] != captured.String() {
		t.Fatalf("order = %v, want [%s %s]", got, fallback, captured)
	}
}

func TestListLibraryTimeline_TypeFilter(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "photo.jpg", MimeType: "image/jpeg", CapturedAt: tPtr("2026-01-02T00:00:00Z")})
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "notes.txt", MimeType: "text/plain", CapturedAt: tPtr("2026-01-01T00:00:00Z")})

	media, err := svc.ListLibraryTimeline(fix.LibraryID.String(), newTimelineCtx("type=media"))
	if err != nil {
		t.Fatal(err)
	}
	if len(media.Entries) != 1 || media.TotalCount != 1 {
		t.Fatalf("media: got %d entries (total %d), want 1", len(media.Entries), media.TotalCount)
	}

	all, err := svc.ListLibraryTimeline(fix.LibraryID.String(), newTimelineCtx("type=all"))
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Entries) != 2 || all.TotalCount != 2 {
		t.Fatalf("all: got %d entries (total %d), want 2", len(all.Entries), all.TotalCount)
	}
}

func TestListLibraryTimeline_CursorPagination(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	a := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "a.jpg", CapturedAt: tPtr("2026-01-03T00:00:00Z")})
	b := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "b.jpg", CapturedAt: tPtr("2026-01-02T00:00:00Z")})
	c := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "c.jpg", CapturedAt: tPtr("2026-01-01T00:00:00Z")})

	page1, err := svc.ListLibraryTimeline(fix.LibraryID.String(), newTimelineCtx("limit=2"))
	if err != nil {
		t.Fatal(err)
	}
	if got := timelineIDs(page1); len(got) != 2 || got[0] != a.String() || got[1] != b.String() {
		t.Fatalf("page1 = %v, want [%s %s]", got, a, b)
	}
	if page1.NextCursor == nil {
		t.Fatal("expected nextCursor on page1")
	}

	page2, err := svc.ListLibraryTimeline(fix.LibraryID.String(), newTimelineCtx("limit=2&cursor="+*page1.NextCursor))
	if err != nil {
		t.Fatal(err)
	}
	if got := timelineIDs(page2); len(got) != 1 || got[0] != c.String() {
		t.Fatalf("page2 = %v, want [%s]", got, c)
	}
	if page2.NextCursor != nil {
		t.Fatal("expected no nextCursor on final page")
	}
}

func TestListLibraryMapPoints(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	geo := createTimelineFile(t, db, models.File{
		LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "geo.jpg",
		CapturedAt: tPtr("2026-04-01T00:00:00Z"), GpsLat: fPtr(37.77), GpsLon: fPtr(-122.42),
	})
	// No GPS — must be excluded.
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "nogeo.jpg", CapturedAt: tPtr("2026-04-02T00:00:00Z")})

	res, err := svc.ListLibraryMapPoints(fix.LibraryID.String())
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Points) != 1 {
		t.Fatalf("got %d points, want 1", len(res.Points))
	}
	p := res.Points[0]
	if p.ID != geo.String() || p.Lat != 37.77 || p.Lon != -122.42 {
		t.Fatalf("point = %+v", p)
	}
	if res.Truncated {
		t.Fatal("expected truncated=false")
	}
}
