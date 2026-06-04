package metadata

import (
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// TaskTypeMetadata is the asynq task type for EXIF / media-metadata extraction.
const TaskTypeMetadata = "file:metadata"

// Service owns enqueuing metadata-extraction work. It mirrors the waveform
// service: version-tracked, idempotent, runs on the shared default queue.
type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
	cfg         *config.Config
}

func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client, cfg *config.Config) *Service {
	return &Service{db: db, storage: storageSvc, asynqClient: asynqClient, cfg: cfg}
}

const completedTaskRetention = 24 * time.Hour

// EnqueueMetadata queues EXIF/media-metadata extraction for a single file.
func (s *Service) EnqueueMetadata(libraryID, fileID string) error {
	task, err := NewMetadataTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create metadata task: %w", err)
	}
	if _, err := s.asynqClient.Enqueue(task, asynq.Retention(completedTaskRetention)); err != nil {
		return fmt.Errorf("failed to enqueue metadata task: %w", err)
	}
	log.Printf("Enqueued metadata extraction for file %s in library %s", fileID, libraryID)
	return nil
}

func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage, s.cfg)
}
