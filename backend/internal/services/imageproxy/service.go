package imageproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const (
	TaskTypeImageProxy = "image:proxy"
	ImageProxyQueue    = "imageproxy"
	transformTimeout   = 30 * time.Second
	pollInterval       = 25 * time.Millisecond
)

// ImageProxyPayload is the asynq task payload for image proxy tasks.
type ImageProxyPayload struct {
	LibraryID string           `json:"libraryId"`
	FileID    string           `json:"fileId"`
	CacheKey  string           `json:"cacheKey"`
	Opts      TransformOptions `json:"opts"`
}

// Service manages image proxy caching and queued processing.
type Service struct {
	storageSvc  *storage.Service
	asynqClient *asynq.Client
	processor   Processor
}

// NewService creates an image proxy service.
func NewService(storageSvc *storage.Service, asynqClient *asynq.Client, processor Processor) *Service {
	return &Service{
		storageSvc:  storageSvc,
		asynqClient: asynqClient,
		processor:   processor,
	}
}

// TransformCacheKey returns a deterministic cache key for a given file + transform options.
func TransformCacheKey(libraryID, fileID string, opts TransformOptions) string {
	format := opts.Format
	if format == "" {
		format = "jpeg"
	}
	quality := opts.Quality
	if quality == 0 {
		quality = 80
	}
	return fmt.Sprintf("%s/%s/transforms/w%d_h%d_q%d.%s", libraryID, fileID, opts.Width, opts.Height, quality, format)
}

// ServeTransform checks the cache for a previously transformed image, enqueues a
// highest-priority job on cache miss, and polls until the worker writes the result.
// Returns the transformed image bytes and MIME type.
//
// If no asynq client is configured (nil), the transform runs inline — this
// covers local development and tests that run without a queue.
func (s *Service) ServeTransform(ctx context.Context, libraryID, fileID string, opts TransformOptions) ([]byte, string, error) {
	cacheKey := TransformCacheKey(libraryID, fileID, opts)

	// Fast path: already cached.
	if data, mime, err := s.readCache(cacheKey, opts); err == nil {
		return data, mime, nil
	}

	// No queue — transform inline (dev/test mode).
	if s.asynqClient == nil {
		return s.transformInline(libraryID, fileID, cacheKey, opts)
	}

	// Enqueue a highest-priority task. A stable task ID derived from the cache key
	// causes concurrent requests for the same image+params to coalesce into one job.
	taskID := "imgproxy:" + cacheKey
	payload, err := json.Marshal(ImageProxyPayload{
		LibraryID: libraryID,
		FileID:    fileID,
		CacheKey:  cacheKey,
		Opts:      opts,
	})
	if err != nil {
		return nil, "", fmt.Errorf("failed to marshal image proxy task: %w", err)
	}

	task := asynq.NewTask(TaskTypeImageProxy, payload)
	_, enqErr := s.asynqClient.Enqueue(task,
		asynq.Queue(ImageProxyQueue),
		asynq.TaskID(taskID),
		asynq.MaxRetry(0),
		asynq.Retention(5*time.Minute),
	)
	if enqErr != nil && !errors.Is(enqErr, asynq.ErrTaskIDConflict) {
		return nil, "", fmt.Errorf("failed to enqueue image proxy task: %w", enqErr)
	}
	if errors.Is(enqErr, asynq.ErrTaskIDConflict) {
		log.Printf("image:proxy — task already queued for %s, waiting for result", cacheKey)
	}

	// Poll for the cache result until it appears or the deadline is reached.
	deadline := time.Now().Add(transformTimeout)
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, "", ctx.Err()
		case t := <-ticker.C:
			if t.After(deadline) {
				return nil, "", fmt.Errorf("timeout waiting for image transform")
			}
			if data, mime, err := s.readCache(cacheKey, opts); err == nil {
				return data, mime, nil
			}
		}
	}
}

func (s *Service) transformInline(libraryID, fileID, cacheKey string, opts TransformOptions) ([]byte, string, error) {
	srcData, err := s.storageSvc.ReadFileBuffer(libraryID, fileID)
	if err != nil {
		return nil, "", fmt.Errorf("failed to read source image: %w", err)
	}
	outBytes, _, err := s.processor.Transform(srcData, opts)
	if err != nil {
		return nil, "", fmt.Errorf("failed to transform image: %w", err)
	}
	// Store in cache so repeat requests skip processing entirely.
	_ = s.storageSvc.StoreCacheBuffer(cacheKey, outBytes)
	return outBytes, MIMEForOpts(opts), nil
}

func (s *Service) readCache(cacheKey string, opts TransformOptions) ([]byte, string, error) {
	exists, err := s.storageSvc.CacheExists(cacheKey)
	if err != nil || !exists {
		return nil, "", fmt.Errorf("cache miss")
	}
	data, err := s.storageSvc.ReadCacheBuffer(cacheKey)
	if err != nil {
		return nil, "", err
	}
	return data, MIMEForOpts(opts), nil
}

// MIMEForOpts returns the MIME type corresponding to the requested output format.
func MIMEForOpts(opts TransformOptions) string {
	switch opts.Format {
	case "webp":
		return "image/webp"
	case "avif":
		return "image/avif"
	case "png":
		return "image/png"
	default:
		return "image/jpeg"
	}
}

// NewTaskHandler returns the asynq task handler for image proxy tasks.
func (s *Service) NewTaskHandler() *TaskHandler {
	return &TaskHandler{storageSvc: s.storageSvc, processor: s.processor}
}
