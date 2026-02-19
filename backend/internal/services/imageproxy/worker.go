package imageproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// TaskHandler handles image:proxy asynq tasks.
type TaskHandler struct {
	storageSvc  *storage.Service
	processor   Processor
	redisClient redis.UniversalClient
}

// ProcessTask reads the source image, transforms it via libvips, writes the
// result to both NFS cache (persistent) and Redis (fast first-waiter retrieval),
// then publishes a completion signal on the pub/sub channel.
//
// On any error, an "error:<msg>" signal is published so waiting API handlers
// fail immediately rather than blocking until the 30s timeout.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload ImageProxyPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid image proxy task payload: %w", err)
	}

	srcData, err := h.storageSvc.ReadFileBuffer(payload.LibraryID, payload.FileID)
	if err != nil {
		h.publish(ctx, payload.CacheKey, "error:failed to read source: "+err.Error())
		return fmt.Errorf("failed to read source image %s/%s: %w", payload.LibraryID, payload.FileID, err)
	}

	outBytes, _, err := h.processor.Transform(srcData, payload.Opts)
	if err != nil {
		h.publish(ctx, payload.CacheKey, "error:transform failed: "+err.Error())
		return fmt.Errorf("failed to transform image: %w", err)
	}

	// Write to NFS cache for persistent storage (future requests skip the queue).
	if err := h.storageSvc.StoreCacheBuffer(payload.CacheKey, outBytes); err != nil {
		h.publish(ctx, payload.CacheKey, "error:failed to write cache: "+err.Error())
		return fmt.Errorf("failed to write image cache at %s: %w", payload.CacheKey, err)
	}

	// Write to Redis so the first waiting API handler reads the result directly,
	// bypassing NFS attribute-cache staleness entirely.
	if h.redisClient != nil {
		if setErr := h.redisClient.Set(ctx, resultKey(payload.CacheKey), outBytes, resultTTL).Err(); setErr != nil {
			// Non-fatal: API will fall back to NFS with retries.
			log.Printf("image:proxy — warning: Redis result store failed for %s: %v", payload.CacheKey, setErr)
		}
	}

	h.publish(ctx, payload.CacheKey, "ok")
	log.Printf("image:proxy — done %s/%s → %s (%d bytes)", payload.LibraryID, payload.FileID, payload.CacheKey, len(outBytes))
	return nil
}

func (h *TaskHandler) publish(ctx context.Context, cacheKey, signal string) {
	if h.redisClient == nil {
		return
	}
	if err := h.redisClient.Publish(ctx, signalChannel(cacheKey), signal).Err(); err != nil {
		log.Printf("image:proxy — warning: failed to publish signal %q for %s: %v", signal, cacheKey, err)
	}
}
