package audiodetection

import (
	"errors"
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

// uniqueWindow gates duplicate enqueues for the same {libraryId, fileId}
// payload. A double-clicked "detect" button or two pods racing on the same
// file event would otherwise queue two tasks; both would run concurrently
// (worker concurrency = 8) and write competing audio_detect_progress
// updates to the same row, producing the observed 30%->60%->30% bouncing.
// Their final transactions also race the DELETE+INSERT of detections so
// only the last writer's data survives. The window must comfortably cover
// the longest expected detection run; long files (~1h) take several
// minutes, so 2h is a generous ceiling.
const enqueueUniqueWindow = 2 * time.Hour

func (s *Service) EnqueueDetect(libraryID, fileID string) error {
	payload := Payload{LibraryID: libraryID, FileID: fileID}
	task, err := newTask(payload)
	if err != nil {
		return fmt.Errorf("create audio-detect task: %w", err)
	}
	_, err = s.asynqClient.Enqueue(task,
		asynq.Retention(completedTaskRetention),
		asynq.Unique(enqueueUniqueWindow),
	)
	if errors.Is(err, asynq.ErrDuplicateTask) {
		// Another enqueue for the same file is already queued or running;
		// the existing task will reach the same end state, so treat this
		// as success rather than failing the user-facing HTTP request.
		log.Printf("audio-detect already queued for file %s, skipping duplicate", fileID)
		return nil
	}
	if err != nil {
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
