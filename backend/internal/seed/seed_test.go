package seed

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// seedModels are every table the seeder writes. AutoMigrate (rather than the
// goose migrations) keeps the test free of the pgvector extension — the seeder
// never touches the face embedding column — and matches how the handler tests
// build their isolated schema. Join tables come first so File's many2many sees
// the full file_tags/folder_tags shape (with id + created_at) already in place.
var seedModels = []any{
	&models.User{}, &models.Account{}, &models.AppSettings{},
	&models.Library{}, &models.LibraryMember{},
	&models.Folder{}, &models.Tag{},
	&models.FileTag{}, &models.FolderTag{}, &models.MomentTag{},
	&models.File{},
	&models.Person{}, &models.FaceDetection{}, &models.ObjectDetection{},
	&models.Moment{}, &models.MomentShare{},
	&models.AudioDetection{}, &models.HighlightFilter{},
	&models.LibraryActivity{}, &models.PersonalAccessToken{},
}

// freshDB returns a gorm.DB scoped to a clean, migrated isolated schema. It
// drops + recreates the schema first so the test is repeatable across runs
// (deterministic seed UUIDs would otherwise collide with a prior run's rows).
func freshDB(t *testing.T, schema string) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, schema)
	if err := db.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)).Error; err != nil {
		t.Fatalf("reset schema: %v", err)
	}
	if err := db.Exec(fmt.Sprintf("CREATE SCHEMA %s", schema)).Error; err != nil {
		t.Fatalf("recreate schema: %v", err)
	}
	// Use the explicit join structs (which carry id + created_at, matching the
	// goose schema) for the many2many tag relations, instead of GORM's implicit
	// composite-key join tables — the seeder inserts FileTag/FolderTag rows by id.
	if err := db.SetupJoinTable(&models.File{}, "Tags", &models.FileTag{}); err != nil {
		t.Fatalf("setup file_tags join: %v", err)
	}
	if err := db.SetupJoinTable(&models.Folder{}, "Tags", &models.FolderTag{}); err != nil {
		t.Fatalf("setup folder_tags join: %v", err)
	}
	if err := db.AutoMigrate(seedModels...); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func tempStorage(t *testing.T) *storage.Service {
	t.Helper()
	dir := t.TempDir()
	drv := storage.NewLocalDriver(
		filepath.Join(dir, "files"),
		filepath.Join(dir, "avatars"),
		filepath.Join(dir, "cache"),
	)
	return storage.NewService(drv)
}

func TestRun(t *testing.T) {
	db := freshDB(t, "seedrun")
	st := tempStorage(t)

	res, err := Run(db, st)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	// Counts (guard against accidental shrinkage of the seed set).
	if res.Users != 3 {
		t.Errorf("users = %d, want 3", res.Users)
	}
	if res.Libraries != 5 {
		t.Errorf("libraries = %d, want 5", res.Libraries)
	}
	if res.People != 3 {
		t.Errorf("people = %d, want 3", res.People)
	}
	if res.Moments != 3 {
		t.Errorf("moments = %d, want 3", res.Moments)
	}
	if res.Files < 15 {
		t.Errorf("files = %d, want >= 15", res.Files)
	}
	if res.Objects < 10 {
		t.Errorf("objects = %d, want >= 10", res.Objects)
	}
	if res.Activities < 10 {
		t.Errorf("activities = %d, want >= 10", res.Activities)
	}

	// Admin account is the owner and the password verifies.
	var admin models.User
	if err := db.Where("email = ?", AdminEmail).First(&admin).Error; err != nil {
		t.Fatalf("admin lookup: %v", err)
	}
	if admin.Role != "owner" {
		t.Errorf("admin role = %q, want owner", admin.Role)
	}
	if admin.PasswordHash == nil || !authservice.VerifyPassword(DefaultPassword, *admin.PasswordHash) {
		t.Error("admin password does not verify")
	}

	// File blob written to storage.
	if ok, _ := st.FileExists(id("lib/family").String(), id("file/family/beach").String()); !ok {
		t.Error("expected beach photo blob in storage")
	}
	// Avatar written.
	if ok, _ := st.AvatarExists(admin.ID.String()); !ok {
		t.Error("expected admin avatar in storage")
	}
	// Face crop cached so the people UI can render the cover face.
	faceKey := fmt.Sprintf("%s/faces/%s.webp", id("lib/family").String(), id("face/family/alice1").String())
	if ok, _ := st.CacheExists(faceKey); !ok {
		t.Error("expected cached face crop")
	}
	// Video thumbnail cached.
	thumbKey := fmt.Sprintf("%s/%s/thumbnail.webp", id("lib/podcast").String(), id("file/podcast/ep1").String())
	if ok, _ := st.CacheExists(thumbKey); !ok {
		t.Error("expected cached video thumbnail")
	}
	// Waveform cached.
	wfKey := fmt.Sprintf("%s/%s/waveform.json", id("lib/podcast").String(), id("file/podcast/ep1").String())
	if ok, _ := st.CacheExists(wfKey); !ok {
		t.Error("expected cached waveform json")
	}
	// Exported moment clip cached at the share endpoint's key.
	clipKey := momentexport.CacheKey(id("lib/podcast").String(), id("moment/podcast/key-takeaway").String(), 1)
	if ok, _ := st.CacheExists(clipKey); !ok {
		t.Error("expected exported moment clip in cache")
	}

	// Cover face wired up.
	var alicePerson models.Person
	if err := db.Where("id = ?", id("person/family/alice")).First(&alicePerson).Error; err != nil {
		t.Fatalf("person lookup: %v", err)
	}
	if alicePerson.CoverFaceDetectionID == nil {
		t.Error("expected Alice to have a cover face")
	}
	if alicePerson.FaceCount != 2 {
		t.Errorf("Alice face count = %d, want 2", alicePerson.FaceCount)
	}

	// Public share row exists.
	var shareCount int64
	db.Model(&models.MomentShare{}).Where("token = ?", "devseedshare01").Count(&shareCount)
	if shareCount != 1 {
		t.Errorf("share count = %d, want 1", shareCount)
	}

	// Dev PAT is randomly generated per seed (no compiled-in constant), returned
	// via Result, and stored as a hash of that plaintext.
	if !strings.HasPrefix(res.AccessToken, "alc_pat_") {
		t.Errorf("dev access token = %q, want alc_pat_ prefix", res.AccessToken)
	}
	var patCount int64
	db.Model(&models.PersonalAccessToken{}).Where("token_hash = ?", hashToken(res.AccessToken)).Count(&patCount)
	if patCount != 1 {
		t.Errorf("dev PAT count = %d, want 1", patCount)
	}

	// Registration is open.
	var settings models.AppSettings
	if err := db.Where("id = ?", 1).First(&settings).Error; err != nil {
		t.Fatalf("settings lookup: %v", err)
	}
	var parsed struct {
		RegistrationMode string `json:"registration_mode"`
	}
	_ = json.Unmarshal(settings.Settings, &parsed)
	if parsed.RegistrationMode != "open" {
		t.Errorf("registration mode = %q, want open", parsed.RegistrationMode)
	}
}

