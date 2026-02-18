package facedetection

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strings"
	"sync"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	ort "github.com/yalue/onnxruntime_go"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const (
	TaskTypeFaceDetect = "face:detect"
	thumbnailSize      = 150
	thumbnailPadding   = 0.3 // 30% padding around face crop
)

// FaceDetectPayload is the asynq task payload for face detection.
type FaceDetectPayload struct {
	FileID    string `json:"fileId"`
	LibraryID string `json:"libraryId"`
}

// TaskHandler handles face detection asynq tasks.
type TaskHandler struct {
	db         *gorm.DB
	storage    *storage.Service
	config     *FaceConfig

	// Lazy-loaded ONNX sessions (thread-safe)
	detOnce     sync.Once
	detSession  *ort.DynamicAdvancedSession
	detErr      error
	recOnce     sync.Once
	recSession  *ort.DynamicAdvancedSession
	recErr      error
}

// NewTaskHandler creates a new face detection task handler.
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, config *FaceConfig) *TaskHandler {
	return &TaskHandler{
		db:      db,
		storage: storageSvc,
		config:  config,
	}
}

func (h *TaskHandler) getDetectionSession() (*ort.DynamicAdvancedSession, error) {
	h.detOnce.Do(func() {
		h.detSession, h.detErr = LoadDetectionSession(h.config.ModelsPath)
	})
	return h.detSession, h.detErr
}

func (h *TaskHandler) getRecognitionSession() (*ort.DynamicAdvancedSession, error) {
	h.recOnce.Do(func() {
		h.recSession, h.recErr = LoadRecognitionSession(h.config.ModelsPath)
	})
	return h.recSession, h.recErr
}

// ProcessTask handles a single face:detect task.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload FaceDetectPayload
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
			log.Printf("face:detect skipping — file %s not found or trashed", fileID)
			return nil // Don't retry
		}
		return err
	}

	if !strings.HasPrefix(file.MimeType, "image/") {
		log.Printf("face:detect skipping — file %s is not an image (%s)", fileID, file.MimeType)
		return nil
	}

	// 2. Check idempotency — skip if detections already exist
	var existingCount int64
	h.db.Model(&models.FaceDetection{}).Where("file_id = ?", fileID).Count(&existingCount)
	if existingCount > 0 {
		log.Printf("face:detect skipping — file %s already has %d detections", fileID, existingCount)
		return nil
	}

	// 3. Read image from storage
	imageData, err := h.storage.ReadFileBuffer(libraryID, fileID)
	if err != nil {
		return fmt.Errorf("failed to read image: %w", err)
	}

	// 4. Run face detection
	detSession, err := h.getDetectionSession()
	if err != nil {
		return fmt.Errorf("detection session error: %w", err)
	}

	faces, imgW, imgH, err := DetectFaces(detSession, imageData, h.config.MinScore)
	if err != nil {
		return fmt.Errorf("face detection failed: %w", err)
	}

	if len(faces) == 0 {
		log.Printf("face:detect — no faces found in file %s", fileID)
		return nil
	}

	log.Printf("face:detect — found %d faces in file %s", len(faces), fileID)

	// 5. Process each face
	log.Printf("face:detect — loading recognition session for file %s", fileID)
	recSession, err := h.getRecognitionSession()
	if err != nil {
		log.Printf("face:detect — RECOGNITION SESSION ERROR for file %s: %v", fileID, err)
		return fmt.Errorf("recognition session error: %w", err)
	}
	log.Printf("face:detect — recognition session loaded successfully for file %s", fileID)

	log.Printf("face:detect — about to process %d faces for file %s", len(faces), fileID)

	for i, face := range faces {
		log.Printf("face:detect — processing face %d/%d for file %s", i+1, len(faces), fileID)
		if err := ctx.Err(); err != nil {
			return err // Task was cancelled
		}

		if err := h.processSingleFace(ctx, libraryID, fileID, imageData, face, imgW, imgH, recSession); err != nil {
			log.Printf("face:detect — error processing face in %s: %v", fileID, err)
			// Continue processing other faces
		}
	}

	return nil
}

