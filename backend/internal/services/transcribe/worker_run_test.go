package transcribe

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// ---------------------------------------------------------------------------
// DB + storage fixtures
// ---------------------------------------------------------------------------

// workerDB opens the shared test Postgres but isolates this test in a
// dedicated, uniquely-named schema. This is critical because OTHER coverage
// agents run their suites against the same alcoves_test database in parallel
// and some of them `DELETE FROM files` / truncate tables; without isolation a
// concurrent wipe would delete our just-seeded rows mid-test (observed as
// flaky "file not found or trashed" failures under load). Each test gets its
// own schema dropped on cleanup, so cross-agent DML can never touch our rows.
func workerDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(postgres.Open(testDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("db not available: %v", err)
	}

	// search_path is per-connection state, so pin the pool to a single
	// connection — otherwise pooled statements could land on a connection
	// without our schema on the path.
	if sqlDB, derr := db.DB(); derr == nil {
		sqlDB.SetMaxOpenConns(1)
		sqlDB.SetMaxIdleConns(1)
	}

	schema := "tx_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := db.Exec("CREATE SCHEMA IF NOT EXISTS " + schema).Error; err != nil {
		t.Skipf("create schema: %v", err)
	}
	// Route all unqualified table references to our private schema. We keep
	// public on the path so shared extensions / gen_random_uuid resolve.
	if err := db.Exec("SET search_path TO " + schema + ", public").Error; err != nil {
		t.Fatalf("set search_path: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Exec("DROP SCHEMA IF EXISTS " + schema + " CASCADE").Error
		if sqlDB, derr := db.DB(); derr == nil {
			_ = sqlDB.Close()
		}
	})

	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.File{}); err != nil {
		t.Fatalf("auto-migrate: %v", err)
	}
	return db
}

// seedFile inserts a library + file and returns their IDs.
func seedFile(t *testing.T, db *gorm.DB, mime string) (libID, fileID uuid.UUID) {
	t.Helper()
	userID := uuid.New()
	if err := db.Create(&models.User{
		ID:          userID,
		Email:       userID.String()[:12] + "@test.com",
		DisplayName: "Transcribe Test User",
		Role:        "owner",
	}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	libID = uuid.New()
	if err := db.Create(&models.Library{ID: libID, Name: "Transcribe Lib", OwnerID: userID}).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	f := models.File{
		LibraryID: libID,
		OwnerID:   &userID,
		Name:      "clip",
		MimeType:  mime,
		Size:      1,
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	return libID, f.ID
}

// localStorage builds a storage.Service backed by a temp dir.
func localStorage(t *testing.T) (*storage.Service, string) {
	t.Helper()
	root := t.TempDir()
	driver := storage.NewLocalDriver(
		filepath.Join(root, "files"),
		filepath.Join(root, "avatars"),
		filepath.Join(root, "cache"),
	)
	if err := driver.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	return storage.NewService(driver), root
}

func ffmpegBin() string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	if _, err := os.Stat("/opt/homebrew/bin/ffmpeg"); err == nil {
		return "/opt/homebrew/bin/ffmpeg"
	}
	return ""
}

// makeWav generates a 1s mono 16kHz PCM WAV using ffmpeg.
func makeWav(t *testing.T, dir string) string {
	t.Helper()
	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	out := filepath.Join(dir, "tone.wav")
	cmd := exec.Command(ff,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=1",
		"-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le",
		out,
	)
	if outBytes, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg make wav: %v: %s", err, outBytes)
	}
	return out
}

// ---------------------------------------------------------------------------
// run() branches
// ---------------------------------------------------------------------------

func TestRun_FileNotFound_ReturnsNil(t *testing.T) {
	db := workerDB(t)
	h := NewTaskHandler(db, nil, &config.Config{}, nil, nil)
	// Random IDs that won't match any row → gorm.ErrRecordNotFound → nil.
	if err := h.run(context.Background(), uuid.NewString(), uuid.NewString()); err != nil {
		t.Errorf("expected nil for missing file, got %v", err)
	}
}

