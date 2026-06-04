package facedetection

import (
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/queues"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// Service is the top-level face detection service that ties together
// the ONNX models, task queue, database, and storage.
type Service struct {
	db          *gorm.DB
	storage     *storage.Service
	asynqClient *asynq.Client
	config      *FaceConfig
}

// NewService creates a new face detection service.
func NewService(db *gorm.DB, storageSvc *storage.Service, asynqClient *asynq.Client, config *FaceConfig) *Service {
	return &Service{
		db:          db,
		storage:     storageSvc,
		asynqClient: asynqClient,
		config:      config,
	}
}

const completedTaskRetention = 24 * time.Hour

// EnqueueFaceDetection enqueues a face detection task for a single file.
func (s *Service) EnqueueFaceDetection(libraryID, fileID string) error {
	task, err := NewFaceDetectTask(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to create face detect task: %w", err)
	}
	// Face ONNX inference + clustering: CPU-bound background enrichment.
	_, err = s.asynqClient.Enqueue(task, asynq.Queue(queues.FaceDetection), asynq.Retention(completedTaskRetention))
	if err != nil {
		return fmt.Errorf("failed to enqueue face detect task: %w", err)
	}
	log.Printf("Enqueued face detection for file %s in library %s", fileID, libraryID)
	return nil
}

// NewTaskHandler creates the asynq task handler for processing face detection tasks.
func (s *Service) NewTaskHandler() *TaskHandler {
	return NewTaskHandler(s.db, s.storage, s.config)
}

// EnqueueExistingImages enqueues face detection for all unprocessed images in a library.
func (s *Service) EnqueueExistingImages(libraryID string) (int, error) {
	return EnqueueExistingLibraryImages(s.asynqClient, s.db, libraryID)
}

// DeleteLibraryData deletes all face data for a library.
func (s *Service) DeleteLibraryData(libraryID string) error {
	return DeleteLibraryFaceData(s.db, s.storage, libraryID)
}

// ReprocessLibrary deletes existing face data and re-enqueues all images.
func (s *Service) ReprocessLibrary(libraryID string) (int, error) {
	return ReprocessLibraryFaceData(s.asynqClient, s.db, s.storage, libraryID)
}

// DeleteFaceDataForFiles removes face data for specific files.
func (s *Service) DeleteFaceDataForFiles(libraryID string, fileIDs []string) error {
	return DeleteFaceDataForFiles(s.db, s.storage, libraryID, fileIDs)
}

// EnsureModels downloads ONNX models if not present.
func (s *Service) EnsureModels() error {
	return EnsureModelsDownloaded(s.config.ModelsPath)
}
