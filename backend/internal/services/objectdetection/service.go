package objectdetection

import (
	"fmt"
	"log"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// Service is the top-level object detection service that ties together
// the ONNX model, task queue, database, and storage.
type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
	config      *ObjectConfig
}

// NewService creates a new object detection service.
func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client, config *ObjectConfig) *Service {
	return &Service{
		db:          db,
		storage:     storageSvc,
		asynqClient: asynqClient,
		config:      config,
	}
}

// EnqueueObjectDetection enqueues an object detection task for a single file.
func (s *Service) EnqueueObjectDetection(libraryID, fileID string) error {
	task, err := NewObjectDetectTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create object detect task: %w", err)
	}
	_, err = s.asynqClient.Enqueue(task)
	if err != nil {
		return fmt.Errorf("failed to enqueue object detect task: %w", err)
	}
	log.Printf("Enqueued object detection for file %s in library %s", fileID, libraryID)
	return nil
}

// NewTaskHandler creates the asynq task handler for processing object detection tasks.
func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage, s.config)
}

// EnqueueExistingImages enqueues object detection for all unprocessed images in a library.
func (s *Service) EnqueueExistingImages(libraryID string) (int, error) {
	return EnqueueExistingLibraryImages(s.asynqClient, s.db, libraryID)
}

// DeleteLibraryData deletes all object detection data for a library.
func (s *Service) DeleteLibraryData(libraryID string) error {
	return DeleteLibraryObjectData(s.db, libraryID)
}

// ReprocessLibrary deletes existing object data and re-enqueues all images.
func (s *Service) ReprocessLibrary(libraryID string) (int, error) {
	return ReprocessLibraryObjectData(s.asynqClient, s.db, libraryID)
}

// DeleteObjectDataForFiles removes object detection data for specific files.
func (s *Service) DeleteObjectDataForFiles(libraryID string, fileIDs []string) error {
	return DeleteObjectDataForFiles(s.db, libraryID, fileIDs)
}

// EnsureModels downloads the ONNX model if not present.
func (s *Service) EnsureModels() error {
	return EnsureModelsDownloaded(s.config.ModelsPath)
}
