package objectdetection

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	ort "github.com/yalue/onnxruntime_go"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const TaskTypeObjectDetect = "object:detect"

// ObjectDetectPayload is the asynq task payload for object detection.
type ObjectDetectPayload struct {
	FileID    string `json:"fileId"`
	LibraryID string `json:"libraryId"`
}

// TaskHandler handles object detection asynq tasks.
type TaskHandler struct {
	db      *gorm.DB
	storage *storage.Service
	config  *ObjectConfig

	// Lazy-loaded ONNX session (thread-safe)
	sessionOnce sync.Once
	session     *ort.DynamicAdvancedSession
	sessionErr  error
}

// NewTaskHandler creates a new object detection task handler.
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, config *ObjectConfig) *TaskHandler {
	return &TaskHandler{
		db:      db,
		storage: storageSvc,
		config:  config,
	}
}

func (h *TaskHandler) getSession() (*ort.DynamicAdvancedSession, error) {
	h.sessionOnce.Do(func() {
		h.session, h.sessionErr = LoadDetectionSession(h.config.ModelsPath)
	})
	return h.session, h.sessionErr
}

// ProcessTask handles a single object:detect task.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload ObjectDetectPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid task payload: %w", err)
	}

	return h.processFile(ctx, payload.LibraryID, payload.FileID)
}

func (h *TaskHandler) processFile(ctx context.Context, libraryID, fileID string) error {
	// 1. Validate file exists, is image, not trashed
	var file models.File
	err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			log.Printf("object:detect skipping — file %s not found or trashed", fileID)
			return nil
		}
		return err
	}

	if !strings.HasPrefix(file.MimeType, "image/") {
		log.Printf("object:detect skipping — file %s is not an image (%s)", fileID, file.MimeType)
		return nil
	}

	// 2. Check idempotency — skip if detections already exist
	var existingCount int64
	h.db.Model(&models.ObjectDetection{}).Where("file_id = ?", fileID).Count(&existingCount)
	if existingCount > 0 {
		log.Printf("object:detect skipping — file %s already has %d detections", fileID, existingCount)
		return nil
	}

	// 3. Read image from storage
	imageData, err := h.storage.ReadFileBuffer(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to read image: %w", err)
	}

	// 4. Run object detection
	session, err := h.getSession()
	if err != nil {
		return fmt.Errorf("detection session error: %w", err)
	}

	detections, imgW, imgH, err := DetectObjects(session, imageData, h.config)
	if err != nil {
		return fmt.Errorf("object detection failed: %w", err)
	}

	if len(detections) == 0 {
		log.Printf("object:detect — no objects found in file %s", fileID)
		return nil
	}

	log.Printf("object:detect — found %d objects in file %s", len(detections), fileID)

	// 5. Insert all detections
	for _, det := range detections {
		if err := ctx.Err(); err != nil {
			return err
		}

		confidenceInt := int(math.Round(det.Confidence * 100))

		record := models.ObjectDetection{
			FileID:      uuid.MustParse(fileID),
			LibraryID:   uuid.MustParse(libraryID),
			Label:       det.Label,
			Confidence:  confidenceInt,
			BoxX:        int(det.BoxX),
			BoxY:        int(det.BoxY),
			BoxWidth:    int(det.BoxWidth),
			BoxHeight:   int(det.BoxHeight),
			ImageWidth:  imgW,
			ImageHeight: imgH,
		}

		if err := h.db.Create(&record).Error; err != nil {
			log.Printf("object:detect — failed to insert detection for file %s: %v", fileID, err)
		}
	}

	return nil
}

// NewObjectDetectTask creates a new asynq task for object detection.
func NewObjectDetectTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(ObjectDetectPayload{
		FileID:    fileID,
		LibraryID: libraryID,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeObjectDetect, payload), nil
}
