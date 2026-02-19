package imageproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// TaskHandler handles image:proxy asynq tasks.
type TaskHandler struct {
	storageSvc *storage.Service
	processor  Processor
}

// ProcessTask reads the source image, transforms it via libvips, and writes the
// result to cache storage so the waiting API handler can return it to the client.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload ImageProxyPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid image proxy task payload: %w", err)
	}

	srcData, err := h.storageSvc.ReadFileBuffer(payload.LibraryID, payload.FileID)
	if err != nil {
		return fmt.Errorf("failed to read source image %s/%s: %w", payload.LibraryID, payload.FileID, err)
	}

	outBytes, _, err := h.processor.Transform(srcData, payload.Opts)
	if err != nil {
		return fmt.Errorf("failed to transform image: %w", err)
	}

	if err := h.storageSvc.StoreCacheBuffer(payload.CacheKey, outBytes); err != nil {
		return fmt.Errorf("failed to cache transformed image at %s: %w", payload.CacheKey, err)
	}

	log.Printf("image:proxy — cached %s/%s → %s (%d bytes)", payload.LibraryID, payload.FileID, payload.CacheKey, len(outBytes))
	return nil
}
