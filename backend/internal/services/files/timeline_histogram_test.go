package files

import (
	"testing"

	"github.com/alcoves/alcoves-backend/internal/models"
)

func TestListLibraryTimelineHistogram_CountsPerMonthNewestFirst(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// Jan 2026 ×2, Dec 2025 ×1, Dec 2024 ×1 (bucketed by UTC month).
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "a.jpg", CapturedAt: tPtr("2026-01-15T00:00:00Z")})
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "b.jpg", CapturedAt: tPtr("2026-01-20T00:00:00Z")})
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "c.jpg", CapturedAt: tPtr("2025-12-02T00:00:00Z")})
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "d.jpg", CapturedAt: tPtr("2024-12-31T00:00:00Z")})

	res, err := svc.ListLibraryTimelineHistogram(fix.LibraryID.String(), newTimelineCtx(""))
	if err != nil {
		t.Fatal(err)
	}

	want := []TimelineHistogramBucket{
		{Year: 2026, Month: 1, Count: 2},
		{Year: 2025, Month: 12, Count: 1},
		{Year: 2024, Month: 12, Count: 1},
	}
	if len(res.Buckets) != len(want) {
		t.Fatalf("buckets = %+v, want %+v", res.Buckets, want)
	}
	for i := range want {
		if res.Buckets[i] != want[i] {
			t.Fatalf("bucket[%d] = %+v, want %+v", i, res.Buckets[i], want[i])
		}
	}
	if res.TotalCount != 4 {
		t.Fatalf("totalCount = %d, want 4", res.TotalCount)
	}
}

func TestListLibraryTimelineHistogram_TypeFilter(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "photo.jpg", MimeType: "image/jpeg", CapturedAt: tPtr("2026-01-02T00:00:00Z")})
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "notes.txt", MimeType: "text/plain", CapturedAt: tPtr("2026-01-03T00:00:00Z")})

	media, err := svc.ListLibraryTimelineHistogram(fix.LibraryID.String(), newTimelineCtx("type=media"))
	if err != nil {
		t.Fatal(err)
	}
	if media.TotalCount != 1 || len(media.Buckets) != 1 || media.Buckets[0].Count != 1 {
		t.Fatalf("media histogram = %+v, want one Jan-2026 bucket of count 1", media)
	}

	all, err := svc.ListLibraryTimelineHistogram(fix.LibraryID.String(), newTimelineCtx("type=all"))
	if err != nil {
		t.Fatal(err)
	}
	if all.TotalCount != 2 || len(all.Buckets) != 1 || all.Buckets[0].Count != 2 {
		t.Fatalf("all histogram = %+v, want one Jan-2026 bucket of count 2", all)
	}
}

func TestListLibraryTimelineHistogram_CoalesceFallback(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	// No captured_at → bucket by original_created_at, matching the timeline sort.
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "fallback.jpg", OriginalCreatedAt: tPtr("2026-07-01T00:00:00Z")})

	res, err := svc.ListLibraryTimelineHistogram(fix.LibraryID.String(), newTimelineCtx(""))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Buckets) != 1 || res.Buckets[0] != (TimelineHistogramBucket{Year: 2026, Month: 7, Count: 1}) {
		t.Fatalf("buckets = %+v, want one Jul-2026 bucket of count 1", res.Buckets)
	}
}

func TestListLibraryTimelineHistogram_ExcludesTrashedAndDerived(t *testing.T) {
	db := setupListingTestDB(t)
	fix := seedListingLibrary(t, db)
	svc := NewService(db)

	src := createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "keep.jpg", CapturedAt: tPtr("2026-05-01T00:00:00Z")})
	// Trashed file — excluded.
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "trashed.jpg", CapturedAt: tPtr("2026-05-02T00:00:00Z"), TrashedAt: tPtr("2026-06-01T00:00:00Z")})
	// Derived file (has source_file_id) — excluded.
	createTimelineFile(t, db, models.File{LibraryID: fix.LibraryID, OwnerID: &fix.UserID, Name: "derived.jpg", CapturedAt: tPtr("2026-05-03T00:00:00Z"), SourceFileID: &src})

	res, err := svc.ListLibraryTimelineHistogram(fix.LibraryID.String(), newTimelineCtx(""))
	if err != nil {
		t.Fatal(err)
	}
	if res.TotalCount != 1 || len(res.Buckets) != 1 || res.Buckets[0].Count != 1 {
		t.Fatalf("histogram = %+v, want only the kept file (count 1)", res)
	}
}
