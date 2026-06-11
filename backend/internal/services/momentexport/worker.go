package momentexport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/ffmpeg"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const (
	maxHeight    = 1080
	crf          = "23"
	preset       = "medium"
	audioBitrate = "128k"
)

// TaskHandler handles moment:export asynq tasks.
type TaskHandler struct {
	db      *gorm.DB
	storage *storage.Service
}

// ProcessTask handles a single moment:export task.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload Payload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid task payload: %w", err)
	}

	return h.processMoment(ctx, payload.LibraryID, payload.FileID, payload.MomentID)
}

func (h *TaskHandler) processMoment(ctx context.Context, libraryID, fileID, momentID string) error {
	// 1. Load the moment and capture the export version we're about to satisfy.
	var moment models.Moment
	err := h.db.Where("id = ? AND library_id = ? AND file_id = ? AND trashed_at IS NULL",
		momentID, libraryID, fileID).First(&moment).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("moment:export skipping — moment %s not found", momentID)
			return nil
		}
		return err
	}
	runVersion := moment.ExportVersion

	// Already ready for this version? Skip.
	if moment.ExportedVersion != nil && *moment.ExportedVersion == runVersion {
		return nil
	}

	// 2. Mark processing.
	zero := 0
	h.setExportState(momentID, stringPtr("processing"), &zero, nil, nil)

	// 3. Stage source to a temp file.
	tmpDir, err := os.MkdirTemp("", "alcoves-moment-*")
	if err != nil {
		h.fail(momentID, "failed to create temp dir: %v", err)
		return err
	}
	defer os.RemoveAll(tmpDir)

	srcPath := filepath.Join(tmpDir, "source")
	dstPath := filepath.Join(tmpDir, "out.mp4")

	srcReader, err := h.storage.OpenFileReadStream(libraryID, fileID, nil)
	if err != nil {
		h.fail(momentID, "open source: %v", err)
		return err
	}
	srcFile, err := os.Create(srcPath)
	if err != nil {
		srcReader.Close()
		h.fail(momentID, "create source: %v", err)
		return err
	}
	if _, err := srcFile.ReadFrom(srcReader); err != nil {
		srcFile.Close()
		srcReader.Close()
		h.fail(momentID, "copy source: %v", err)
		return err
	}
	srcFile.Close()
	srcReader.Close()

	// 4. Run ffmpeg.
	clipDuration := moment.EndSeconds - moment.StartSeconds
	if clipDuration <= 0 {
		h.fail(momentID, "invalid range: %.3f–%.3f", moment.StartSeconds, moment.EndSeconds)
		return fmt.Errorf("invalid moment range")
	}

	if err := transcodeClip(ctx, srcPath, dstPath,
		moment.StartSeconds, moment.EndSeconds, clipDuration,
		func(progress int, etaSeconds *int) {
			h.setExportState(momentID, stringPtr("processing"), &progress, etaSeconds, nil)
		},
	); err != nil {
		h.fail(momentID, "ffmpeg: %v", err)
		return err
	}

	// 5. Cheap early-out before the cache upload: if the user edited the range
	// during transcode this encode is already stale. The authoritative check is
	// the guarded complete() below — this read is only an optimization.
	var fresh models.Moment
	if err := h.db.Where("id = ?", momentID).First(&fresh).Error; err != nil {
		h.fail(momentID, "reload: %v", err)
		return err
	}
	if fresh.ExportVersion != runVersion {
		log.Printf("moment:export — stale version (ran=%d, now=%d); discarding", runVersion, fresh.ExportVersion)
		return nil
	}

	// 6. Stream the output into cache storage.
	outFile, err := os.Open(dstPath)
	if err != nil {
		h.fail(momentID, "open output: %v", err)
		return err
	}
	defer outFile.Close()

	cacheKey := CacheKey(libraryID, momentID, runVersion)
	if _, err := h.storage.StoreCacheStream(cacheKey, outFile); err != nil {
		h.fail(momentID, "store cache: %v", err)
		return err
	}

	// 7. Mark ready — guarded, so an edit landing after the step-5 check still
	// can't be clobbered with stale state.
	if h.complete(momentID, runVersion) {
		log.Printf("moment:export — completed moment=%s version=%d", momentID, runVersion)
	} else {
		log.Printf("moment:export — stale version (ran=%d); discarding", runVersion)
	}
	return nil
}

// complete marks the export ready, but only if export_version still equals the
// version this run satisfied. An edit bumps the version, so the guard turns
// stale work into a no-op atomically (no read-then-write race). Returns true
// when the row was updated.
func (h *TaskHandler) complete(momentID string, version int) bool {
	res := h.db.Model(&models.Moment{}).
		Where("id = ? AND export_version = ?", momentID, version).
		Updates(map[string]interface{}{
			"export_status":      "ready",
			"export_progress":    100,
			"export_eta_seconds": nil,
			"exported_version":   version,
			"updated_at":         time.Now(),
		})
	return res.Error == nil && res.RowsAffected > 0
}

func (h *TaskHandler) setExportState(momentID string, status *string, progress *int, eta *int, exportedVersion *int) {
	updates := map[string]interface{}{
		"export_status":      status,
		"export_progress":    progress,
		"export_eta_seconds": eta,
		"updated_at":         time.Now(),
	}
	if exportedVersion != nil {
		updates["exported_version"] = *exportedVersion
	}
	h.db.Model(&models.Moment{}).Where("id = ?", momentID).Updates(updates)
}

func (h *TaskHandler) fail(momentID, format string, args ...interface{}) {
	log.Printf("moment:export — "+format, args...)
	status := "failed"
	h.setExportState(momentID, &status, nil, nil, nil)
}

func stringPtr(s string) *string { return &s }

// transcodeClip runs ffmpeg to extract + re-encode the given time range into an
// H.264/AAC MP4 at ≤1080p, writing progress to the callback.
func transcodeClip(
	ctx context.Context,
	srcPath, dstPath string,
	startSeconds, endSeconds, durationSeconds float64,
	onProgress func(progress int, etaSeconds *int),
) error {
	args := []string{
		"-ss", strconv.FormatFloat(startSeconds, 'f', 3, 64),
		"-to", strconv.FormatFloat(endSeconds, 'f', 3, 64),
		"-accurate_seek",
		"-i", srcPath,
		"-progress", "pipe:2",
		"-nostats",
		"-c:v", "libx264",
		"-crf", crf,
		"-preset", preset,
		"-profile:v", "high",
		"-level:v", "4.1",
		"-pix_fmt", "yuv420p",
		"-vf", "scale='min(1920,iw)':'min(" + strconv.Itoa(maxHeight) + ",ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
		"-c:a", "aac",
		"-b:a", audioBitrate,
		"-ac", "2",
		"-movflags", "+faststart",
		"-y",
		dstPath,
	}

	if err := ffmpeg.RunWithProgress(ctx, "ffmpeg", args, durationSeconds, onProgress); err != nil {
		return err
	}

	if info, err := os.Stat(dstPath); err != nil || info.Size() == 0 {
		return fmt.Errorf("ffmpeg produced empty output")
	}
	return nil
}