func TestMaybeRunGating(t *testing.T) {
	st := tempStorage(t)

	userCount := func(db *gorm.DB) int64 {
		var n int64
		db.Model(&models.User{}).Count(&n)
		return n
	}

	t.Run("disabled is a no-op", func(t *testing.T) {
		db := freshDB(t, "seedgate1")
		if err := MaybeRun(db, st, false, "all", "development"); err != nil {
			t.Fatalf("MaybeRun: %v", err)
		}
		if n := userCount(db); n != 0 {
			t.Errorf("users = %d, want 0 (disabled)", n)
		}
	})

	t.Run("worker mode is a no-op", func(t *testing.T) {
		db := freshDB(t, "seedgate2")
		if err := MaybeRun(db, st, true, "worker", "development"); err != nil {
			t.Fatalf("MaybeRun: %v", err)
		}
		if n := userCount(db); n != 0 {
			t.Errorf("users = %d, want 0 (worker)", n)
		}
	})

	t.Run("production environment is a no-op", func(t *testing.T) {
		db := freshDB(t, "seedgate4")
		if err := MaybeRun(db, st, true, "all", "production"); err != nil {
			t.Fatalf("MaybeRun: %v", err)
		}
		if n := userCount(db); n != 0 {
			t.Errorf("users = %d, want 0 (production)", n)
		}
	})

	t.Run("enabled on empty db seeds, and re-running is a no-op", func(t *testing.T) {
		db := freshDB(t, "seedgate3")
		st := tempStorage(t)
		if err := MaybeRun(db, st, true, "all", "development"); err != nil {
			t.Fatalf("MaybeRun: %v", err)
		}
		first := userCount(db)
		if first == 0 {
			t.Fatal("expected seeding to create users")
		}
		// Second run must not duplicate (DB no longer empty) and must not error.
		if err := MaybeRun(db, st, true, "all", "development"); err != nil {
			t.Fatalf("MaybeRun (second): %v", err)
		}
		if n := userCount(db); n != first {
			t.Errorf("users after re-run = %d, want %d (no-op)", n, first)
		}
	})
}

func TestGenerateDevToken(t *testing.T) {
	a, err := generateDevToken()
	if err != nil {
		t.Fatalf("generateDevToken: %v", err)
	}
	if !strings.HasPrefix(a, "alc_pat_") {
		t.Errorf("token %q missing alc_pat_ prefix", a)
	}
	if len(a) != len("alc_pat_")+32 {
		t.Errorf("token %q wrong length %d", a, len(a))
	}
	b, _ := generateDevToken()
	if a == b {
		t.Error("two generated tokens are identical; not random")
	}
}
