package momentexport

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const TaskTypeMomentExport = "moment:export"

// Payload is the asynq task payload.
type Payload struct {
	MomentID  string `json:"momentId"`
	FileID    string `json:"fileId"`
	LibraryID string `json:"libraryId"`
}

type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
}

func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client) *Service {
	return &Service{db: db, storage: storageSvc, asynqClient: asynqClient}
}

const completedTaskRetention = 24 * time.Hour

// Enqueue schedules an export for the given moment.
func (s *Service) Enqueue(libraryID, fileID, momentID string) error {
	payload, err := json.Marshal(Payload{
		MomentID:  momentID,
		FileID:    fileID,
		LibraryID: libraryID,
	})
	if err != nil {
		return fmt.Errorf("failed to marshal moment export payload: %w", err)
	}
	task := asynq.NewTask(TaskTypeMomentExport, payload)
	if _, err := s.asynqClient.Enqueue(task, asynq.Retention(completedTaskRetention)); err != nil {
		return fmt.Errorf("failed to enqueue moment export: %w", err)
	}
	log.Printf("Enqueued moment export moment=%s file=%s library=%s", momentID, fileID, libraryID)
	return nil
}

// NewTaskHandler constructs the asynq handler for moment exports.
func (s *Service) NewTaskHandler() *TaskHandler {
	return &TaskHandler{db: s.db, storage: s.storage}
}

// CacheKey returns the storage cache key for a given moment export version.
func CacheKey(libraryID, momentID string, version int) string {
	return fmt.Sprintf("%s/moments/%s/v%d.mp4", libraryID, momentID, version)
}

// CachePrefix returns the directory-level prefix for a moment's cached exports.
func CachePrefix(libraryID, momentID string) string {
	return fmt.Sprintf("%s/moments/%s/", libraryID, momentID)
}
