package momentexport

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Tests run against a private, uniquely-named Postgres database created once
// per test binary, isolating from other parallel test processes that TRUNCATE
// the shared alcoves_test database.

var (
	isoDBOnce sync.Once
	isoDB     *gorm.DB
	isoDBErr  error
	isoDBName string
)

func initIsolatedDB() {
	admin := "postgres://postgres:postgres@localhost:5455/postgres"
	adminDB, err := gorm.Open(postgres.Open(admin), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		isoDBErr = err
		return
	}
	name := "me_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := adminDB.Exec("CREATE DATABASE " + name).Error; err != nil {
		isoDBErr = err
		return
	}
	dsn := fmt.Sprintf("postgres://postgres:postgres@localhost:5455/%s", name)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		isoDBErr = err
		return
	}
	db.Exec("CREATE EXTENSION IF NOT EXISTS pgcrypto")
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.LibraryMember{}, &models.File{}, &models.Moment{}); err != nil {
		isoDBErr = err
		return
	}
	isoDB = db
	isoDBName = name
}

// TestMain drops the per-binary isolated database on exit so test DBs don't
// accumulate on the shared Postgres server.
func TestMain(m *testing.M) {
	code := m.Run()
	dropIsolatedDB()
	os.Exit(code)
}

func dropIsolatedDB() {
	if isoDBName == "" {
		return
	}
	if isoDB != nil {
		if sqlDB, err := isoDB.DB(); err == nil {
			sqlDB.Close()
		}
	}
	admin, err := gorm.Open(postgres.Open("postgres://postgres:postgres@localhost:5455/postgres"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return
	}
	admin.Exec("DROP DATABASE IF EXISTS " + isoDBName)
}

func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	probe, err := gorm.Open(postgres.Open("postgres://postgres:postgres@localhost:5455/postgres"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if sqlDB, e := probe.DB(); e == nil {
		if pingErr := sqlDB.Ping(); pingErr != nil {
			t.Skipf("Skipping test: database not available: %v", pingErr)
		}
		sqlDB.Close()
	}
	isoDBOnce.Do(initIsolatedDB)
	if isoDBErr != nil {
		t.Skipf("Skipping test: could not create isolated database: %v", isoDBErr)
	}
	return isoDB
}

func setupTestStorage(t *testing.T) *storage.Service {
	t.Helper()
	root := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	svc := storage.NewService(driver)
	if err := svc.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	return svc
}

func ffmpegAvailable(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available")
	}
}

// genVideo creates a ~3s mp4 with audio so we can clip a sub-range.
func genVideo(t *testing.T, dir, name string) string {
	t.Helper()
	out := filepath.Join(dir, name)
	cmd := exec.Command("ffmpeg",
		"-f", "lavfi", "-i", "testsrc=duration=3:size=128x128:rate=10",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=3",
		"-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-y", out,
	)
	if combined, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg gen video failed: %v\n%s", err, combined)
	}
	return out
}

func seedMoment(t *testing.T, db *gorm.DB, start, end float64, exportVersion int) (libID, fileID, momentID uuid.UUID) {
	t.Helper()
	owner := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: uuid.NewString() + "@example.com", DisplayName: "Owner"}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	lib := models.Library{BaseModel: models.BaseModel{ID: uuid.New()}, Name: "Lib", OwnerID: owner.ID}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	file := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: lib.ID, Name: "v.mp4", MimeType: "video/mp4", OwnerID: &owner.ID}
	if err := db.Create(&file).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	moment := models.Moment{
		BaseModel:     models.BaseModel{ID: uuid.New()},
		FileID:        file.ID,
		LibraryID:     lib.ID,
		CreatedByID:   owner.ID,
		Name:          "M",
		StartSeconds:  start,
		EndSeconds:    end,
		ExportVersion: exportVersion,
	}
	if err := db.Create(&moment).Error; err != nil {
		t.Fatalf("create moment: %v", err)
	}
	return lib.ID, file.ID, moment.ID
}

func newAsynqClient(t *testing.T) *asynq.Client {
	t.Helper()
	addr := "localhost:6389"
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		t.Skipf("redis/dragonfly not available at %s: %v", addr, err)
	}
	conn.Close()
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: addr})
	t.Cleanup(func() { client.Close() })
	return client
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

func TestStringPtr(t *testing.T) {
	p := stringPtr("x")
	if p == nil || *p != "x" {
		t.Fatalf("stringPtr broken")
	}
}

