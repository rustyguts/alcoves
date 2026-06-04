package imageproxy

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/queues"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// fakeProcessor records call counts and returns canned output (or an error to
// simulate a corrupt/unsupported source).
type fakeProcessor struct {
	out   []byte
	err   error
	calls int
}

func (p *fakeProcessor) Transform(_ []byte, opts TransformOptions) ([]byte, string, error) {
	p.calls++
	if p.err != nil {
		return nil, "", p.err
	}
	return p.out, MIMEForOpts(opts), nil
}

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }
func timePtr() *time.Time     { now := time.Now(); return &now }

// setupPrewarmDB scopes the prewarm tests to their own PostgreSQL schema so the
// package's GLOBAL scanPendingPrewarm query (no library filter) never sees rows
// from other packages running concurrently under `go test ./...`.
func setupPrewarmDB(t *testing.T) (*gorm.DB, uuid.UUID) {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_imageproxy")
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.File{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Exec("DELETE FROM files")
	db.Exec("DELETE FROM libraries")
	db.Exec("DELETE FROM users")

	userID := uuid.New()
	db.Create(&models.User{ID: userID, Email: userID.String()[:8] + "@t.com", DisplayName: "U", Role: "owner"})
	libID := uuid.New()
	db.Create(&models.Library{ID: libID, Name: "L", OwnerID: userID})
	return db, libID
}

func newStorage(t *testing.T) *storage.Service {
	t.Helper()
	dir := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	s := storage.NewService(driver)
	if err := s.EnsureReady(); err != nil {
		t.Fatalf("storage setup: %v", err)
	}
	return s
}

// TestPrewarmHandler_GeneratesAllVariants is the happy path: a healthy image
// gets every Variant written to the cache and is marked warmed at the current
// version with a clean strike counter.
func TestPrewarmHandler_GeneratesAllVariants(t *testing.T) {
	db, libID := setupPrewarmDB(t)
	st := newStorage(t)
	proc := &fakeProcessor{out: []byte("transformed")}

	w, h := 4000, 3000
	file := models.File{LibraryID: libID, Name: "p.jpg", MimeType: "image/jpeg", Size: 1, Width: &w, Height: &h}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := st.StoreFile(libID.String(), file.ID.String(), []byte("source-bytes")); err != nil {
		t.Fatal(err)
	}

	handler := NewPrewarmTaskHandler(db, st, proc)
	if err := handler.run(libID.String(), file.ID.String()); err != nil {
		t.Fatalf("run: %v", err)
	}

	for _, v := range Variants {
		key := TransformCacheKey(libID.String(), file.ID.String(), v.Resolve(file.Width, file.Height))
		if ok, _ := st.CacheExists(key); !ok {
			t.Errorf("variant %q not written to cache (%s)", v.Name, key)
		}
	}
	if proc.calls != len(Variants) {
		t.Errorf("processor called %d times, want %d (one per variant)", proc.calls, len(Variants))
	}

	var got models.File
	db.First(&got, "id = ?", file.ID)
	if got.ImageProxyWarmedVersion == nil || *got.ImageProxyWarmedVersion != VariantsVersion {
		t.Errorf("warmed_version = %v, want %d", got.ImageProxyWarmedVersion, VariantsVersion)
	}
	if got.ImageProxyStatus == nil || *got.ImageProxyStatus != "ready" {
		t.Errorf("status = %v, want ready", got.ImageProxyStatus)
	}
	if got.ImageProxyAttempts != 0 {
		t.Errorf("attempts = %d, want 0", got.ImageProxyAttempts)
	}
}

// TestPrewarmHandler_SkipsCachedVariants proves idempotency: a variant already
// in the cache is not regenerated or overwritten.
func TestPrewarmHandler_SkipsCachedVariants(t *testing.T) {
	db, libID := setupPrewarmDB(t)
	st := newStorage(t)
	proc := &fakeProcessor{out: []byte("transformed")}

	file := models.File{LibraryID: libID, Name: "p.jpg", MimeType: "image/jpeg", Size: 1}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := st.StoreFile(libID.String(), file.ID.String(), []byte("source-bytes")); err != nil {
		t.Fatal(err)
	}

	// Pre-populate the first variant's cache as if a real request had filled it.
	v0 := Variants[0]
	key0 := TransformCacheKey(libID.String(), file.ID.String(), v0.Resolve(file.Width, file.Height))
	if err := st.StoreCacheBuffer(key0, []byte("preexisting")); err != nil {
		t.Fatal(err)
	}

	handler := NewPrewarmTaskHandler(db, st, proc)
	if err := handler.run(libID.String(), file.ID.String()); err != nil {
		t.Fatalf("run: %v", err)
	}

	if proc.calls != len(Variants)-1 {
		t.Errorf("processor called %d times, want %d (cached variant skipped)", proc.calls, len(Variants)-1)
	}
	data, err := st.ReadCacheBuffer(key0)
	if err != nil || string(data) != "preexisting" {
		t.Errorf("pre-existing variant was overwritten: %q (%v)", data, err)
	}
}

// TestPrewarmHandler_CorruptFileStrikesOutAfterThree is the core requirement: a
// file whose variants fail to generate every time runs at most 3 times. Each
// failed run increments the strike counter; once it hits the cap the scan drops
// the file so no further pass enqueues it.
func TestPrewarmHandler_CorruptFileStrikesOutAfterThree(t *testing.T) {
	db, libID := setupPrewarmDB(t)
	st := newStorage(t)
	proc := &fakeProcessor{err: errors.New("not a valid image")}

	file := models.File{LibraryID: libID, Name: "corrupt.jpg", MimeType: "image/jpeg", Size: 1}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := st.StoreFile(libID.String(), file.ID.String(), []byte("garbage")); err != nil {
		t.Fatal(err)
	}

	handler := NewPrewarmTaskHandler(db, st, proc)
	for i := 1; i <= maxPrewarmAttempts; i++ {
		if err := handler.run(libID.String(), file.ID.String()); err == nil {
			t.Fatalf("attempt %d: expected a transform error", i)
		}
		var got models.File
		db.First(&got, "id = ?", file.ID)
		if got.ImageProxyAttempts != i {
			t.Fatalf("after attempt %d, attempts = %d, want %d", i, got.ImageProxyAttempts, i)
		}
		if got.ImageProxyWarmedVersion != nil {
			t.Fatalf("warmed_version should stay nil while failing, got %v", got.ImageProxyWarmedVersion)
		}
	}

	// At the cap the maintenance scan must no longer select it — i.e. it will
	// never run a 4th time.
	rows, err := scanPendingPrewarm(db, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.ID == file.ID.String() {
			t.Fatalf("file at the %d-strike cap must be excluded from the scan", maxPrewarmAttempts)
		}
	}
}

// TestPrewarmHandler_TransientFailureDoesNotStrike verifies an infrastructure
// failure (source unreadable from storage) does NOT burn a strike, so a transient
// outage can't permanently sideline a healthy file.
func TestPrewarmHandler_TransientFailureDoesNotStrike(t *testing.T) {
	db, libID := setupPrewarmDB(t)
	st := newStorage(t)
	proc := &fakeProcessor{out: []byte("transformed")}

	// Create the row but DO NOT store source bytes → ReadFileBuffer fails.
	file := models.File{LibraryID: libID, Name: "missing.jpg", MimeType: "image/jpeg", Size: 1}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}

	handler := NewPrewarmTaskHandler(db, st, proc)
	if err := handler.run(libID.String(), file.ID.String()); err == nil {
		t.Fatal("expected a transient read error")
	}
	if proc.calls != 0 {
		t.Errorf("processor should not be called when the source can't be read, got %d", proc.calls)
	}

	var got models.File
	db.First(&got, "id = ?", file.ID)
	if got.ImageProxyAttempts != 0 {
		t.Errorf("transient failure must not increment attempts, got %d", got.ImageProxyAttempts)
	}
}

