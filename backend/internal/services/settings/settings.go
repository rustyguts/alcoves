package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// Registration modes.
const (
	RegistrationOpen       = "open"
	RegistrationClosed     = "closed"
	RegistrationInviteOnly = "invite_only"
)

// Settings is the structured form of app_settings.settings JSONB.
type Settings struct {
	RegistrationMode string `json:"registration_mode"`

	// Inference model selection. Empty string means "use the worker's
	// boot-time fallback" (env var / config default); the admin UI persists
	// an explicit value here when the admin picks one.
	WhisperModel     string `json:"whisper_model,omitempty"`
	WhisperLanguage  string `json:"whisper_language,omitempty"`
	AudioDetectModel string `json:"audio_detect_model,omitempty"`
}

func defaults() Settings {
	return Settings{
		RegistrationMode: RegistrationOpen,
		WhisperModel:     "large-v3",
		WhisperLanguage:  "auto",
		AudioDetectModel: "efficientat_mn10",
	}
}

// Service is a cached accessor for the single-row app_settings table.
type Service struct {
	db    *gorm.DB
	mu    sync.RWMutex
	cache Settings
}

func NewService(db *gorm.DB) (*Service, error) {
	s := &Service{db: db}
	if err := s.reload(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Service) reload() error {
	var row models.AppSettings
	err := s.db.Where("id = ?", 1).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Seed default row. The migration also inserts this, but tests
		// using AutoMigrate may not run goose, so guard against missing.
		raw, _ := json.Marshal(defaults())
		row = models.AppSettings{ID: 1, Settings: raw}
		if cerr := s.db.Create(&row).Error; cerr != nil {
			return fmt.Errorf("seed app_settings: %w", cerr)
		}
	} else if err != nil {
		return fmt.Errorf("load app_settings: %w", err)
	}
	cur := defaults()
	if len(row.Settings) > 0 {
		_ = json.Unmarshal(row.Settings, &cur)
	}
	if !validMode(cur.RegistrationMode) {
		cur.RegistrationMode = RegistrationOpen
	}
	s.mu.Lock()
	s.cache = cur
	s.mu.Unlock()
	return nil
}

func (s *Service) Get() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cache
}

// Update merges a patch into the stored settings and refreshes cache.
// Caller is responsible for authorization AND domain-specific validation
// of the inference model fields (allow-list lives in the admin handler so
// the settings package stays free of transcribe/audiodetection imports).
// updatedBy may be nil.
func (s *Service) Update(patch Settings, updatedBy *uuid.UUID) (Settings, error) {
	cur := s.Get()
	if patch.RegistrationMode != "" {
		if !validMode(patch.RegistrationMode) {
			return cur, fmt.Errorf("invalid registration_mode")
		}
		cur.RegistrationMode = patch.RegistrationMode
	}
	if patch.WhisperModel != "" {
		cur.WhisperModel = patch.WhisperModel
	}
	if patch.WhisperLanguage != "" {
		cur.WhisperLanguage = patch.WhisperLanguage
	}
	if patch.AudioDetectModel != "" {
		cur.AudioDetectModel = patch.AudioDetectModel
	}

	raw, err := json.Marshal(cur)
	if err != nil {
		return cur, err
	}

	updates := map[string]any{
		"settings":   raw,
		"updated_at": time.Now(),
	}
	if updatedBy != nil {
		updates["updated_by"] = *updatedBy
	}
	if err := s.db.Model(&models.AppSettings{}).Where("id = ?", 1).Updates(updates).Error; err != nil {
		return cur, err
	}

	if err := s.reload(); err != nil {
		return cur, err
	}
	return s.Get(), nil
}

func validMode(m string) bool {
	switch m {
	case RegistrationOpen, RegistrationClosed, RegistrationInviteOnly:
		return true
	}
	return false
}
