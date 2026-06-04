package transcribe

import (
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/queues"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// Service orchestrates audio transcription jobs for video files.
type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
	cfg         *config.Config
	activitySvc *activity.Service
	settingsSvc *settings.Service
}

// NewService creates a new transcribe service. settingsSvc may be nil in
// tests; the worker falls back to cfg.WhisperModel / cfg.WhisperLanguage.
func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client, cfg *config.Config, activitySvc *activity.Service, settingsSvc *settings.Service) *Service {
	return &Service{
		db:          db,
		storage:     storageSvc,
		asynqClient: asynqClient,
		cfg:         cfg,
		activitySvc: activitySvc,
		settingsSvc: settingsSvc,
	}
}

const completedTaskRetention = 24 * time.Hour

// EnqueueTranscribe enqueues a transcription task for the given file.
func (s *Service) EnqueueTranscribe(libraryID, fileID string) error {
	task, err := NewTranscribeTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create transcribe task: %w", err)
	}
	// Whisper transcription is the heaviest, longest-running job class, so it
	// runs on its own lowest-real-work queue (above only maintenance) and never
	// hogs the worker pool ahead of fast jobs like thumbnailing.
	if _, err := s.asynqClient.Enqueue(task, asynq.Queue(queues.Transcription), asynq.Retention(completedTaskRetention)); err != nil {
		return fmt.Errorf("failed to enqueue transcribe task: %w", err)
	}
	log.Printf("Enqueued transcribe for file %s in library %s", fileID, libraryID)
	return nil
}

// NewTaskHandler builds the asynq task handler.
func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage, s.cfg, s.activitySvc, s.settingsSvc)
}
