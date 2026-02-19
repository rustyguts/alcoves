package imageproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const (
	TaskTypeImageProxy = "image:proxy"
	ImageProxyQueue    = "imageproxy"
	transformTimeout   = 30 * time.Second
	// uniqueTTL is the deduplication window for enqueued tasks.
	// Using Unique (Redis lock with TTL) instead of TaskID means failed/archived
	// tasks can be re-enqueued once the lock expires, rather than conflicting forever.
	uniqueTTL = 2 * time.Minute
	// resultTTL is how long the worker stores result bytes in Redis.
	// The first waiting request reads from Redis (bypassing NFS staleness);
	// subsequent requests hit the NFS cache directly.
	resultTTL = 10 * time.Minute
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
	redisClient redis.UniversalClient
	processor   Processor
}

// NewService creates an image proxy service.
//
// redisConnOpt may be nil, in which case the service falls back to inline
// processing (used in dev and tests that run without a queue).
func NewService(storageSvc *storage.Service, asynqClient *asynq.Client, redisConnOpt asynq.RedisConnOpt, processor Processor) *Service {
	svc := &Service{
		storageSvc:  storageSvc,
		asynqClient: asynqClient,
		processor:   processor,
	}
	if redisConnOpt != nil {
		if rc, ok := redisConnOpt.MakeRedisClient().(redis.UniversalClient); ok {
			svc.redisClient = rc
		}
	}
	return svc
}

// signalChannel returns the Redis pub/sub channel for a given cache key.
// The worker publishes "ok" or "error:<msg>" here on completion.
func signalChannel(cacheKey string) string {
	return "imageproxy:done:" + cacheKey
}

// resultKey returns the Redis key where the worker temporarily stores result
// bytes so the first waiter can read them without touching NFS.
func resultKey(cacheKey string) string {
	return "imageproxy:bytes:" + cacheKey
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

// ServeTransform returns a transformed image, using the following strategy:
//
//  1. Fast path — check NFS cache (already processed by a previous request).
//  2. Subscribe to the Redis pub/sub completion channel BEFORE enqueueing so
//     no signal is missed.
//  3. Check NFS cache and Redis result key again (handles the race where the
//     job completed between the subscribe and the check).
//  4. Enqueue the job with asynq.Unique so failed/archived tasks do not
//     permanently block re-enqueueing (unlike asynq.TaskID).
//  5. Wait on the pub/sub channel for the worker to publish "ok" or "error:…".
//     On "ok", read result from Redis (fast, NFS-staleness-free) then fall
//     back to NFS with a brief retry if the Redis key has already expired.
//
// If no asynq/Redis client is configured, transforms inline (dev / tests).
func (s *Service) ServeTransform(ctx context.Context, libraryID, fileID string, opts TransformOptions) ([]byte, string, error) {
	cacheKey := TransformCacheKey(libraryID, fileID, opts)

	// 1. Fast path: NFS cache hit.
	if data, mime, err := s.readNFSCache(cacheKey, opts); err == nil {
		return data, mime, nil
	}

	// No queue configured — transform inline.
	if s.asynqClient == nil || s.redisClient == nil {
		return s.transformInline(libraryID, fileID, cacheKey, opts)
	}

	// 2. Subscribe before doing anything else so we cannot miss the signal.
	pubsub := s.redisClient.Subscribe(ctx, signalChannel(cacheKey))
	defer pubsub.Close()

	// 3a. Check NFS cache again (might have completed just before subscribe).
	if data, mime, err := s.readNFSCache(cacheKey, opts); err == nil {
		return data, mime, nil
	}
	// 3b. Check Redis result key (worker may have completed but NFS not yet visible).
	if data, mime, err := s.readRedisResult(ctx, cacheKey, opts); err == nil {
		return data, mime, nil
	}

	// 4. Enqueue. asynq.Unique deduplicates within uniqueTTL using a Redis lock;
	//    the lock expires naturally so re-enqueueing works after a task failure.
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
		asynq.MaxRetry(0),
		asynq.Unique(uniqueTTL),
		asynq.Retention(5*time.Minute),
	)
	if enqErr != nil && !errors.Is(enqErr, asynq.ErrDuplicateTask) {
		return nil, "", fmt.Errorf("failed to enqueue image proxy task: %w", enqErr)
	}
	if errors.Is(enqErr, asynq.ErrDuplicateTask) {
		log.Printf("image:proxy — duplicate task, joining wait for %s", cacheKey)
	}

	// Check Redis result once more after enqueue (handles race between subscribe
	// and enqueue where the job may have already completed).
	if data, mime, err := s.readRedisResult(ctx, cacheKey, opts); err == nil {
		return data, mime, nil
	}

	// 5. Wait for the completion signal.
	waitCtx, cancel := context.WithTimeout(ctx, transformTimeout)
	defer cancel()

	ch := pubsub.Channel()
	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return nil, "", fmt.Errorf("image proxy signal channel closed unexpectedly")
			}
			if strings.HasPrefix(msg.Payload, "error:") {
				return nil, "", fmt.Errorf("image transform failed: %s", strings.TrimPrefix(msg.Payload, "error:"))
			}
			// "ok" — read from Redis first (bypasses NFS staleness).
			if data, mime, err := s.readRedisResult(ctx, cacheKey, opts); err == nil {
				return data, mime, nil
			}
			// Redis key expired; fall back to NFS with brief retry to allow
			// NFS attribute cache to propagate the newly written file.
			return s.readNFSCacheWithRetry(cacheKey, opts)

		case <-waitCtx.Done():
			if ctx.Err() != nil {
				return nil, "", ctx.Err()
			}
			return nil, "", fmt.Errorf("timeout waiting for image transform")
		}
	}
}

func (s *Service) readNFSCache(cacheKey string, opts TransformOptions) ([]byte, string, error) {
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

// readNFSCacheWithRetry retries NFS reads to handle attribute cache staleness
// after receiving the "ok" signal (when the Redis result key has already expired).
func (s *Service) readNFSCacheWithRetry(cacheKey string, opts TransformOptions) ([]byte, string, error) {
	const retries = 5
	const delay = 100 * time.Millisecond
	for i := 0; i < retries; i++ {
		if data, mime, err := s.readNFSCache(cacheKey, opts); err == nil {
			return data, mime, nil
		}
		time.Sleep(delay)
	}
	return nil, "", fmt.Errorf("image transform result not found after signal (NFS propagation timeout)")
}

func (s *Service) readRedisResult(ctx context.Context, cacheKey string, opts TransformOptions) ([]byte, string, error) {
	data, err := s.redisClient.Get(ctx, resultKey(cacheKey)).Bytes()
	if err != nil {
		return nil, "", err
	}
	return data, MIMEForOpts(opts), nil
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
	_ = s.storageSvc.StoreCacheBuffer(cacheKey, outBytes)
	return outBytes, MIMEForOpts(opts), nil
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
	return &TaskHandler{storageSvc: s.storageSvc, processor: s.processor, redisClient: s.redisClient}
}