func TestRun_TrashedFile_SkippedAsNotFound(t *testing.T) {
	db := workerDB(t)
	libID, fileID := seedFile(t, db, "video/mp4")
	now := time.Now()
	db.Model(&models.File{}).Where("id = ?", fileID).Update("trashed_at", now)

	h := NewTaskHandler(db, nil, &config.Config{}, nil, nil)
	if err := h.run(context.Background(), libID.String(), fileID.String()); err != nil {
		t.Errorf("trashed file should be skipped as not-found, got %v", err)
	}
}

func TestRun_NonAudioVideoMime_Skips(t *testing.T) {
	db := workerDB(t)
	libID, fileID := seedFile(t, db, "image/png")
	h := NewTaskHandler(db, nil, &config.Config{}, nil, nil)
	if err := h.run(context.Background(), libID.String(), fileID.String()); err != nil {
		t.Errorf("non-av file should skip with nil, got %v", err)
	}
	// Status should remain untouched (nil), since we returned before setState.
	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus != nil {
		t.Errorf("expected nil status for skipped file, got %v", *f.TranscribeStatus)
	}
}

func TestRun_CopySourceFails_MarksFailed(t *testing.T) {
	db := workerDB(t)
	store, _ := localStorage(t)
	libID, fileID := seedFile(t, db, "audio/mpeg")
	// No blob stored → OpenFileReadStream errors → copySourceToTemp fails.
	h := NewTaskHandler(db, store, &config.Config{FFmpegBinaryPath: ffmpegBin()}, nil, nil)

	err := h.run(context.Background(), libID.String(), fileID.String())
	if err == nil {
		t.Fatal("expected error when source blob is missing")
	}
	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "failed" {
		t.Errorf("expected status=failed, got %v", f.TranscribeStatus)
	}
	if f.TranscribeError == nil || *f.TranscribeError == "" {
		t.Errorf("expected non-empty error message")
	}
}

func TestRun_FFmpegExtractFails_MarksFailed(t *testing.T) {
	db := workerDB(t)
	store, _ := localStorage(t)
	libID, fileID := seedFile(t, db, "video/mp4")
	// Store a blob that is NOT decodable audio/video so ffmpeg fails.
	if err := store.StoreFile(libID.String(), fileID.String(), []byte("not a real media file")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	h := NewTaskHandler(db, store, &config.Config{FFmpegBinaryPath: ff}, nil, nil)

	err := h.run(context.Background(), libID.String(), fileID.String())
	if err == nil {
		t.Fatal("expected ffmpeg extract error on bogus media")
	}
	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "failed" {
		t.Errorf("expected status=failed after ffmpeg failure, got %v", f.TranscribeStatus)
	}
}

func TestRun_WhisperBinaryMissing_MarksFailed(t *testing.T) {
	// Full path through: copy source, ffmpeg extract (real), ensureModel (served
	// by a local HTTP stub), then whisper binary lookup fails → run returns err.
	db := workerDB(t)
	store, _ := localStorage(t)
	libID, fileID := seedFile(t, db, "audio/wav")

	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}

	// Generate a real WAV and store it as the source blob so ffmpeg succeeds.
	wav := makeWav(t, t.TempDir())
	data, err := os.ReadFile(wav)
	if err != nil {
		t.Fatalf("read wav: %v", err)
	}
	if err := store.StoreFile(libID.String(), fileID.String(), data); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	// Local model server returns tiny dummy bytes for any ggml-*.bin request.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("dummy-model-bytes"))
	}))
	defer srv.Close()

	modelsDir := filepath.Join(t.TempDir(), "models")
	cfg := &config.Config{
		FFmpegBinaryPath:    ff,
		WhisperBinaryPath:   "definitely-not-a-real-whisper-binary-xyz",
		WhisperModel:        "tiny",
		WhisperLanguage:     "auto",
		WhisperModelsDir:    modelsDir,
		WhisperModelBaseURL: srv.URL,
		WhisperVADModel:     "", // skip VAD to keep it simple
	}
	h := NewTaskHandler(db, store, cfg, nil, nil)

	err = h.run(context.Background(), libID.String(), fileID.String())
	if err == nil {
		t.Fatal("expected error because whisper binary is missing")
	}
	if !strings.Contains(err.Error(), "whisper") {
		t.Errorf("expected whisper-related error, got %v", err)
	}
	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "failed" {
		t.Errorf("expected status=failed, got %v", f.TranscribeStatus)
	}
	// The model should have been downloaded to disk before whisper lookup.
	if _, statErr := os.Stat(filepath.Join(modelsDir, "ggml-tiny.bin")); statErr != nil {
		t.Errorf("expected model file to be saved: %v", statErr)
	}
}

