package videoproxy

import (
	"context"
	"encoding/json"
	"fmt"
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
// Test helpers
// ---------------------------------------------------------------------------

// This package's tests run against a private, uniquely-named Postgres database
// created once per test binary. That isolates us from other parallel test
// processes (other agents) that TRUNCATE the shared alcoves_test database.

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
	name := "vp_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	// Probe availability first so we Skip (not Fail) when no DB is present.
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
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not available")
	}
}

// genVideo creates a tiny mp4 (h264 + aac) ~2s long, tagged BT.709 SDR so the
// thumbnail seek (-ss 00:00:01) lands on a real frame.
func genVideo(t *testing.T, dir, name string, withAudio bool) string {
	t.Helper()
	out := filepath.Join(dir, name)
	var args []string
	if withAudio {
		args = []string{
			"-f", "lavfi", "-i", "testsrc=duration=2:size=128x128:rate=10",
			"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
			"-shortest", "-vf", "format=yuv420p",
			"-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
			"-c:v", "libx264", "-pix_fmt", "yuv420p",
			"-c:a", "aac", "-y", out,
		}
	} else {
		args = []string{
			"-f", "lavfi", "-i", "testsrc=duration=2:size=128x128:rate=10",
			"-vf", "format=yuv420p",
			"-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
			"-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-y", out,
		}
	}
	cmd := exec.Command("ffmpeg", args...)
	if combined, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg gen video failed: %v\n%s", err, combined)
	}
	return out
}

// webpSupported reports whether this ffmpeg build can encode libwebp. Some
// builds (notably the homebrew one in CI) omit zimg/zscale and libwebp, which
// makes generateThumbnail (webp) unable to succeed; the JPEG path still works
// via the simple-scale fallback.
func webpSupported() bool {
	cmd := exec.Command("ffmpeg", "-hide_banner", "-encoders")
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "libwebp")
}

func uuidPtr(u uuid.UUID) *uuid.UUID { return &u }

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

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

func TestBuildProxyName(t *testing.T) {
	got := buildProxyName("my.video.mov")
	if !strings.HasPrefix(got, "my.video_proxy_") || !strings.HasSuffix(got, ".mp4") {
		t.Fatalf("buildProxyName = %q", got)
	}
	// No extension.
	got2 := buildProxyName("noext")
	if !strings.HasPrefix(got2, "noext_proxy_") || !strings.HasSuffix(got2, ".mp4") {
		t.Fatalf("buildProxyName(noext) = %q", got2)
	}
	// Leading dot only (idx == 0 → base unchanged).
	got3 := buildProxyName(".hidden")
	if !strings.HasPrefix(got3, ".hidden_proxy_") {
		t.Fatalf("buildProxyName(.hidden) = %q", got3)
	}
}

func TestBuildThumbnailName(t *testing.T) {
	got := buildThumbnailName("clip.mkv")
	if !strings.HasPrefix(got, "clip_thumbnail_") || !strings.HasSuffix(got, ".jpg") {
		t.Fatalf("buildThumbnailName = %q", got)
	}
	got2 := buildThumbnailName("noext")
	if !strings.HasPrefix(got2, "noext_thumbnail_") {
		t.Fatalf("buildThumbnailName(noext) = %q", got2)
	}
}

// NOTE: out_time/speed parsing moved to internal/services/ffmpeg; its tests now
// live in that package (ffmpeg_test.go).

func TestHasAudioStream(t *testing.T) {
	type stream = struct {
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
		Height    int    `json:"height"`
	}
	if hasAudioStream([]stream{{CodecType: "video"}}) {
		t.Errorf("expected no audio")
	}
	if !hasAudioStream([]stream{{CodecType: "video"}, {CodecType: "audio"}}) {
		t.Errorf("expected audio")
	}
}

