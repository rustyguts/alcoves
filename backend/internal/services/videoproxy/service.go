package videoproxy

import (
	"fmt"
	"log"
	"strings"

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
func (s *Service) EnqueueVideoProxy(libraryID, fileID string, force bool) error {
	task, err := NewVideoProxyTask(libraryID, fileID, force)
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

func ShouldCreateProxyByDefault(mimeType string) bool {
	mime := strings.ToLower(strings.TrimSpace(mimeType))
	if mime == "" {
		return true
	}

	// Common web-playable formats don't need a generated proxy by default.
	switch mime {
	case "video/mp4", "video/webm", "video/ogg":
		return false
	default:
		return true
	}
}

// NewTaskHandler creates the asynq task handler for processing video proxy tasks.
func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage)
}
