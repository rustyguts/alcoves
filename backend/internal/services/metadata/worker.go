package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

type Payload struct {
	LibraryID string `json:"libraryId"`
	FileID    string `json:"fileId"`
}

type TaskHandler struct {
	db      *gorm.DB
	storage *storage.Service
	cfg     *config.Config
}

func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, cfg *config.Config) *TaskHandler {
	return &TaskHandler{db: db, storage: storageSvc, cfg: cfg}
}

func NewMetadataTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(Payload{LibraryID: libraryID, FileID: fileID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeMetadata, payload), nil
}

func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var p Payload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("invalid task payload: %w", err)
	}
	return h.run(ctx, p.LibraryID, p.FileID)
}

func (h *TaskHandler) run(ctx context.Context, libraryID, fileID string) error {
	var file models.File
	if err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("metadata: skipping — file %s not found or trashed", fileID)
			return nil
		}
		return err
	}

	isImage := strings.HasPrefix(file.MimeType, "image/")
	isVideo := strings.HasPrefix(file.MimeType, "video/")
	if !isImage && !isVideo {
		log.Printf("metadata: skipping — file %s not image/video (%s)", fileID, file.MimeType)
		return nil
	}

	targetVersion := file.MetadataVersion
	h.setStatus(fileID, "processing", nil)

	var ex extracted
	if isImage {
		// Images are buffered whole — phone photos are small and the EXIF block
		// lives in the first few KB, but ReadFileBuffer keeps the storage path
		// identical to the other image workers.
		data, err := h.storage.ReadFileBuffer(libraryID, fileID)
		if err != nil {
			// A storage read failure is infrastructure (S3 blip, disk error),
			// not a broken file — retry without burning a 3-strike attempt.
			return h.failTransient(fileID, fmt.Errorf("read file: %w", err))
		}
		// EXIF parse failures (missing/malformed) degrade gracefully to "no
		// metadata"; they are not job failures and do not burn an attempt.
		ex = parseImageMetadata(data)
	} else {
		// Prefer probing the source in place on local storage — ffprobe only
		// needs to seek the container's metadata, so copying the whole (possibly
		// multi-GB) file is wasteful. Non-local drivers (S3) fall back to a temp
		// copy because ffprobe needs a seekable handle.
		srcPath, isLocal := h.storage.LocalFilePath(libraryID, fileID)
		if !isLocal {
			tmpDir, err := os.MkdirTemp("", "alcoves-metadata-*")
			if err != nil {
				return h.failTransient(fileID, fmt.Errorf("mktemp: %w", err))
			}
			defer os.RemoveAll(tmpDir)

			srcPath = filepath.Join(tmpDir, "source")
			if err := h.copySourceToTemp(libraryID, fileID, srcPath); err != nil {
				return h.failTransient(fileID, err)
			}
		}

		probed, err := probeVideoMetadata(ctx, srcPath)
		if err != nil {
			// A bad container is a genuine per-file failure that should count
			// toward the 3-strike cap; a probe that never ran (ffprobe missing,
			// worker shutting down) is infrastructure and must not burn one.
			if isTransientProbeError(err) {
				return h.failTransient(fileID, fmt.Errorf("probe video: %w", err))
			}
			return h.fail(fileID, fmt.Errorf("probe video: %w", err))
		}
		ex = probed
	}

	// Coalesce the effective capture date: EXIF/probe → upload lastModified →
	// row creation. captured_at is always non-null after a successful run so the
	// timeline has a stable sort key.
	capturedAt := ex.CapturedAt
	if capturedAt == nil {
		capturedAt = file.OriginalCreatedAt
	}
	if capturedAt == nil {
		c := file.CreatedAt
		capturedAt = &c
	}
	ex.CapturedAt = capturedAt

	// Apply the result only if a concurrent reprocess hasn't bumped the version
	// out from under us. The guarded UPDATE makes the check-and-write atomic, so
	// a reprocess landing mid-run can never leave stale data behind.
	if h.complete(fileID, targetVersion, ex) {
		log.Printf("metadata: complete for file %s (captured_at=%v, gps=%v)", fileID, ex.CapturedAt, ex.GpsLat != nil)
	} else {
		log.Printf("metadata: version moved on, discarding stale work for file %s", fileID)
	}
	return nil
}

func (h *TaskHandler) copySourceToTemp(libraryID, fileID, dst string) error {
	r, err := h.storage.OpenFileReadStream(libraryID, fileID, nil)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer r.Close()
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return err
	}
	return nil
}

func (h *TaskHandler) setStatus(fileID, status string, errMsg *string) {
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"metadata_status": status,
		"metadata_error":  errMsg,
	})
}

// fail records a genuine per-file failure (a broken/unreadable file): it
// increments the attempt counter consulted by the maintenance backfill scan so
// a permanently-broken file is dropped after 3 strikes, and returns the error
// so asynq records the failure.
func (h *TaskHandler) fail(fileID string, err error) error {
	log.Printf("metadata: failed for file %s: %v", fileID, err)
	msg := err.Error()
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"metadata_status":   "failed",
		"metadata_error":    &msg,
		"metadata_attempts": gorm.Expr("metadata_attempts + 1"),
	})
	return err
}

// failTransient records an infrastructure failure (storage read error, ffprobe
// couldn't start, worker shutting down) WITHOUT incrementing the attempt
// counter, so a transient outage can't exhaust the 3-strike cap and permanently
// sideline an otherwise-healthy file. asynq still retries via the returned
// error, and the maintenance scan re-selects the file on its next pass.
func (h *TaskHandler) failTransient(fileID string, err error) error {
	log.Printf("metadata: transient failure for file %s: %v", fileID, err)
	msg := err.Error()
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"metadata_status": "failed",
		"metadata_error":  &msg,
	})
	return err
}

// complete writes the extracted metadata, but only if metadata_version still
// equals the version this run started from. A reprocess bumps the version, so
// the guard turns stale work into a no-op atomically (no read-then-write race).
// Returns true when the row was updated.
func (h *TaskHandler) complete(fileID string, version int, ex extracted) bool {
	res := h.db.Model(&models.File{}).
		Where("id = ? AND metadata_version = ?", fileID, version).
		Updates(map[string]interface{}{
			"metadata_status":            "ready",
			"metadata_error":             nil,
			"metadata_extracted_version": version,
			"captured_at":                ex.CapturedAt,
			"gps_lat":                    ex.GpsLat,
			"gps_lon":                    ex.GpsLon,
			"camera_make":                ex.CameraMake,
			"camera_model":               ex.CameraModel,
		})
	return res.Error == nil && res.RowsAffected > 0
}

// isTransientProbeError reports whether an ffprobe error is infrastructure
// rather than an unreadable file. *exec.ExitError means ffprobe ran and
// rejected the file — a real per-file failure that should count toward the cap.
// A probe that never started (*exec.Error: binary missing) or a cancelled
// context (worker shutdown) is transient. Unknown shapes default to transient
// so a quirk can't permanently exhaust the cap; a truly broken file still fails
// with an ExitError and is counted.
func isTransientProbeError(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return false
	}
	return true
}

// probeVideoMetadata runs ffprobe and extracts capture time + GPS from container
// tags. ffprobe is invoked as a bare command, matching videoproxy's usage.
func probeVideoMetadata(ctx context.Context, srcPath string) (extracted, error) {
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		srcPath,
	)
	out, err := cmd.Output()
	if err != nil {
		return extracted{}, fmt.Errorf("ffprobe: %w", err)
	}
	return parseProbeMetadata(out), nil
}