func TestNewVideoProxyTask(t *testing.T) {
	task, err := NewVideoProxyTask("lib", "file", true)
	if err != nil {
		t.Fatalf("NewVideoProxyTask: %v", err)
	}
	if task.Type() != TaskTypeVideoProxy {
		t.Fatalf("type = %q", task.Type())
	}
	var p VideoProxyPayload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.LibraryID != "lib" || p.FileID != "file" || !p.Force {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestNewVideoThumbnailTask(t *testing.T) {
	task, err := NewVideoThumbnailTask("lib", "file")
	if err != nil {
		t.Fatalf("NewVideoThumbnailTask: %v", err)
	}
	if task.Type() != TaskTypeVideoThumb {
		t.Fatalf("type = %q", task.Type())
	}
	var p VideoThumbnailPayload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.LibraryID != "lib" || p.FileID != "file" {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestNewServiceAndTaskHandler(t *testing.T) {
	svc := NewService(nil, nil, nil, nil)
	if svc == nil {
		t.Fatal("NewService returned nil")
	}
	h := svc.NewTaskHandler()
	if h == nil {
		t.Fatal("NewTaskHandler returned nil")
	}
}

// ---------------------------------------------------------------------------
// ffprobe / ffmpeg exec paths
// ---------------------------------------------------------------------------

func TestProbeVideo_NeedsTranscodeNonMP4(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "clip.mp4", true)
	// Remux h264 into a matroska container (non-.mp4 extension) → forces the
	// show_format probe branch, and matroska is not web-compatible → transcode.
	mkv := filepath.Join(dir, "clip.mkv")
	cmd := exec.Command("ffmpeg", "-i", src, "-c", "copy", "-y", mkv)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("mkv remux unavailable: %v\n%s", err, out)
	}
	needs, height, err := probeVideo(context.Background(), mkv)
	if err != nil {
		t.Fatalf("probeVideo: %v", err)
	}
	if !needs {
		t.Errorf("expected matroska container to need transcode")
	}
	if height <= 0 {
		t.Errorf("expected positive height, got %d", height)
	}
}

func TestProbeVideo_MovExtensionNoExtBranch(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "clip.mp4", true)
	// Same h264/aac content but renamed without .mp4 extension → exercises the
	// show_format branch which detects mov/mp4 format_name and stays compatible.
	noExt := filepath.Join(dir, "clip_noext")
	if err := os.Rename(src, noExt); err != nil {
		t.Fatal(err)
	}
	needs, _, err := probeVideo(context.Background(), noExt)
	if err != nil {
		t.Fatalf("probeVideo: %v", err)
	}
	if needs {
		t.Errorf("expected mp4-format content (no extension) to be web-compatible")
	}
}

func TestProbeVideo_MP4WebCompatible(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "clip.mp4", true)
	needs, height, err := probeVideo(context.Background(), src)
	if err != nil {
		t.Fatalf("probeVideo: %v", err)
	}
	if needs {
		t.Errorf("expected h264/aac mp4 to be web-compatible (needs=false)")
	}
	if height != 128 {
		t.Errorf("expected height 128, got %d", height)
	}
}

func TestProbeVideo_MissingFile(t *testing.T) {
	ffmpegAvailable(t)
	needs, _, err := probeVideo(context.Background(), "/nonexistent/file.mp4")
	if err == nil {
		t.Fatalf("expected error for missing file")
	}
	if !needs {
		t.Errorf("expected needsTranscode=true on error")
	}
}

func TestProbeDurationSeconds(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "clip.mp4", true)
	dur, err := probeDurationSeconds(context.Background(), src)
	if err != nil {
		t.Fatalf("probeDurationSeconds: %v", err)
	}
	if dur <= 0 || dur > 5 {
		t.Errorf("unexpected duration %v", dur)
	}
}

func TestProbeDurationSeconds_MissingFile(t *testing.T) {
	ffmpegAvailable(t)
	if _, err := probeDurationSeconds(context.Background(), "/nonexistent/x.mp4"); err == nil {
		t.Fatalf("expected error for missing file")
	}
}

func TestTranscodeVideo(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4", true)
	dst := filepath.Join(dir, "out.mp4")

	var progresses []int
	err := transcodeVideo(context.Background(), src, dst, 128, 1.0, func(progress int, eta *int) {
		progresses = append(progresses, progress)
	})
	if err != nil {
		t.Fatalf("transcodeVideo: %v", err)
	}
	info, err := os.Stat(dst)
	if err != nil || info.Size() == 0 {
		t.Fatalf("expected non-empty output: %v", err)
	}
	// final callback should hit 100
	if len(progresses) == 0 || progresses[len(progresses)-1] != 100 {
		t.Errorf("expected final progress 100, got %v", progresses)
	}
}