func (h *TaskHandler) processSingleFace(
	ctx context.Context,
	libraryID, fileID string,
	imageData []byte,
	face DetectedFace,
	imgW, imgH int,
	recSession *ort.DynamicAdvancedSession,
) error {
	log.Printf("face:detect — processSingleFace called for file %s", fileID)

	// Compute embedding
	embedding, err := ComputeEmbedding(recSession, imageData, face)
	if err != nil {
		return fmt.Errorf("embedding computation failed: %w", err)
	}

	// Compute quality score
	quality := ComputeFaceQuality(face, imgW, imgH)
	qualityInt := int(math.Round(quality * 100))
	confidenceInt := int(math.Round(face.Confidence * 100))

	// Insert face detection record with embedding via raw SQL
	detectionID := uuid.New()
	embStr := embeddingToString(embedding)

	log.Printf("face:detect — inserting detection %s for file %s, embedding length: %d", detectionID, fileID, len(embedding))

	err = h.db.Exec(`
		INSERT INTO face_detections (id, file_id, library_id, box_x, box_y, box_width, box_height,
			image_width, image_height, confidence, quality_score, embedding, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector, NOW())
	`,
		detectionID, fileID, libraryID,
		int(face.Box.X), int(face.Box.Y), int(face.Box.Width), int(face.Box.Height),
		imgW, imgH, confidenceInt, qualityInt, embStr,
	).Error
	if err != nil {
		log.Printf("face:detect — INSERT ERROR for detection %s: %v", detectionID, err)
		return fmt.Errorf("failed to insert detection: %w", err)
	}

	log.Printf("face:detect — successfully inserted detection %s", detectionID)

	// Assign to person using core-point clustering
	result, err := AssignFaceUsingCorePoint(h.db, h.config, libraryID, detectionID, embedding)
	if err != nil {
		log.Printf("face:detect — clustering error for detection %s: %v", detectionID, err)
		// Don't fail the whole task for a clustering error
	}

	// If a new person was created, try auto-merge
	if result != nil && result.IsNew {
		finalID, err := ReconcileNewPerson(h.db, h.config, libraryID, result.PersonID)
		if err != nil {
			log.Printf("face:detect — reconcile error for person %s: %v", result.PersonID, err)
		}
		_ = finalID
	}

	// Generate thumbnail: crop face with padding, resize to 150x150, encode WebP
	if err := h.generateFaceThumbnail(imageData, face, libraryID, detectionID.String()); err != nil {
		log.Printf("face:detect — thumbnail error for detection %s: %v", detectionID, err)
		// Non-fatal
	}

	return nil
}

// generateFaceThumbnail crops the face region with padding, resizes to 150x150, and stores as WebP.
func (h *TaskHandler) generateFaceThumbnail(imageData []byte, face DetectedFace, libraryID, detectionID string) error {
	img, err := vips.NewImageFromBuffer(imageData)
	if err != nil {
		return err
	}
	defer img.Close()

	imgW := img.Width()
	imgH := img.Height()

	// Compute crop region with padding
	padW := face.Box.Width * thumbnailPadding
	padH := face.Box.Height * thumbnailPadding

	cropX := int(math.Max(0, face.Box.X-padW))
	cropY := int(math.Max(0, face.Box.Y-padH))
	cropW := int(math.Min(float64(imgW)-float64(cropX), face.Box.Width+2*padW))
	cropH := int(math.Min(float64(imgH)-float64(cropY), face.Box.Height+2*padH))

	if cropW <= 0 || cropH <= 0 {
		return fmt.Errorf("invalid crop dimensions")
	}

	// Crop
	if err := img.ExtractArea(cropX, cropY, cropW, cropH); err != nil {
		return err
	}

	// Resize to 150x150 (square)
	scale := float64(thumbnailSize) / math.Max(float64(cropW), float64(cropH))
	if err := img.Resize(scale, vips.KernelLinear); err != nil {
		return err
	}

	// Ensure exactly 150x150 with padding if needed
	currentW := img.Width()
	currentH := img.Height()
	if currentW < thumbnailSize || currentH < thumbnailSize {
		padLeft := (thumbnailSize - currentW) / 2
		padTop := (thumbnailSize - currentH) / 2
		if err := img.Embed(padLeft, padTop, thumbnailSize, thumbnailSize, vips.ExtendBlack); err != nil {
			return err
		}
	}

	// Export as WebP
	webpParams := vips.NewWebpExportParams()
	webpParams.Quality = 80
	webpData, _, err := img.ExportWebp(webpParams)
	if err != nil {
		return err
	}

	// Store in cache
	cacheKey := fmt.Sprintf("%s/faces/%s.webp", libraryID, detectionID)
	return h.storage.StoreCacheBuffer(cacheKey, webpData)
}

// NewFaceDetectTask creates a new asynq task for face detection.
func NewFaceDetectTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(FaceDetectPayload{
		FileID:    fileID,
		LibraryID: libraryID,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeFaceDetect, payload), nil
}