func TestParseOutTime(t *testing.T) {
	cases := []struct {
		in      string
		want    float64
		wantErr bool
	}{
		{"00:00:01.500000", 1.5, false},
		{"01:02:03.0", 3723.0, false},
		{"00:00:00.0", 0, false},
		{"bad", 0, true},
		{"1:2", 0, true},
		{"aa:00:00", 0, true},
		{"00:bb:00", 0, true},
		{"00:00:cc", 0, true},
	}
	for _, tc := range cases {
		got, err := parseOutTime(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("parseOutTime(%q): expected error", tc.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseOutTime(%q): %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("parseOutTime(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestParseSpeed(t *testing.T) {
	cases := []struct {
		in      string
		want    float64
		wantErr bool
	}{
		{"1.5x", 1.5, false},
		{" 2x ", 2, false},
		{"x", 0, true},
		{"", 0, true},
		{"0x", 0, true},
		{"-1x", 0, true},
		{"abcx", 0, true},
	}
	for _, tc := range cases {
		got, err := parseSpeed(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("parseSpeed(%q): expected error", tc.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseSpeed(%q): %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("parseSpeed(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestNewServiceAndHandler(t *testing.T) {
	s := NewService(nil, nil, nil)
	if s == nil {
		t.Fatal("NewService nil")
	}
	h := s.NewTaskHandler()
	if h == nil {
		t.Fatal("NewTaskHandler nil")
	}
}

func TestProcessTask_InvalidPayload(t *testing.T) {
	h := &TaskHandler{}
	task := asynq.NewTask(TaskTypeMomentExport, []byte("not json"))
	if err := h.ProcessTask(context.Background(), task); err == nil {
		t.Fatalf("expected error for invalid payload")
	}
}

func TestCompletedTaskRetentionConstant(t *testing.T) {
	if completedTaskRetention != 24*time.Hour {
		t.Fatalf("unexpected retention: %v", completedTaskRetention)
	}
}

// ---------------------------------------------------------------------------
// transcodeClip
// ---------------------------------------------------------------------------

func TestTranscodeClip(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4")
	dst := filepath.Join(dir, "out.mp4")

	var progresses []int
	err := transcodeClip(context.Background(), src, dst, 0.5, 2.0, 1.5, func(p int, eta *int) {
		progresses = append(progresses, p)
	})
	if err != nil {
		t.Fatalf("transcodeClip: %v", err)
	}
	if info, err := os.Stat(dst); err != nil || info.Size() == 0 {
		t.Fatalf("expected non-empty clip: %v", err)
	}
}

func TestTranscodeClip_NilProgress(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4")
	dst := filepath.Join(dir, "out.mp4")
	if err := transcodeClip(context.Background(), src, dst, 0, 1.0, 1.0, nil); err != nil {
		t.Fatalf("transcodeClip nil progress: %v", err)
	}
}

func TestTranscodeClip_BadInput(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.mp4")
	if err := os.WriteFile(bad, []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "out.mp4")
	if err := transcodeClip(context.Background(), bad, dst, 0, 1.0, 1.0, nil); err == nil {
		t.Fatalf("expected error for bad input")
	}
}

// ---------------------------------------------------------------------------
// processMoment / state writers
// ---------------------------------------------------------------------------

func TestProcessMoment_NotFound(t *testing.T) {
	db := setupTestDB(t)
	h := &TaskHandler{db: db}
	if err := h.processMoment(context.Background(), uuid.NewString(), uuid.NewString(), uuid.NewString()); err != nil {
		t.Fatalf("expected nil for not found, got %v", err)
	}
}

func TestProcessMoment_AlreadyExported(t *testing.T) {
	db := setupTestDB(t)
	libID, fileID, momentID := seedMoment(t, db, 0, 1, 2)
	// Mark exported_version == export_version → skip.
	v := 2
	db.Model(&models.Moment{}).Where("id = ?", momentID).Update("exported_version", v)
	h := &TaskHandler{db: db}
	if err := h.processMoment(context.Background(), libID.String(), fileID.String(), momentID.String()); err != nil {
		t.Fatalf("expected nil for already-exported, got %v", err)
	}
}

func TestProcessMoment_InvalidRange(t *testing.T) {
	db := setupTestDB(t)
	store := setupTestStorage(t)
	// start == end → clipDuration <= 0 → fail.
	libID, fileID, momentID := seedMoment(t, db, 5, 5, 1)
	if err := store.StoreFile(libID.String(), fileID.String(), []byte("dummy")); err != nil {
		t.Fatal(err)
	}
	h := &TaskHandler{db: db, storage: store}
	if err := h.processMoment(context.Background(), libID.String(), fileID.String(), momentID.String()); err == nil {
		t.Fatalf("expected error for invalid range")
	}
	var m models.Moment
	db.Where("id = ?", momentID).First(&m)
	if m.ExportStatus == nil || *m.ExportStatus != "failed" {
		t.Fatalf("expected failed status, got %v", m.ExportStatus)
	}
}

func TestProcessMoment_OpenSourceFails(t *testing.T) {
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, fileID, momentID := seedMoment(t, db, 0, 1, 1)
	// No blob stored → OpenFileReadStream fails.
	h := &TaskHandler{db: db, storage: store}
	if err := h.processMoment(context.Background(), libID.String(), fileID.String(), momentID.String()); err == nil {
		t.Fatalf("expected error when source blob missing")
	}
	var m models.Moment
	db.Where("id = ?", momentID).First(&m)
	if m.ExportStatus == nil || *m.ExportStatus != "failed" {
		t.Fatalf("expected failed status, got %v", m.ExportStatus)
	}
}

func TestProcessMoment_FullFlow(t *testing.T) {
	ffmpegAvailable(t)
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, fileID, momentID := seedMoment(t, db, 0.5, 2.0, 1)

	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4")
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StoreFile(libID.String(), fileID.String(), data); err != nil {
		t.Fatal(err)
	}

	h := &TaskHandler{db: db, storage: store}
	if err := h.processMoment(context.Background(), libID.String(), fileID.String(), momentID.String()); err != nil {
		t.Fatalf("processMoment: %v", err)
	}

	var m models.Moment
	db.Where("id = ?", momentID).First(&m)
	if m.ExportStatus == nil || *m.ExportStatus != "ready" {
		t.Fatalf("expected ready, got %v", m.ExportStatus)
	}
	if m.ExportedVersion == nil || *m.ExportedVersion != 1 {
		t.Fatalf("expected exported_version 1, got %v", m.ExportedVersion)
	}

	// Cached output should exist at the versioned key.
	exists, err := store.CacheExists(CacheKey(libID.String(), momentID.String(), 1))
	if err != nil || !exists {
		t.Fatalf("expected cached export to exist: %v %v", exists, err)
	}
}

func TestSetExportState(t *testing.T) {
	db := setupTestDB(t)
	_, _, momentID := seedMoment(t, db, 0, 1, 1)
	h := &TaskHandler{db: db}
	p := 33
	eta := 5
	ver := 4
	h.setExportState(momentID.String(), stringPtr("processing"), &p, &eta, &ver)
	var m models.Moment
	db.Where("id = ?", momentID).First(&m)
	if m.ExportStatus == nil || *m.ExportStatus != "processing" {
		t.Fatalf("status not set: %v", m.ExportStatus)
	}
	if m.ExportProgress == nil || *m.ExportProgress != 33 {
		t.Fatalf("progress not set: %v", m.ExportProgress)
	}
	if m.ExportedVersion == nil || *m.ExportedVersion != 4 {
		t.Fatalf("exported_version not set: %v", m.ExportedVersion)
	}
}

func TestFail(t *testing.T) {
	db := setupTestDB(t)
	_, _, momentID := seedMoment(t, db, 0, 1, 1)
	h := &TaskHandler{db: db}
	h.fail(momentID.String(), "boom: %d", 42)
	var m models.Moment
	db.Where("id = ?", momentID).First(&m)
	if m.ExportStatus == nil || *m.ExportStatus != "failed" {
		t.Fatalf("expected failed status, got %v", m.ExportStatus)
	}
}

// ---------------------------------------------------------------------------
// Enqueue + ProcessTask happy path
// ---------------------------------------------------------------------------

func TestEnqueue(t *testing.T) {
	client := newAsynqClient(t)
	s := NewService(nil, nil, client)
	if err := s.Enqueue("lib-1", "file-1", "moment-1"); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
}

func TestProcessTask_ValidPayloadNotFound(t *testing.T) {
	db := setupTestDB(t)
	h := &TaskHandler{db: db}
	payload, err := json.Marshal(Payload{
		LibraryID: uuid.NewString(),
		FileID:    uuid.NewString(),
		MomentID:  uuid.NewString(),
	})
	if err != nil {
		t.Fatal(err)
	}
	task := asynq.NewTask(TaskTypeMomentExport, payload)
	// Moment not found → processMoment returns nil.
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Fatalf("ProcessTask (not found): %v", err)
	}
}
