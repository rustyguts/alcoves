package videoproxy

import (
	"fmt"
	"log"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// Service is the top-level video proxy service.
type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
}

// NewService creates a new video proxy service.
func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client) *Service {
	return &Service{
		db:          db,
		storage:     storageSvc,
		asynqClient: asynqClient,
	}
}

// EnqueueVideoProxy enqueues a video proxy generation task.
func (s *Service) EnqueueVideoProxy(libraryID, fileID string) error {
	task, err := NewVideoProxyTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create video proxy task: %w", err)
	}
	_, err = s.asynqClient.Enqueue(task)
	if err != nil {
		return fmt.Errorf("failed to enqueue video proxy task: %w", err)
	}
	log.Printf("Enqueued video proxy for file %s in library %s", fileID, libraryID)
	return nil
}

// NewTaskHandler creates the asynq task handler for processing video proxy tasks.
func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage)
}
