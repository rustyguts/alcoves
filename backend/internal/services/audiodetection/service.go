package audiodetection

import (
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const TaskTypeAudioDetect = "file:audio-detect"

type Payload struct {
	LibraryID string `json:"libraryId"`
	FileID    string `json:"fileId"`
}

// Service enqueues + lists audio event detections for video/audio files.
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

func (s *Service) EnqueueDetect(libraryID, fileID string) error {
	payload := Payload{LibraryID: libraryID, FileID: fileID}
	task, err := newTask(payload)
	if err != nil {
		return fmt.Errorf("create audio-detect task: %w", err)
	}
	if _, err := s.asynqClient.Enqueue(task, asynq.Retention(completedTaskRetention)); err != nil {
		return fmt.Errorf("enqueue audio-detect: %w", err)
	}
	log.Printf("Enqueued audio-detect for file %s in library %s", fileID, libraryID)
	return nil
}

// ListByFile returns detections for a file sorted by start time then score.
func (s *Service) ListByFile(libraryID, fileID string) ([]models.AudioDetection, error) {
	var out []models.AudioDetection
	err := s.db.
		Where("library_id = ? AND file_id = ?", libraryID, fileID).
		Order("start_seconds ASC, score DESC").
		Find(&out).Error
	return out, err
}

func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage, s.cfg)
}