// TestScanPendingPrewarm pins exactly which files the hourly scan selects.
func TestScanPendingPrewarm(t *testing.T) {
	db, libID := setupPrewarmDB(t)

	mk := func(name, mime string, f models.File) uuid.UUID {
		f.LibraryID = libID
		f.Name = name
		f.MimeType = mime
		f.Size = 1
		if err := db.Create(&f).Error; err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return f.ID
	}

	// Eligible.
	wantPending := mk("pending.jpg", "image/jpeg", models.File{})
	wantRetry := mk("failed.jpg", "image/jpeg", models.File{ImageProxyAttempts: 1, ImageProxyStatus: strPtr("failed")})
	// Derived video-thumbnail images ARE warmed (shown in grid/search/timeline),
	// unlike the metadata scan which skips derived files.
	derivedSrc := uuid.New()
	wantDerived := mk("thumb.webp", "image/webp", models.File{SourceFileID: &derivedSrc})

	// Excluded.
	mk("exhausted.jpg", "image/jpeg", models.File{ImageProxyAttempts: maxPrewarmAttempts})        // 3-strike cap
	mk("warmed.jpg", "image/jpeg", models.File{ImageProxyWarmedVersion: intPtr(VariantsVersion)}) // already warmed
	mk("video.mp4", "video/mp4", models.File{})                                                   // not an image
	mk("inflight.jpg", "image/jpeg", models.File{ImageProxyStatus: strPtr("queued")})             // in flight (fresh)
	mk("trashed.jpg", "image/jpeg", models.File{TrashedAt: timePtr()})                            // trashed

	rows, err := scanPendingPrewarm(db, 100)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range rows {
		got[r.ID] = true
	}
	if len(got) != 3 || !got[wantPending.String()] || !got[wantRetry.String()] || !got[wantDerived.String()] {
		t.Fatalf("scan returned %d rows %v, want exactly {%s, %s, %s}", len(rows), got, wantPending, wantRetry, wantDerived)
	}
}

