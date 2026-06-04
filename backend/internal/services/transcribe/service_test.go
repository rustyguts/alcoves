package transcribe

import (
	"testing"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

// testDSN is the base connection string for the shared test Postgres. The
// worker test creates its own isolated schema from this; the settings-backed
// tests use testsupport.OpenSchema instead.
const testDSN = "postgres://postgres:postgres@localhost:5455/alcoves_test"

// dialAsynq returns a client pointed at the local Dragonfly/Redis used in the
// dev compose stack. Tests skip if it is unreachable.
func dialAsynq(t *testing.T) *asynq.Client {
	t.Helper()
	c := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	// Ping by enqueueing nothing; asynq.NewClient is lazy, so probe with a
	// throwaway enqueue inside the calling test instead.
	return c
}

func TestNewService_WiresFields(t *testing.T) {
	cfg := &config.Config{WhisperModel: "tiny", WhisperLanguage: "fr"}
	svc := NewService(nil, nil, nil, cfg, nil, nil)
	if svc == nil {
		t.Fatal("NewService returned nil")
	}
	if svc.cfg != cfg {
		t.Errorf("cfg not wired through")
	}
}

func TestService_NewTaskHandler_UsesServiceConfig(t *testing.T) {
	cfg := &config.Config{WhisperModel: "base", WhisperLanguage: "de"}
	svc := NewService(nil, nil, nil, cfg, nil, nil)
	h := svc.NewTaskHandler()
	if h == nil {
		t.Fatal("NewTaskHandler returned nil")
	}
	// With no settings service, activeModel/activeLanguage fall back to cfg.
	if got := h.activeModel(); got != "base" {
		t.Errorf("activeModel = %q, want base", got)
	}
	if got := h.activeLanguage(); got != "de" {
		t.Errorf("activeLanguage = %q, want de", got)
	}
}

func TestEnqueueTranscribe_Succeeds(t *testing.T) {
	client := dialAsynq(t)
	defer client.Close()

	cfg := &config.Config{}
	svc := NewService(nil, nil, client, cfg, nil, nil)
	if err := svc.EnqueueTranscribe("lib-enq", "file-enq"); err != nil {
		t.Skipf("enqueue failed (queue unavailable?): %v", err)
	}
}

func TestEnqueueTranscribe_PropagatesEnqueueError(t *testing.T) {
	// Point the client at a closed/invalid port so Enqueue fails, exercising
	// the error-wrapping branch.
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "127.0.0.1:1"})
	defer client.Close()

	svc := NewService(nil, nil, client, &config.Config{}, nil, nil)
	err := svc.EnqueueTranscribe("lib", "file")
	if err == nil {
		t.Fatal("expected error enqueueing to an unreachable broker")
	}
	if got := err.Error(); got == "" {
		t.Errorf("expected wrapped error message, got empty")
	}
}

// settingsDB opens the shared test Postgres and migrates just the settings
// tables. Skips when unavailable.
func settingsDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_transcribe")
	// settings.NewService only reloads — it does not migrate — so the test
	// must create app_settings itself rather than relying on another package
	// having migrated it into a shared schema.
	if err := db.AutoMigrate(&models.AppSettings{}); err != nil {
		t.Fatalf("migrate app_settings: %v", err)
	}
	return db
}

func TestActiveModelAndLanguage_PreferSettingsOverConfig(t *testing.T) {
	db := settingsDB(t)
	settingsSvc, err := settings.NewService(db)
	if err != nil {
		t.Fatalf("settings.NewService: %v", err)
	}
	// Defaults seed whisper_model=large-v3, whisper_language=auto, which are
	// non-empty — so they should win over the cfg fallback.
	cfg := &config.Config{WhisperModel: "cfg-model", WhisperLanguage: "cfg-lang"}
	h := NewTaskHandler(db, nil, cfg, nil, settingsSvc)

	if got := h.activeModel(); got == "cfg-model" {
		t.Errorf("activeModel fell back to cfg despite non-empty settings value")
	}
	if got := h.activeLanguage(); got == "cfg-lang" {
		t.Errorf("activeLanguage fell back to cfg despite non-empty settings value")
	}
}

func TestActiveModel_NilSettingsFallsBackToConfig(t *testing.T) {
	cfg := &config.Config{WhisperModel: "small", WhisperLanguage: "ja"}
	h := NewTaskHandler(nil, nil, cfg, nil, nil)
	if got := h.activeModel(); got != "small" {
		t.Errorf("activeModel = %q, want small", got)
	}
	if got := h.activeLanguage(); got != "ja" {
		t.Errorf("activeLanguage = %q, want ja", got)
	}
}