func TestRun_VADModelFetchFails_MarksFailed(t *testing.T) {
	db := workerDB(t)
	store, _ := localStorage(t)
	libID, fileID := seedFile(t, db, "audio/wav")

	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	wav := makeWav(t, t.TempDir())
	data, _ := os.ReadFile(wav)
	if err := store.StoreFile(libID.String(), fileID.String(), data); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	// Serve the primary model fine, but 404 the VAD model so ensureModel
	// (non-retryable 4xx) fails on the VAD path.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "vad-model") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("dummy"))
	}))
	defer srv.Close()

	cfg := &config.Config{
		FFmpegBinaryPath:    ff,
		WhisperBinaryPath:   "whisper-cli",
		WhisperModel:        "tiny",
		WhisperLanguage:     "auto",
		WhisperModelsDir:    filepath.Join(t.TempDir(), "models"),
		WhisperModelBaseURL: srv.URL,
		WhisperVADModel:     "vad-model-x",
	}
	h := NewTaskHandler(db, store, cfg, nil, nil)
	err := h.run(context.Background(), libID.String(), fileID.String())
	if err == nil {
		t.Fatal("expected error fetching missing VAD model")
	}
	// NOTE: run() returns the *raw* ensureModel error (not the "ensure whisper
	// VAD model" wrap, which is only persisted to transcribe_error). Asserting
	// current behavior — the wrap lands in the DB field, not the return value.
	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "failed" {
		t.Errorf("expected status=failed, got %v", f.TranscribeStatus)
	}
	if f.TranscribeError == nil || !strings.Contains(*f.TranscribeError, "VAD") {
		t.Errorf("expected VAD context in persisted error, got %v", f.TranscribeError)
	}
}

func TestRun_ModelDownloadFails_MarksFailed(t *testing.T) {
	db := workerDB(t)
	store, _ := localStorage(t)
	libID, fileID := seedFile(t, db, "audio/wav")

	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	wav := makeWav(t, t.TempDir())
	data, _ := os.ReadFile(wav)
	if err := store.StoreFile(libID.String(), fileID.String(), data); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	// 404 everything so the primary model download fails (non-retryable).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	cfg := &config.Config{
		FFmpegBinaryPath:    ff,
		WhisperBinaryPath:   "whisper-cli",
		WhisperModel:        "tiny",
		WhisperModelsDir:    filepath.Join(t.TempDir(), "models"),
		WhisperModelBaseURL: srv.URL,
	}
	h := NewTaskHandler(db, store, cfg, nil, nil)
	err := h.run(context.Background(), libID.String(), fileID.String())
	if err == nil {
		t.Fatal("expected error when model download 404s")
	}
	// run() returns the raw download error; the "ensure whisper model" wrap is
	// persisted to transcribe_error. Assert both reflect the failure.
	if !strings.Contains(err.Error(), "http 404") {
		t.Errorf("expected download error, got %v", err)
	}
	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeError == nil || !strings.Contains(*f.TranscribeError, "ensure whisper model") {
		t.Errorf("expected ensure-model context in persisted error, got %v", f.TranscribeError)
	}
}