func TestTranscodeVideo_ScaleDownTallSource(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4", false)
	dst := filepath.Join(dir, "out.mp4")
	// sourceHeight > maxHeight triggers the scale filter branch.
	err := transcodeVideo(context.Background(), src, dst, 2000, 0, nil)
	if err != nil {
		t.Fatalf("transcodeVideo (scale): %v", err)
	}
	if info, err := os.Stat(dst); err != nil || info.Size() == 0 {
		t.Fatalf("expected non-empty output: %v", err)
	}
}

func TestTranscodeVideo_BadInput(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.mp4")
	if err := os.WriteFile(bad, []byte("not a video"), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "out.mp4")
	if err := transcodeVideo(context.Background(), bad, dst, 100, 1.0, nil); err == nil {
		t.Fatalf("expected ffmpeg error on bad input")
	}
}

func TestGenerateThumbnail(t *testing.T) {
	ffmpegAvailable(t)
	if !webpSupported() {
		t.Skip("ffmpeg build lacks libwebp encoder; generateThumbnail (webp) cannot succeed")
	}
	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4", false)
	thumb := filepath.Join(dir, "thumb.webp")
	if err := generateThumbnail(context.Background(), src, thumb); err != nil {
		t.Fatalf("generateThumbnail: %v", err)
	}
	if info, err := os.Stat(thumb); err != nil || info.Size() == 0 {
		t.Fatalf("expected thumbnail: %v", err)
	}
}

// TestGenerateThumbnail_AllStrategiesFail exercises the error branch where
// every webp strategy fails (here because this ffmpeg build lacks libwebp).
func TestGenerateThumbnail_AllStrategiesFail(t *testing.T) {
	ffmpegAvailable(t)
	if webpSupported() {
		t.Skip("libwebp available; cannot exercise the all-strategies-failed branch this way")
	}
	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4", false)
	thumb := filepath.Join(dir, "thumb.webp")
	if err := generateThumbnail(context.Background(), src, thumb); err == nil {
		t.Fatalf("expected generateThumbnail to fail without libwebp")
	}
}

