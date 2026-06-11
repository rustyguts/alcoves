package mediajobs

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

// This package's DB tests run against a private, uniquely-named Postgres
// database created once per test binary, mirroring the videoproxy package
// harness so we don't race other parallel test processes.

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
	name := "mj_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&models.User{}, &models.Library{}, &models.File{}); err != nil {
		isoDBErr = err
		return
	}
	isoDB = db
	isoDBName = name
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
	// NB: the isolated DB is a per-binary singleton shared across tests; it is
	// torn down once in TestMain, NOT per-test (a per-test Cleanup would close
	// the shared connection out from under later tests → "database is closed").
	return isoDB
}

// TestMain drops the per-binary isolated database after all tests complete.
func TestMain(m *testing.M) {
	code := m.Run()
	dropIsolatedDB()
	os.Exit(code)
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

// newService wires a Service whose enqueue clients point at an in-process
// miniredis so the enqueue side succeeds without an external broker.
func newService(t *testing.T, db *gorm.DB) *Service {
	t.Helper()
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	return NewService(
		db,
		videoproxy.NewService(db, nil, client, nil),
		waveform.NewService(db, nil, client, nil, nil),
		transcribe.NewService(db, nil, client, nil, nil, nil),
		audiodetection.NewService(db, nil, client, nil, nil),
	)
}

func uuidPtr(u uuid.UUID) *uuid.UUID { return &u }

func TestTriggerTranscribe_ResetsColumnsAndEnqueues(t *testing.T) {
	db := setupTestDB(t)
	svc := newService(t, db)
	libID, ownerID := seedLibrary(t, db)

	failed := "failed"
	prevProgress := 50
	prevErr := "boom"
	f := models.File{
		BaseModel:          models.BaseModel{ID: uuid.New()},
		LibraryID:          libID,
		Name:               "clip.mp4",
		MimeType:           "video/mp4",
		OwnerID:            &ownerID,
		TranscribeStatus:   &failed,
		TranscribeProgress: &prevProgress,
		TranscribeError:    &prevErr,
		TranscribeVersion:  3,
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}

	if err := svc.TriggerTranscribe(libID.String(), &f); err != nil {
		t.Fatalf("TriggerTranscribe: %v", err)
	}

	// In-memory mutation parity.
	if f.TranscribeStatus == nil || *f.TranscribeStatus != "queued" {
		t.Fatalf("in-memory status = %v, want queued", f.TranscribeStatus)
	}
	if f.TranscribeProgress == nil || *f.TranscribeProgress != 0 {
		t.Fatalf("in-memory progress = %v, want 0", f.TranscribeProgress)
	}
	if f.TranscribeEtaSeconds != nil {
		t.Fatalf("in-memory eta = %v, want nil", f.TranscribeEtaSeconds)
	}
	if f.TranscribeError != nil {
		t.Fatalf("in-memory error = %v, want nil", f.TranscribeError)
	}
	if f.TranscribeVersion != 4 {
		t.Fatalf("in-memory version = %d, want 4", f.TranscribeVersion)
	}

	// DB row parity.
	var got models.File
	if err := db.Where("id = ?", f.ID).First(&got).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.TranscribeStatus == nil || *got.TranscribeStatus != "queued" {
		t.Fatalf("db status = %v, want queued", got.TranscribeStatus)
	}
	if got.TranscribeProgress == nil || *got.TranscribeProgress != 0 {
		t.Fatalf("db progress = %v, want 0", got.TranscribeProgress)
	}
	if got.TranscribeEtaSeconds != nil {
		t.Fatalf("db eta = %v, want nil", got.TranscribeEtaSeconds)
	}
	if got.TranscribeError != nil {
		t.Fatalf("db error = %v, want nil", got.TranscribeError)
	}
	if got.TranscribeVersion != 4 {
		t.Fatalf("db version = %d, want 4", got.TranscribeVersion)
	}
}

func TestTriggerProxy_ExpiresPreviousProxyAndResets(t *testing.T) {
	db := setupTestDB(t)
	svc := newService(t, db)
	libID, ownerID := seedLibrary(t, db)

	src := models.File{
		BaseModel: models.BaseModel{ID: uuid.New()},
		LibraryID: libID,
		Name:      "src.mov",
		MimeType:  "video/quicktime",
		OwnerID:   &ownerID,
	}
	if err := db.Create(&src).Error; err != nil {
		t.Fatalf("create source: %v", err)
	}

	// A pre-existing, non-trashed proxy child that should get trashed.
	child := models.File{
		BaseModel:    models.BaseModel{ID: uuid.New()},
		LibraryID:    libID,
		Name:         "src_proxy.mp4",
		MimeType:     "video/mp4",
		OwnerID:      &ownerID,
		SourceFileID: uuidPtr(src.ID),
	}
	if err := db.Create(&child).Error; err != nil {
		t.Fatalf("create proxy child: %v", err)
	}

	if err := svc.TriggerProxy(libID.String(), &src); err != nil {
		t.Fatalf("TriggerProxy: %v", err)
	}

	// In-memory mutation parity (proxy has no version/error).
	if src.ProxyStatus == nil || *src.ProxyStatus != "queued" {
		t.Fatalf("in-memory proxy status = %v, want queued", src.ProxyStatus)
	}
	if src.ProxyProgress == nil || *src.ProxyProgress != 0 {
		t.Fatalf("in-memory proxy progress = %v, want 0", src.ProxyProgress)
	}
	if src.ProxyEtaSeconds != nil {
		t.Fatalf("in-memory proxy eta = %v, want nil", src.ProxyEtaSeconds)
	}

	// Source row reset in DB.
	var gotSrc models.File
	if err := db.Where("id = ?", src.ID).First(&gotSrc).Error; err != nil {
		t.Fatalf("reload source: %v", err)
	}
	if gotSrc.ProxyStatus == nil || *gotSrc.ProxyStatus != "queued" {
		t.Fatalf("db proxy status = %v, want queued", gotSrc.ProxyStatus)
	}

	// The previous proxy child must now be trashed.
	var gotChild models.File
	if err := db.Where("id = ?", child.ID).First(&gotChild).Error; err != nil {
		t.Fatalf("reload child: %v", err)
	}
	if gotChild.TrashedAt == nil {
		t.Fatalf("expected previous proxy child to be trashed, got trashed_at = nil")
	}
}

func TestCompletedReset_UsesSingleNow(t *testing.T) {
	// Guards the "time.Now() once per call" contract loosely: the updated_at
	// written must be recent. Mostly a smoke test on the waveform path.
	db := setupTestDB(t)
	svc := newService(t, db)
	libID, ownerID := seedLibrary(t, db)

	f := models.File{
		BaseModel: models.BaseModel{ID: uuid.New()},
		LibraryID: libID,
		Name:      "a.wav",
		MimeType:  "audio/wav",
		OwnerID:   &ownerID,
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	before := time.Now().Add(-2 * time.Second)
	if err := svc.TriggerWaveform(libID.String(), &f); err != nil {
		t.Fatalf("TriggerWaveform: %v", err)
	}
	if f.WaveformVersion != 1 {
		t.Fatalf("waveform version = %d, want 1", f.WaveformVersion)
	}
	var got models.File
	if err := db.Where("id = ?", f.ID).First(&got).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.UpdatedAt.Before(before) {
		t.Fatalf("updated_at %v not refreshed (before %v)", got.UpdatedAt, before)
	}
}