// writeFakeWhisper installs a shell script that mimics whisper-cli's contract:
// parse "-of <base>", write <base>.txt and <base>.vtt, emit a progress line,
// exit 0. whisper.cpp itself is not runnable in this environment, so the fake
// stands in for it (runWhisper only reads back the two output files).
func writeFakeWhisper(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	bin := filepath.Join(t.TempDir(), "fakewhisper")
	script := "#!/bin/sh\n" +
		"of=\"\"\n" +
		"while [ $# -gt 0 ]; do\n" +
		"  if [ \"$1\" = \"-of\" ]; then of=\"$2\"; fi\n" +
		"  shift\n" +
		"done\n" +
		"echo 'whisper_print_progress_callback: progress =  90%'\n" +
		"printf 'hello world transcript' > \"$of.txt\"\n" +
		"printf 'WEBVTT\\n\\n00:00.000 --> 00:01.000\\nhello world' > \"$of.vtt\"\n" +
		"exit 0\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return bin
}

func runHappyPath(t *testing.T, db *gorm.DB, activitySvc *activity.Service) (libID, fileID uuid.UUID) {
	t.Helper()
	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	store, _ := localStorage(t)
	libID, fileID = seedFile(t, db, "audio/wav")

	wav := makeWav(t, t.TempDir())
	data, _ := os.ReadFile(wav)
	if err := store.StoreFile(libID.String(), fileID.String(), data); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("dummy-model"))
	}))
	defer srv.Close()

	cfg := &config.Config{
		FFmpegBinaryPath:    ff,
		WhisperBinaryPath:   writeFakeWhisper(t),
		WhisperModel:        "tiny",
		WhisperLanguage:     "en",
		WhisperModelsDir:    filepath.Join(t.TempDir(), "models"),
		WhisperModelBaseURL: srv.URL,
		WhisperVADModel:     "", // VAD disabled
	}
	h := NewTaskHandler(db, store, cfg, activitySvc, nil)
	if err := h.run(context.Background(), libID.String(), fileID.String()); err != nil {
		t.Fatalf("run happy path: %v", err)
	}
	return libID, fileID
}

// TestRun_HappyPath_FakeWhisper drives the full success path (no activity svc).
func TestRun_HappyPath_FakeWhisper(t *testing.T) {
	db := workerDB(t)
	_, fileID := runHappyPath(t, db, nil)

	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "ready" {
		t.Errorf("status = %v, want ready", f.TranscribeStatus)
	}
	if f.TranscribeProgress == nil || *f.TranscribeProgress != 100 {
		t.Errorf("progress = %v, want 100", f.TranscribeProgress)
	}
	if f.TranscriptText == nil || *f.TranscriptText != "hello world transcript" {
		t.Errorf("transcript text = %v", f.TranscriptText)
	}
	if f.TranscriptVTT == nil || !strings.Contains(*f.TranscriptVTT, "WEBVTT") {
		t.Errorf("transcript vtt = %v", f.TranscriptVTT)
	}
	if f.TranscriptModel == nil || *f.TranscriptModel != "tiny" {
		t.Errorf("transcript model = %v", f.TranscriptModel)
	}
}

