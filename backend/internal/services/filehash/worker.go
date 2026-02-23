package filehash

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const TaskTypeFileHash = "file:hash"

// FileHashPayload is the asynq task payload for file hashing.
type FileHashPayload struct {
	FileID    string `json:"fileId"`
	LibraryID string `json:"libraryId"`
}

// TaskHandler handles file hashing asynq tasks.
type TaskHandler struct {
	db      *gorm.DB
	storage *storage.Service
}

// NewTaskHandler creates a new file hash task handler.
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service) *TaskHandler {
	return &TaskHandler{
		db:      db,
		storage: storageSvc,
	}
}

// ProcessTask handles a single file:hash task.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload FileHashPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid task payload: %w", err)
	}

	// Check file exists and doesn't already have a hash
	var file models.File
	err := h.db.Select("id, library_id, hash").
		Where("id = ? AND library_id = ?", payload.FileID, payload.LibraryID).
		First(&file).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			log.Printf("file:hash skipping — file %s not found", payload.FileID)
			return nil
		}
		return err
	}

	if file.Hash != nil {
		log.Printf("file:hash skipping — file %s already has hash", payload.FileID)
		return nil
	}

	// Stream file and compute hash
	reader, err := h.storage.OpenFileReadStream(payload.LibraryID, payload.FileID, nil)
	if err != nil {
		return fmt.Errorf("failed to open file for hashing: %w", err)
	}
	defer reader.Close()

	hr := NewHashingReader(reader)
	if _, err := io.Copy(io.Discard, hr); err != nil {
		return fmt.Errorf("failed to read file for hashing: %w", err)
	}

	hash := hr.HexSum()
	if err := h.db.Model(&models.File{}).Where("id = ?", payload.FileID).Update("hash", hash).Error; err != nil {
		return fmt.Errorf("failed to update file hash: %w", err)
	}

	log.Printf("file:hash — hashed file %s: %s", payload.FileID, hash)
	return nil
}

// NewFileHashTask creates a new asynq task for file hashing.
func NewFileHashTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(FileHashPayload{
		FileID:    fileID,
		LibraryID: libraryID,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeFileHash, payload), nil
}
