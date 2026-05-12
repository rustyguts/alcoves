package waveform

import (
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const TaskTypeWaveform = "file:waveform"

type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
	cfg         *config.Config
	activitySvc *activity.Service
}

func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client, cfg *config.Config, activitySvc *activity.Service) *Service {
	return &Service{db: db, storage: storageSvc, asynqClient: asynqClient, cfg: cfg, activitySvc: activitySvc}
}

const completedTaskRetention = 24 * time.Hour

func (s *Service) EnqueueWaveform(libraryID, fileID string) error {
	task, err := NewWaveformTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create waveform task: %w", err)
	}
	if _, err := s.asynqClient.Enqueue(task, asynq.Retention(completedTaskRetention)); err != nil {
		return fmt.Errorf("failed to enqueue waveform task: %w", err)
	}
	log.Printf("Enqueued waveform for file %s in library %s", fileID, libraryID)
	return nil
}

func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage, s.cfg, s.activitySvc)
}