// TestEnqueuePrewarm_RoutesToMaintenanceQueue verifies the logical queue
// separation: pre-warm tasks land on the low-priority maintenance queue with no
// asynq-level retries (the DB strike counter is the real cap).
func TestEnqueuePrewarm_RoutesToMaintenanceQueue(t *testing.T) {
	mr := miniredis.RunT(t)
	opt := asynq.RedisClientOpt{Addr: mr.Addr()}
	client := asynq.NewClient(opt)
	defer client.Close()

	svc := NewPrewarmService(nil, nil, &fakeProcessor{out: []byte("x")}, client)
	if err := svc.EnqueuePrewarm("lib", "file"); err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	insp := asynq.NewInspector(opt)
	defer insp.Close()
	tasks, err := insp.ListPendingTasks(queues.Maintenance)
	if err != nil {
		t.Fatalf("list pending: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("want 1 pending task on %q, got %d", queues.Maintenance, len(tasks))
	}
	if tasks[0].Type != TaskTypePrewarm {
		t.Errorf("task type = %q, want %q", tasks[0].Type, TaskTypePrewarm)
	}
	if tasks[0].MaxRetry != 0 {
		t.Errorf("max retry = %d, want 0 (DB strike counter is the cap)", tasks[0].MaxRetry)
	}
}

// TestPrewarmEnabled gates the maintenance loop on having a usable transform
// backend + queue client.
func TestPrewarmEnabled(t *testing.T) {
	if NewPrewarmService(nil, nil, nil, nil).Enabled() {
		t.Error("no processor/client should report disabled")
	}
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()
	if !NewPrewarmService(nil, nil, &fakeProcessor{}, client).Enabled() {
		t.Error("processor + client should report enabled")
	}
}
