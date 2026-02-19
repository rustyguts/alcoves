package videoproxy

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
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

const completedTaskRetention = 24 * time.Hour

// EnqueueVideoProxy enqueues a video proxy generation task.
func (s *Service) EnqueueVideoProxy(libraryID, fileID string, force bool) error {
	task, err := NewVideoProxyTask(libraryID, fileID, force)
	if err != nil {
		return fmt.Errorf("failed to create video proxy task: %w", err)
	}
	_, err = s.asynqClient.Enqueue(task, asynq.Retention(completedTaskRetention))
	if err != nil {
		return fmt.Errorf("failed to enqueue video proxy task: %w", err)
	}
	log.Printf("Enqueued video proxy for file %s in library %s", fileID, libraryID)
	return nil
}

func (s *Service) EnqueueVideoThumbnail(libraryID, fileID string) error {
	task, err := NewVideoThumbnailTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create video thumbnail task: %w", err)
	}
	_, err = s.asynqClient.Enqueue(task, asynq.Retention(completedTaskRetention))
	if err != nil {
		return fmt.Errorf("failed to enqueue video thumbnail task: %w", err)
	}
	log.Printf("Enqueued video thumbnail for file %s in library %s", fileID, libraryID)
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

// EnqueueExistingVideoThumbnails enqueues thumbnail generation for all active source videos in a library.
func (s *Service) EnqueueExistingVideoThumbnails(libraryID string) (int, error) {
	type fileRow struct {
		ID string `gorm:"column:id"`
	}

	var files []fileRow
	err := s.db.Model(&models.File{}).
		Select("id").
		Where("library_id = ? AND trashed_at IS NULL AND source_file_id IS NULL AND mime_type LIKE ?", libraryID, "video/%").
		Find(&files).Error
	if err != nil {
		return 0, fmt.Errorf("failed to query videos: %w", err)
	}

	queued := 0
	for _, f := range files {
		if err := s.EnqueueVideoThumbnail(libraryID, f.ID); err != nil {
			log.Printf("failed to enqueue video thumbnail for file %s: %v", f.ID, err)
			continue
		}
		queued++
	}

	return queued, nil
}

// NewTaskHandler creates the asynq task handler for processing video proxy tasks.
func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage)
}
