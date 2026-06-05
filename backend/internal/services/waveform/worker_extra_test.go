package waveform

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

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
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
	name := "wf_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.LibraryMember{}, &models.File{}); err != nil {
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

func testConfig() *config.Config {
	return &config.Config{FFmpegBinaryPath: "ffmpeg"}
}

func ffmpegAvailable(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available")
	}
}

// genAudio creates a tiny wav (sine) of the given duration.
func genAudio(t *testing.T, dir, name string) string {
	t.Helper()
	out := filepath.Join(dir, name)
	cmd := exec.Command("ffmpeg",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=1",
		"-y", out,
	)
	if combined, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg gen audio failed: %v\n%s", err, combined)
	}
	return out
}

// genSilentVideo creates a 1s video with no audio stream.
func genSilentVideo(t *testing.T, dir, name string) string {
	t.Helper()
	out := filepath.Join(dir, name)
	cmd := exec.Command("ffmpeg",
		"-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-y", out,
	)
	if combined, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg gen video failed: %v\n%s", err, combined)
	}
	return out
}

func seedLibrary(t *testing.T, db *gorm.DB) (uuid.UUID, uuid.UUID) {
	t.Helper()
	owner := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: uuid.NewString() + "@example.com", DisplayName: "Owner"}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	lib := models.Library{BaseModel: models.BaseModel{ID: uuid.New()}, Name: "Lib", OwnerID: owner.ID}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	return lib.ID, owner.ID
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
// Pure helpers / constructors
// ---------------------------------------------------------------------------

func TestStringPtr(t *testing.T) {
	p := stringPtr("hi")
	if p == nil || *p != "hi" {
		t.Fatalf("stringPtr broken: %v", p)
	}
}

