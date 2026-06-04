package imageproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// PrewarmTaskHandler processes image:prewarm tasks: it generates every Variant
// for one file and writes them to the transform cache, so the first real
// request is a warm-cache hit. It is idempotent — already-cached variants are
// skipped — and tracks per-file attempts so a permanently-broken file is
// dropped after maxPrewarmAttempts strikes (see maintenance.go).
type PrewarmTaskHandler struct {
	db         *gorm.DB
	storageSvc *storage.Service
	processor  Processor
}

func NewPrewarmTaskHandler(db *gorm.DB, storageSvc *storage.Service, processor Processor) *PrewarmTaskHandler {
	return &PrewarmTaskHandler{db: db, storageSvc: storageSvc, processor: processor}
}

// ProcessTask is the asynq entrypoint.
func (h *PrewarmTaskHandler) ProcessTask(_ context.Context, t *asynq.Task) error {
	var p PrewarmPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("invalid prewarm task payload: %w", err)
	}
	return h.run(p.LibraryID, p.FileID)
}

func (h *PrewarmTaskHandler) run(libraryID, fileID string) error {
	if h.processor == nil {
		// No transform backend (e.g. a build without libvips). Nothing to do;
		// don't burn an attempt — degrade gracefully.
		return nil
	}

	var file models.File
	if err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// File deleted/trashed between scan and processing — not a failure.
			log.Printf("image:prewarm — skipping, file %s not found or trashed", fileID)
			return nil
		}
		return err
	}

	if !strings.HasPrefix(file.MimeType, "image/") {
		// The scan only selects images, but guard so a stray enqueue is a no-op
		// rather than a permanent failure.
		log.Printf("image:prewarm — skipping non-image file %s (%s)", fileID, file.MimeType)
		return nil
	}

	h.setStatus(fileID, "processing", nil)

	// Read the source once and reuse it for every variant.
	srcData, err := h.storageSvc.ReadFileBuffer(libraryID, fileID)
	if err != nil {
		// Storage read failure is infrastructure (disk/S3 blip), not a broken
		// file — retry on the next pass WITHOUT burning a strike.
		return h.failTransient(fileID, fmt.Errorf("read source: %w", err))
	}

	generated := 0
	for _, v := range Variants {
		opts := v.Resolve(file.Width, file.Height)
		cacheKey := TransformCacheKey(libraryID, fileID, opts)

		// Idempotent: a variant already in the cache (warmed earlier, or filled
		// on-demand by a real request) is left untouched.
		if exists, _ := h.storageSvc.CacheExists(cacheKey); exists {
			continue
		}

		outBytes, _, terr := h.processor.Transform(srcData, opts)
		if terr != nil {
			// A transform failure means the source bytes are unreadable by the
			// image pipeline (corrupt / unsupported) — a genuine per-file
			// failure that should count toward the 3-strike cap. Every variant
			// reads the same bytes, so the rest would fail identically; stop.
			return h.fail(fileID, fmt.Errorf("transform variant %q: %w", v.Name, terr))
		}

		if err := h.storageSvc.StoreCacheBuffer(cacheKey, outBytes); err != nil {
			// Cache write failure is infrastructure (disk full / S3) — transient.
			return h.failTransient(fileID, fmt.Errorf("write cache %s: %w", cacheKey, err))
		}
		generated++
	}

	h.complete(fileID)
	log.Printf("image:prewarm — done %s/%s (%d generated, %d total variants)", libraryID, fileID, generated, len(Variants))
	return nil
}

func (h *PrewarmTaskHandler) setStatus(fileID, status string, errMsg *string) {
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"image_proxy_status": status,
		"image_proxy_error":  errMsg,
	})
}

// fail records a genuine per-file failure (corrupt/unsupported source): it
// increments image_proxy_attempts, which the maintenance scan caps at
// maxPrewarmAttempts so a permanently-broken file is dropped after 3 strikes.
// The returned error is surfaced to asynq for visibility in the dashboard.
func (h *PrewarmTaskHandler) fail(fileID string, err error) error {
	log.Printf("image:prewarm — failed for file %s: %v", fileID, err)
	msg := err.Error()
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"image_proxy_status":   "failed",
		"image_proxy_error":    &msg,
		"image_proxy_attempts": gorm.Expr("image_proxy_attempts + 1"),
	})
	return err
}

// failTransient records an infrastructure failure (storage read/write error)
// WITHOUT incrementing the strike counter, so a transient outage can't exhaust
// the 3-strike cap and permanently sideline a healthy file. The next hourly
// pass re-selects it.
func (h *PrewarmTaskHandler) failTransient(fileID string, err error) error {
	log.Printf("image:prewarm — transient failure for file %s: %v", fileID, err)
	msg := err.Error()
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"image_proxy_status": "failed",
		"image_proxy_error":  &msg,
	})
	return err
}

// complete marks the file fully warmed at the current VariantsVersion and resets
// the strike counter (a healthy file earns a clean slate). The scan keys on
// image_proxy_warmed_version IS NULL, so this removes the file from the backlog.
func (h *PrewarmTaskHandler) complete(fileID string) {
	version := VariantsVersion
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"image_proxy_status":         "ready",
		"image_proxy_error":          nil,
		"image_proxy_warmed_version": &version,
		"image_proxy_attempts":       0,
	})
}