func TestGenerateThumbnail_BadInput(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.dat")
	if err := os.WriteFile(bad, []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	thumb := filepath.Join(dir, "thumb.webp")
	if err := generateThumbnail(context.Background(), bad, thumb); err == nil {
		t.Fatalf("expected error for bad input")
	}
}

func TestGenerateJPEGThumbnail(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	src := genVideo(t, dir, "src.mp4", false)
	thumb := filepath.Join(dir, "thumb.jpg")
	if err := generateJPEGThumbnail(context.Background(), src, thumb); err != nil {
		t.Fatalf("generateJPEGThumbnail: %v", err)
	}
	if info, err := os.Stat(thumb); err != nil || info.Size() == 0 {
		t.Fatalf("expected jpeg thumbnail: %v", err)
	}
}

func TestGenerateJPEGThumbnail_BadInput(t *testing.T) {
	ffmpegAvailable(t)
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.dat")
	if err := os.WriteFile(bad, []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	thumb := filepath.Join(dir, "thumb.jpg")
	if err := generateJPEGThumbnail(context.Background(), bad, thumb); err == nil {
		t.Fatalf("expected error for bad input")
	}
}

// ---------------------------------------------------------------------------
// DB-backed handler flows
// ---------------------------------------------------------------------------

func TestProcessTask_InvalidPayload(t *testing.T) {
	h := NewTaskHandler(nil, nil, nil)
	task := asynq.NewTask(TaskTypeVideoProxy, []byte("not json"))
	if err := h.ProcessTask(context.Background(), task); err == nil {
		t.Fatalf("expected error for invalid payload")
	}
}

func TestProcessThumbnailTask_InvalidPayload(t *testing.T) {
	h := NewTaskHandler(nil, nil, nil)
	task := asynq.NewTask(TaskTypeVideoThumb, []byte("not json"))
	if err := h.ProcessTask(context.Background(), task); err == nil {
		// ProcessTask path; ensure ProcessThumbnailTask too
	}
	if err := h.ProcessThumbnailTask(context.Background(), task); err == nil {
		t.Fatalf("expected error for invalid thumbnail payload")
	}
}

func TestProcessTask_ValidPayloadNotFound(t *testing.T) {
	db := setupTestDB(t)
	h := NewTaskHandler(db, nil, nil)
	task, err := NewVideoProxyTask(uuid.NewString(), uuid.NewString(), false)
	if err != nil {
		t.Fatal(err)
	}
	// File not found → processVideo returns nil.
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Fatalf("ProcessTask: %v", err)
	}
}

func TestProcessThumbnailTask_ValidPayloadNotFound(t *testing.T) {
	db := setupTestDB(t)
	h := NewTaskHandler(db, nil, nil)
	task, err := NewVideoThumbnailTask(uuid.NewString(), uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	if err := h.ProcessThumbnailTask(context.Background(), task); err != nil {
		t.Fatalf("ProcessThumbnailTask: %v", err)
	}
}

func TestProcessVideo_FileNotFound(t *testing.T) {
	db := setupTestDB(t)
	h := NewTaskHandler(db, nil, nil)
	// Random IDs → not found → returns nil (skip).
	if err := h.processVideo(context.Background(), uuid.NewString(), uuid.NewString(), false); err != nil {
		t.Fatalf("expected nil for not found, got %v", err)
	}
}

func TestProcessVideo_NotAVideo(t *testing.T) {
	db := setupTestDB(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "doc.txt", MimeType: "text/plain", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	h := NewTaskHandler(db, nil, nil)
	if err := h.processVideo(context.Background(), libID.String(), f.ID.String(), false); err != nil {
		t.Fatalf("expected nil for non-video, got %v", err)
	}
}

func TestProcessVideo_AlreadyReady(t *testing.T) {
	db := setupTestDB(t)
	libID, ownerID := seedLibrary(t, db)
	ready := "ready"
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "v.mp4", MimeType: "video/mp4", OwnerID: &ownerID, ProxyStatus: &ready}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	h := NewTaskHandler(db, nil, nil)
	if err := h.processVideo(context.Background(), libID.String(), f.ID.String(), false); err != nil {
		t.Fatalf("expected nil for already ready, got %v", err)
	}
}

func TestProcessVideo_WebCompatibleNotNeeded(t *testing.T) {
	ffmpegAvailable(t)
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)

	// Create an actual web-compatible mp4 and store it.
	dir := t.TempDir()
	src := genVideo(t, dir, "clip.mp4", true)
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "clip.mp4", MimeType: "video/mp4", OwnerID: &ownerID, Size: int64(len(data))}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	if err := store.StoreFile(libID.String(), f.ID.String(), data); err != nil {
		t.Fatalf("store file: %v", err)
	}

	h := NewTaskHandler(db, store, nil)
	if err := h.processVideo(context.Background(), libID.String(), f.ID.String(), false); err != nil {
		t.Fatalf("processVideo: %v", err)
	}

	var updated models.File
	if err := db.Where("id = ?", f.ID).First(&updated).Error; err != nil {
		t.Fatal(err)
	}
	if updated.ProxyStatus == nil || *updated.ProxyStatus != "not_needed" {
		t.Fatalf("expected proxy_status not_needed, got %v", updated.ProxyStatus)
	}
}

func TestProcessVideo_ForceTranscode(t *testing.T) {
	ffmpegAvailable(t)
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)

	dir := t.TempDir()
	src := genVideo(t, dir, "clip.mp4", true)
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "clip.mp4", MimeType: "video/mp4", OwnerID: &ownerID, Size: int64(len(data))}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	if err := store.StoreFile(libID.String(), f.ID.String(), data); err != nil {
		t.Fatalf("store file: %v", err)
	}

	h := NewTaskHandler(db, store, nil)
	// force=true → full transcode path, creates proxy file + stores it + thumbnail.
	if err := h.processVideo(context.Background(), libID.String(), f.ID.String(), true); err != nil {
		t.Fatalf("processVideo force: %v", err)
	}

	var updated models.File
	if err := db.Where("id = ?", f.ID).First(&updated).Error; err != nil {
		t.Fatal(err)
	}
	if updated.ProxyStatus == nil || *updated.ProxyStatus != "ready" {
		t.Fatalf("expected proxy_status ready, got %v", updated.ProxyStatus)
	}

	// A proxy file (source_file_id pointer) should exist.
	var proxyCount int64
	db.Model(&models.File{}).Where("source_file_id = ?", f.ID).Count(&proxyCount)
	if proxyCount == 0 {
		t.Fatalf("expected a proxy file record")
	}
}

