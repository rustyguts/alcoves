package filehash

import (
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/queues"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const completedTaskRetention = 24 * time.Hour

// Service is the top-level file hashing service.
type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
}

// NewService creates a new file hashing service.
func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client) *Service {
	return &Service{
		db:          db,
		storage:     storageSvc,
		asynqClient: asynqClient,
	}
}

// EnqueueFileHash enqueues a hash task for a single file.
func (s *Service) EnqueueFileHash(libraryID, fileID string) error {
	task, err := NewFileHashTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create file hash task: %w", err)
	}
	// SHA256 content hashing for dedup: fast, no user blocked on it.
	_, err = s.asynqClient.Enqueue(task, asynq.Queue(queues.Hash), asynq.Retention(completedTaskRetention))
	if err != nil {
		return fmt.Errorf("failed to enqueue file hash task: %w", err)
	}
	log.Printf("Enqueued file hash for file %s in library %s", fileID, libraryID)
	return nil
}

// NewTaskHandler creates the asynq task handler for processing file hash tasks.
func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage)
}

// EnqueueUnhashedFiles enqueues hash tasks for all files without a hash.
func (s *Service) EnqueueUnhashedFiles() (int, error) {
	return EnqueueUnhashedFiles(s.asynqClient, s.db)
}