func TestNewWaveformTask(t *testing.T) {
	task, err := NewWaveformTask("lib", "file")
	if err != nil {
		t.Fatalf("NewWaveformTask: %v", err)
	}
	if task.Type() != TaskTypeWaveform {
		t.Fatalf("type = %q", task.Type())
	}
	var p Payload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.LibraryID != "lib" || p.FileID != "file" {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestNewServiceAndHandler(t *testing.T) {
	s := NewService(nil, nil, nil, testConfig(), nil)
	if s == nil {
		t.Fatal("NewService nil")
	}
	h := s.NewTaskHandler()
	if h == nil {
		t.Fatal("NewTaskHandler nil")
	}
}

func TestProcessTask_InvalidPayload(t *testing.T) {
	h := NewTaskHandler(nil, nil, testConfig(), nil)
	task := asynq.NewTask(TaskTypeWaveform, []byte("not json"))
	if err := h.ProcessTask(context.Background(), task); err == nil {
		t.Fatalf("expected error for invalid payload")
	}
}

func TestComputePeaks_WindowSizeFloorAtOne(t *testing.T) {
	// peaksPerSec absurdly large → windowSize computes < 1 → floored to 1.
	h := &TaskHandler{}
	dir := t.TempDir()
	path := filepath.Join(dir, "a.pcm")
	// 8 bytes → 2 float32 samples.
	if err := os.WriteFile(path, []byte{0, 0, 0, 0, 0, 0, 0, 0}, 0o644); err != nil {
		t.Fatal(err)
	}
	peaks, err := h.computePeaks(path, 1_000_000)
	if err != nil {
		t.Fatalf("computePeaks: %v", err)
	}
	if len(peaks) != 2 {
		t.Fatalf("expected 2 peaks with windowSize=1, got %d", len(peaks))
	}
}

func TestComputePeaks_MissingFile(t *testing.T) {
	h := &TaskHandler{}
	if _, err := h.computePeaks("/nonexistent/x.pcm", defaultPeaksPerSecond); err == nil {
		t.Fatalf("expected error for missing pcm file")
	}
}

// ---------------------------------------------------------------------------
// ffmpeg-backed methods
// ---------------------------------------------------------------------------

func TestProbeAudioStream_WithAudio(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genAudio(t, dir, "a.wav")
	h := NewTaskHandler(nil, nil, testConfig(), nil)
	has, err := h.probeAudioStream(context.Background(), src)
	if err != nil {
		t.Fatalf("probeAudioStream: %v", err)
	}
	if !has {
		t.Fatalf("expected audio stream detected")
	}
}

// TestProbeAudioStream_VideoOnly documents a SOURCE BUG: probeAudioStream
// checks ffmpeg stderr for the substring "Stream #0", but a video-only file
// also prints "Stream #0:0" for its VIDEO stream. So probeAudioStream wrongly
// reports hasAudio=true for a file that has no audio track. This test locks in
// the current (buggy) behavior — see report. The correct check would look for
// "Audio:" / "Stream #0:N(...): Audio" specifically.
func TestProbeAudioStream_VideoOnly_BugReturnsTrue(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genSilentVideo(t, dir, "v.mp4")
	h := NewTaskHandler(nil, nil, testConfig(), nil)
	has, err := h.probeAudioStream(context.Background(), src)
	if err != nil {
		t.Fatalf("probeAudioStream: %v", err)
	}
	if !has {
		t.Fatalf("BUG REGRESSION FIXED? probeAudioStream now correctly reports no audio for a video-only file; update this test")
	}
}

func TestExtractPCM(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genAudio(t, dir, "a.wav")
	dst := filepath.Join(dir, "a.pcm")
	h := NewTaskHandler(nil, nil, testConfig(), nil)
	if err := h.extractPCM(context.Background(), src, dst); err != nil {
		t.Fatalf("extractPCM: %v", err)
	}
	info, err := os.Stat(dst)
	if err != nil || info.Size() == 0 {
		t.Fatalf("expected non-empty pcm: %v", err)
	}
	if info.Size()%4 != 0 {
		t.Fatalf("pcm size not multiple of 4: %d", info.Size())
	}
}

func TestExtractPCM_BadInput(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.wav")
	if err := os.WriteFile(bad, []byte("not audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "out.pcm")
	h := NewTaskHandler(nil, nil, testConfig(), nil)
	if err := h.extractPCM(context.Background(), bad, dst); err == nil {
		t.Fatalf("expected error for bad input")
	}
}

func TestCopySourceToTemp(t *testing.T) {
	store := setupTestStorage(t)
	if err := store.StoreFile("lib", "file", []byte("hello waveform")); err != nil {
		t.Fatal(err)
	}
	h := NewTaskHandler(nil, store, testConfig(), nil)
	dir := t.TempDir()
	dst := filepath.Join(dir, "out")
	if err := h.copySourceToTemp("lib", "file", dst); err != nil {
		t.Fatalf("copySourceToTemp: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil || string(data) != "hello waveform" {
		t.Fatalf("copied content mismatch: %q (%v)", data, err)
	}
}

func TestCopySourceToTemp_MissingBlob(t *testing.T) {
	store := setupTestStorage(t)
	h := NewTaskHandler(nil, store, testConfig(), nil)
	dir := t.TempDir()
	dst := filepath.Join(dir, "out")
	if err := h.copySourceToTemp("lib", "missing", dst); err == nil {
		t.Fatalf("expected error for missing blob")
	}
}

// ---------------------------------------------------------------------------
// State writers
// ---------------------------------------------------------------------------

func TestSetStateAndFail(t *testing.T) {
	db := setupTestDB(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "a.wav", MimeType: "audio/wav", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	h := NewTaskHandler(db, nil, testConfig(), nil)

	p := 7
	h.setState(f.ID.String(), stringPtr("processing"), &p, nil)
	var updated models.File
	db.Where("id = ?", f.ID).First(&updated)
	if updated.WaveformStatus == nil || *updated.WaveformStatus != "processing" {
		t.Fatalf("status not set: %v", updated.WaveformStatus)
	}

	h.fail(f.ID.String(), context.DeadlineExceeded)
	db.Where("id = ?", f.ID).First(&updated)
	if updated.WaveformStatus == nil || *updated.WaveformStatus != "failed" {
		t.Fatalf("status not failed: %v", updated.WaveformStatus)
	}
	if updated.WaveformError == nil {
		t.Fatalf("expected waveform error set")
	}
}

func TestComplete(t *testing.T) {
	db := setupTestDB(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "a.wav", MimeType: "audio/wav", OwnerID: &ownerID, WaveformVersion: 3}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	// Wire a real activity service (nil hub/bus is fine) so the EmitAsync
	// branch in complete() is exercised.
	actSvc := activity.NewService(db, nil, nil)
	h := NewTaskHandler(db, nil, testConfig(), actSvc)
	h.complete(f.ID.String(), 3, defaultPeaksPerSecond)
	// EmitAsync is detached; give the goroutine a moment to run.
	time.Sleep(100 * time.Millisecond)
	var updated models.File
	db.Where("id = ?", f.ID).First(&updated)
	if updated.WaveformStatus == nil || *updated.WaveformStatus != "ready" {
		t.Fatalf("status not ready: %v", updated.WaveformStatus)
	}
	if updated.WaveformedVersion == nil || *updated.WaveformedVersion != 3 {
		t.Fatalf("waveformed_version not set: %v", updated.WaveformedVersion)
	}
	if updated.WaveformPeaksPerSecond != defaultPeaksPerSecond {
		t.Fatalf("peaks per second wrong: %d", updated.WaveformPeaksPerSecond)
	}
}

func TestStoreEmptyWaveform(t *testing.T) {
	store := setupTestStorage(t)
	h := NewTaskHandler(nil, store, testConfig(), nil)
	// Should not panic; writes an empty-peaks waveform JSON to cache.
	h.storeEmptyWaveform("lib", "file")
}

// ---------------------------------------------------------------------------
// Full run() flow
// ---------------------------------------------------------------------------

func TestRun_NotFound(t *testing.T) {
	db := setupTestDB(t)
	h := NewTaskHandler(db, nil, testConfig(), nil)
	if err := h.run(context.Background(), uuid.NewString(), uuid.NewString()); err != nil {
		t.Fatalf("expected nil for not found, got %v", err)
	}
}

func TestRun_NotAudioOrVideo(t *testing.T) {
	db := setupTestDB(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "doc.txt", MimeType: "text/plain", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	h := NewTaskHandler(db, nil, testConfig(), nil)
	if err := h.run(context.Background(), libID.String(), f.ID.String()); err != nil {
		t.Fatalf("expected nil for non-media, got %v", err)
	}
}

func TestRun_OpenSourceFails(t *testing.T) {
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "a.wav", MimeType: "audio/wav", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	// Did not store blob → copySourceToTemp fails.
	h := NewTaskHandler(db, store, testConfig(), nil)
	if err := h.run(context.Background(), libID.String(), f.ID.String()); err == nil {
		t.Fatalf("expected error when source blob missing")
	}
	var updated models.File
	db.Where("id = ?", f.ID).First(&updated)
	if updated.WaveformStatus == nil || *updated.WaveformStatus != "failed" {
		t.Fatalf("expected failed status, got %v", updated.WaveformStatus)
	}
}

// TestRun_VideoOnly_FailsViaExtractPCM documents the downstream effect of the
// probeAudioStream bug: because a video-only file is mis-detected as having
// audio, run() proceeds to extractPCM, which fails ("Output file does not
// contain any stream"), so the file is marked "failed" instead of "ready" with
// an empty waveform. The storeEmptyWaveform branch is therefore unreachable for
// genuine no-audio files. This locks in current behavior.
func TestRun_VideoOnly_FailsViaExtractPCM(t *testing.T) {
	ffmpegAvailable(t)
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)

	dir := t.TempDir()
	src := genSilentVideo(t, dir, "v.mp4")
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "v.mp4", MimeType: "video/mp4", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.StoreFile(libID.String(), f.ID.String(), data); err != nil {
		t.Fatal(err)
	}

	h := NewTaskHandler(db, store, testConfig(), nil)
	// Mis-detected audio → extractPCM fails → run returns an error.
	if err := h.run(context.Background(), libID.String(), f.ID.String()); err == nil {
		t.Fatalf("expected error from extractPCM on a video-only file (bug); got nil")
	}
	var updated models.File
	db.Where("id = ?", f.ID).First(&updated)
	if updated.WaveformStatus == nil || *updated.WaveformStatus != "failed" {
		t.Fatalf("expected failed status, got %v", updated.WaveformStatus)
	}
}

// TestStoreEmptyWaveform_DirectlyCovered exercises the storeEmptyWaveform +
// complete branch that run() would take if probeAudioStream were correct.
func TestStoreEmptyWaveform_DirectlyCovered(t *testing.T) {
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "x.wav", MimeType: "audio/wav", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	h := NewTaskHandler(db, store, testConfig(), nil)
	h.storeEmptyWaveform(libID.String(), f.ID.String())
	h.complete(f.ID.String(), 0, defaultPeaksPerSecond)
	exists, err := store.CacheExists(libID.String() + "/" + f.ID.String() + "/waveform.json")
	if err != nil || !exists {
		t.Fatalf("expected empty waveform cache: %v %v", exists, err)
	}
}

func TestRun_WithAudioFullFlow(t *testing.T) {
	ffmpegAvailable(t)
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)

	dir := t.TempDir()
	src := genAudio(t, dir, "a.wav")
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "a.wav", MimeType: "audio/wav", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.StoreFile(libID.String(), f.ID.String(), data); err != nil {
		t.Fatal(err)
	}

	h := NewTaskHandler(db, store, testConfig(), nil)
	if err := h.run(context.Background(), libID.String(), f.ID.String()); err != nil {
		t.Fatalf("run: %v", err)
	}
	var updated models.File
	db.Where("id = ?", f.ID).First(&updated)
	if updated.WaveformStatus == nil || *updated.WaveformStatus != "ready" {
		t.Fatalf("expected ready, got %v", updated.WaveformStatus)
	}

	// Verify waveform JSON cache exists.
	exists, err := store.CacheExists(libID.String() + "/" + f.ID.String() + "/waveform.json")
	if err != nil || !exists {
		t.Fatalf("expected waveform cache to exist: %v %v", exists, err)
	}
}

func TestProcessTask_ValidPayload(t *testing.T) {
	db := setupTestDB(t)
	h := NewTaskHandler(db, nil, testConfig(), nil)
	task, err := NewWaveformTask(uuid.NewString(), uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	// File not found → run returns nil.
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Fatalf("ProcessTask: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

func TestEnqueueWaveform(t *testing.T) {
	client := newAsynqClient(t)
	s := NewService(nil, nil, client, testConfig(), nil)
	if err := s.EnqueueWaveform("lib-1", "file-1"); err != nil {
		t.Fatalf("EnqueueWaveform: %v", err)
	}
}

func TestCompletedTaskRetentionConstant(t *testing.T) {
	if completedTaskRetention != 24*time.Hour {
		t.Fatalf("unexpected retention: %v", completedTaskRetention)
	}
}