// TestRun_HappyPath_EmitsActivity exercises the activitySvc != nil branch.
func TestRun_HappyPath_EmitsActivity(t *testing.T) {
	db := workerDB(t)
	if err := db.AutoMigrate(&models.LibraryActivity{}); err != nil {
		t.Fatalf("migrate activity: %v", err)
	}
	actSvc := activity.NewService(db, nil, nil)

	libID, fileID := runHappyPath(t, db, actSvc)
	_ = fileID

	// EmitAsync is detached; poll briefly for the row so we don't race teardown.
	var count int64
	for i := 0; i < 50; i++ {
		db.Model(&models.LibraryActivity{}).
			Where("library_id = ? AND action = ?", libID, activity.ActionSystemTranscribeReady).
			Count(&count)
		if count > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if count == 0 {
		t.Errorf("expected a transcribe_ready activity row to be emitted")
	}
}

// ---------------------------------------------------------------------------
// ProcessTask end-to-end (decodes payload then runs)
// ---------------------------------------------------------------------------

func TestProcessTask_ValidPayload_MissingFileReturnsNil(t *testing.T) {
	db := workerDB(t)
	h := NewTaskHandler(db, nil, &config.Config{}, nil, nil)
	task, err := NewTranscribeTask(uuid.NewString(), uuid.NewString())
	if err != nil {
		t.Fatalf("NewTranscribeTask: %v", err)
	}
	if err := h.ProcessTask(context.Background(), task); err != nil {
		t.Errorf("ProcessTask for missing file should be nil, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// copySourceToTemp
// ---------------------------------------------------------------------------

func TestCopySourceToTemp_CopiesBytes(t *testing.T) {
	store, _ := localStorage(t)
	libID, fileID := uuid.NewString(), uuid.NewString()
	payload := []byte("hello transcribe payload")
	if err := store.StoreFile(libID, fileID, payload); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	h := &TaskHandler{storage: store}
	dst := filepath.Join(t.TempDir(), "out.bin")
	if err := h.copySourceToTemp(libID, fileID, dst); err != nil {
		t.Fatalf("copySourceToTemp: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("read dst: %v", err)
	}
	if string(got) != string(payload) {
		t.Errorf("copied bytes mismatch: %q", got)
	}
}

func TestCopySourceToTemp_OpenError(t *testing.T) {
	store, _ := localStorage(t)
	h := &TaskHandler{storage: store}
	err := h.copySourceToTemp(uuid.NewString(), uuid.NewString(), filepath.Join(t.TempDir(), "x"))
	if err == nil {
		t.Fatal("expected open error for missing blob")
	}
	if !strings.Contains(err.Error(), "open source") {
		t.Errorf("expected open source error, got %v", err)
	}
}

func TestCopySourceToTemp_CreateDestError(t *testing.T) {
	store, _ := localStorage(t)
	libID, fileID := uuid.NewString(), uuid.NewString()
	if err := store.StoreFile(libID, fileID, []byte("data")); err != nil {
		t.Fatalf("StoreFile: %v", err)
	}
	h := &TaskHandler{storage: store}
	// Destination under a path whose parent is a file → os.Create fails.
	bad := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(bad, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := h.copySourceToTemp(libID, fileID, filepath.Join(bad, "nested"))
	if err == nil {
		t.Fatal("expected create temp error")
	}
	if !strings.Contains(err.Error(), "create temp") {
		t.Errorf("expected create temp error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// setState / fail
// ---------------------------------------------------------------------------

func TestSetState_PersistsFields(t *testing.T) {
	db := workerDB(t)
	libID, fileID := seedFile(t, db, "video/mp4")
	_ = libID
	h := &TaskHandler{db: db}
	pct := 42
	eta := 7
	msg := "halfway"
	h.setState(fileID.String(), stringPtr("processing"), &pct, &eta, &msg)

	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "processing" {
		t.Errorf("status = %v", f.TranscribeStatus)
	}
	if f.TranscribeProgress == nil || *f.TranscribeProgress != 42 {
		t.Errorf("progress = %v", f.TranscribeProgress)
	}
	if f.TranscribeEtaSeconds == nil || *f.TranscribeEtaSeconds != 7 {
		t.Errorf("eta = %v", f.TranscribeEtaSeconds)
	}
	if f.TranscribeError == nil || *f.TranscribeError != "halfway" {
		t.Errorf("error = %v", f.TranscribeError)
	}
}

func TestFail_SetsFailedStatusAndMessage(t *testing.T) {
	db := workerDB(t)
	_, fileID := seedFile(t, db, "audio/mpeg")
	h := &TaskHandler{db: db}
	h.fail(fileID.String(), context.DeadlineExceeded)

	var f models.File
	db.Where("id = ?", fileID).First(&f)
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "failed" {
		t.Errorf("status = %v, want failed", f.TranscribeStatus)
	}
	if f.TranscribeError == nil || *f.TranscribeError != context.DeadlineExceeded.Error() {
		t.Errorf("error = %v", f.TranscribeError)
	}
}

func TestStringPtrIntPtr(t *testing.T) {
	if *stringPtr("z") != "z" {
		t.Error("stringPtr")
	}
	if *intPtr(9) != 9 {
		t.Error("intPtr")
	}
}

// ---------------------------------------------------------------------------
// extractAudio (real ffmpeg)
// ---------------------------------------------------------------------------

func TestExtractAudio_ProducesWav(t *testing.T) {
	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	dir := t.TempDir()
	// Source is itself a wav we generate; extractAudio re-encodes to mono 16k.
	src := makeWav(t, dir)
	out := filepath.Join(dir, "extracted.wav")
	if err := extractAudio(context.Background(), ff, src, out); err != nil {
		t.Fatalf("extractAudio: %v", err)
	}
	st, err := os.Stat(out)
	if err != nil || st.Size() <= 44 {
		t.Errorf("expected non-trivial wav, stat=%v err=%v", st, err)
	}
	// Duration helper should report ~1s.
	if d := wavDurationSeconds(out); d < 0.5 || d > 2.0 {
		t.Errorf("wavDurationSeconds = %v, want ~1s", d)
	}
}

func TestExtractAudio_BadInputReturnsError(t *testing.T) {
	ff := ffmpegBin()
	if ff == "" {
		t.Skip("ffmpeg not available")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "bogus.bin")
	if err := os.WriteFile(src, []byte("not media"), 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "out.wav")
	err := extractAudio(context.Background(), ff, src, out)
	if err == nil {
		t.Fatal("expected ffmpeg error on bogus input")
	}
}

// ---------------------------------------------------------------------------
// ensureModel / whisperFetch
// ---------------------------------------------------------------------------

func TestEnsureModel_AlreadyPresent_NoDownload(t *testing.T) {
	dir := t.TempDir()
	// Pre-place the model file so ensureModel short-circuits on os.Stat.
	if err := os.WriteFile(filepath.Join(dir, "ggml-tiny.bin"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// baseURL points at an unreachable host — must not be contacted.
	path, err := ensureModel(context.Background(), dir, "tiny", "http://127.0.0.1:1")
	if err != nil {
		t.Fatalf("ensureModel: %v", err)
	}
	if filepath.Base(path) != "ggml-tiny.bin" {
		t.Errorf("path = %q", path)
	}
}

func TestEnsureModel_DownloadsWhenMissing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ggml-base.bin" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte("model-payload"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	path, err := ensureModel(context.Background(), dir, "base", srv.URL)
	if err != nil {
		t.Fatalf("ensureModel: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read model: %v", err)
	}
	if string(got) != "model-payload" {
		t.Errorf("downloaded content = %q", got)
	}
}

func TestEnsureModel_BaseURLTrailingSlashTrimmed(t *testing.T) {
	var requested string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = r.URL.Path
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	if _, err := ensureModel(context.Background(), dir, "small", srv.URL+"/"); err != nil {
		t.Fatalf("ensureModel: %v", err)
	}
	if requested != "/ggml-small.bin" {
		t.Errorf("expected single-slash path, got %q", requested)
	}
}

func TestEnsureModel_404NotRetried(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	dir := t.TempDir()
	_, err := ensureModel(context.Background(), dir, "tiny", srv.URL)
	if err == nil {
		t.Fatal("expected error on 404")
	}
	// http 4xx is non-transient → exactly one attempt.
	if hits != 1 {
		t.Errorf("expected 1 attempt for 404, got %d", hits)
	}
}

func TestEnsureModel_5xxRetriesThenFails(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.WriteHeader(http.StatusServiceUnavailable) // 503 → "http 5" → retried
	}))
	defer srv.Close()

	dir := t.TempDir()
	// Cancel the context quickly so backoff sleeps abort instead of waiting
	// the full exponential schedule.
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	_, err := ensureModel(ctx, dir, "tiny", srv.URL)
	if err == nil {
		t.Fatal("expected error after retries on 503")
	}
	// At least the first attempt happened; the context deadline interrupts the
	// retry loop before all 6 attempts.
	if hits < 1 {
		t.Errorf("expected >=1 attempt, got %d", hits)
	}
}

func TestEnsureModel_MkdirAllError(t *testing.T) {
	// modelsDir path where a parent component is a file → MkdirAll fails.
	parent := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(parent, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := ensureModel(context.Background(), filepath.Join(parent, "models"), "tiny", "http://x")
	if err == nil {
		t.Fatal("expected MkdirAll error")
	}
}

func TestWhisperFetch_HTTPErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	dst := filepath.Join(t.TempDir(), "m.bin")
	err := whisperFetch(context.Background(), srv.URL, dst)
	if err == nil {
		t.Fatal("expected error for 500 status")
	}
	if !strings.Contains(err.Error(), "http 500") {
		t.Errorf("expected http 500 in error, got %v", err)
	}
}

func TestWhisperFetch_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("the-bytes"))
	}))
	defer srv.Close()

	dst := filepath.Join(t.TempDir(), "m.bin")
	if err := whisperFetch(context.Background(), srv.URL, dst); err != nil {
		t.Fatalf("whisperFetch: %v", err)
	}
	got, _ := os.ReadFile(dst)
	if string(got) != "the-bytes" {
		t.Errorf("content = %q", got)
	}
	// The .part temp must have been renamed away.
	if _, err := os.Stat(dst + ".part"); !os.IsNotExist(err) {
		t.Errorf("expected .part to be renamed/removed")
	}
}

func TestWhisperFetch_BadURL(t *testing.T) {
	// Malformed URL → http.NewRequestWithContext error.
	err := whisperFetch(context.Background(), "://not a url", filepath.Join(t.TempDir(), "x"))
	if err == nil {
		t.Fatal("expected error for malformed URL")
	}
}

func TestWhisperFetch_UnreachableHost(t *testing.T) {
	err := whisperFetch(context.Background(), "http://127.0.0.1:1/ggml-tiny.bin", filepath.Join(t.TempDir(), "x"))
	if err == nil {
		t.Fatal("expected connection error")
	}
}

// ---------------------------------------------------------------------------
// runWhisper
// ---------------------------------------------------------------------------

func TestRunWhisper_BinaryNotFound(t *testing.T) {
	err := runWhisper(context.Background(), "no-such-whisper-binary-zzz",
		"/m/ggml-tiny.bin", "", "/in.wav", "/tmp/out", "auto", 0, nil)
	if err == nil {
		t.Fatal("expected error for missing whisper binary")
	}
	if !strings.Contains(err.Error(), "not found in PATH") {
		t.Errorf("expected PATH error, got %v", err)
	}
}

func TestRunWhisper_FakeBinaryEmitsProgress(t *testing.T) {
	// Build a fake "whisper" shell script that prints a couple of segment lines
	// and a progress line, then exits 0. Exercises the success path of
	// runWhisper + progressTracker wiring end to end without real whisper.cpp.
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "fakewhisper")
	script := "#!/bin/sh\n" +
		"echo '[00:00:00.000 --> 00:00:50.000]   hello'\n" +
		"echo 'whisper_print_progress_callback: progress =  60%'\n" +
		"exit 0\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	var got []int
	err := runWhisper(context.Background(), bin,
		"/m/ggml-tiny.bin", "", "/in.wav", filepath.Join(dir, "out"), "en", 100,
		func(p int) { got = append(got, p) })
	if err != nil {
		t.Fatalf("runWhisper: %v", err)
	}
	if len(got) == 0 {
		t.Errorf("expected progress callbacks, got none")
	}
}

func TestRunWhisper_FakeBinaryNonZeroExit(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "failwhisper")
	script := "#!/bin/sh\n" +
		"echo 'fatal error: something went wrong' 1>&2\n" +
		"exit 3\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	err := runWhisper(context.Background(), bin,
		"/m/ggml-tiny.bin", "/m/vad.bin", "/in.wav", filepath.Join(dir, "out"), "auto", 0, nil)
	if err == nil {
		t.Fatal("expected non-zero exit error")
	}
	// lastErrLine (contains "error") should be wrapped into the message.
	if !strings.Contains(strings.ToLower(err.Error()), "error") {
		t.Errorf("expected error-line context, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// wavDurationSeconds edge: header-only file → 0
// ---------------------------------------------------------------------------

func TestWavDurationSeconds_HeaderOnlyReturnsZero(t *testing.T) {
	p := filepath.Join(t.TempDir(), "tiny.wav")
	if err := os.WriteFile(p, make([]byte, 44), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := wavDurationSeconds(p); got != 0 {
		t.Errorf("expected 0 for header-only file, got %v", got)
	}
}