func TestProcessVideo_StorageOpenFails(t *testing.T) {
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "v.mp4", MimeType: "video/mp4", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	// Did NOT store the underlying blob → OpenFileReadStream should fail.
	h := NewTaskHandler(db, store, nil)
	if err := h.processVideo(context.Background(), libID.String(), f.ID.String(), false); err == nil {
		t.Fatalf("expected error when source blob missing")
	}
	var updated models.File
	db.Where("id = ?", f.ID).First(&updated)
	if updated.ProxyStatus == nil || *updated.ProxyStatus != "failed" {
		t.Fatalf("expected proxy_status failed, got %v", updated.ProxyStatus)
	}
}

func TestProcessVideoThumbnail_Flow(t *testing.T) {
	ffmpegAvailable(t)
	db := setupTestDB(t)
	store := setupTestStorage(t)
	libID, ownerID := seedLibrary(t, db)

	dir := t.TempDir()
	src := genVideo(t, dir, "clip.mp4", false)
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "clip.mp4", MimeType: "video/mp4", OwnerID: &ownerID, Size: int64(len(data))}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	if err := store.StoreFile(libID.String(), f.ID.String(), data); err != nil {
		t.Fatal(err)
	}

	h := NewTaskHandler(db, store, nil)
	if err := h.processVideoThumbnail(context.Background(), libID.String(), f.ID.String()); err != nil {
		t.Fatalf("processVideoThumbnail: %v", err)
	}

	var updated models.File
	if err := db.Where("id = ?", f.ID).First(&updated).Error; err != nil {
		t.Fatal(err)
	}
	if updated.ThumbnailFileID == nil {
		t.Fatalf("expected thumbnail_file_id set")
	}
}

func TestProcessVideoThumbnail_SkipDerivative(t *testing.T) {
	db := setupTestDB(t)
	libID, ownerID := seedLibrary(t, db)
	// A derivative file (SourceFileID set) should be skipped.
	parent := uuid.New()
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "v.mp4", MimeType: "video/mp4", OwnerID: &ownerID, SourceFileID: uuidPtr(parent)}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	h := NewTaskHandler(db, nil, nil)
	if err := h.processVideoThumbnail(context.Background(), libID.String(), f.ID.String()); err != nil {
		t.Fatalf("expected nil for derivative skip, got %v", err)
	}
}

func TestProcessVideoThumbnail_NotFound(t *testing.T) {
	db := setupTestDB(t)
	h := NewTaskHandler(db, nil, nil)
	if err := h.processVideoThumbnail(context.Background(), uuid.NewString(), uuid.NewString()); err != nil {
		t.Fatalf("expected nil for not found, got %v", err)
	}
}

func TestSetProxyState(t *testing.T) {
	db := setupTestDB(t)
	libID, ownerID := seedLibrary(t, db)
	f := models.File{BaseModel: models.BaseModel{ID: uuid.New()}, LibraryID: libID, Name: "v.mp4", MimeType: "video/mp4", OwnerID: &ownerID}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	h := NewTaskHandler(db, nil, nil)
	p := 42
	eta := 10
	h.setProxyState(f.ID.String(), "processing", &p, &eta)
	var updated models.File
	db.Where("id = ?", f.ID).First(&updated)
	if updated.ProxyStatus == nil || *updated.ProxyStatus != "processing" {
		t.Fatalf("status not set: %v", updated.ProxyStatus)
	}
	if updated.ProxyProgress == nil || *updated.ProxyProgress != 42 {
		t.Fatalf("progress not set: %v", updated.ProxyProgress)
	}
}

func TestStoreThumbnail(t *testing.T) {
	store := setupTestStorage(t)
	dir := t.TempDir()
	thumb := filepath.Join(dir, "t.webp")
	if err := os.WriteFile(thumb, []byte("thumbdata"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := NewTaskHandler(nil, store, nil)
	// Should not panic and should store the cache buffer.
	h.storeThumbnail("lib", "file", thumb)

	// Missing file path → logged, no panic.
	h.storeThumbnail("lib", "file", filepath.Join(dir, "missing.webp"))
}

func TestCompletedTaskRetentionConstant(t *testing.T) {
	if completedTaskRetention != 24*time.Hour {
		t.Fatalf("unexpected retention: %v", completedTaskRetention)
	}
}
