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
			return h.fail(fileID, fmt.Errorf("read file: %w", err))
		}
		// EXIF parse failures (missing/malformed) degrade gracefully to "no
		// metadata"; they are not job failures and do not burn an attempt.
		ex = parseImageMetadata(data)
	} else {
		tmpDir, err := os.MkdirTemp("", "alcoves-metadata-*")
		if err != nil {
			return h.fail(fileID, fmt.Errorf("mktemp: %w", err))
		}
		defer os.RemoveAll(tmpDir)

		srcPath := filepath.Join(tmpDir, "source")
		if err := h.copySourceToTemp(libraryID, fileID, srcPath); err != nil {
			return h.fail(fileID, err)
		}

		probed, err := probeVideoMetadata(ctx, srcPath)
		if err != nil {
			// A genuine ffprobe failure is a real error worth retrying (and
			// counting toward the 3-strike cap).
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

	// Verify we haven't been superseded by a newer reprocess request.
	var current models.File
	if err := h.db.Where("id = ?", fileID).First(&current).Error; err != nil {
		return err
	}
	if current.MetadataVersion != targetVersion {
		log.Printf("metadata: version changed (%d → %d), discarding work for file %s", targetVersion, current.MetadataVersion, fileID)
		return nil
	}

	h.complete(fileID, targetVersion, ex)
	log.Printf("metadata: complete for file %s (captured_at=%v, gps=%v)", fileID, ex.CapturedAt, ex.GpsLat != nil)
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

// fail records the error, increments the attempt counter (consulted by the
// maintenance backfill scan so a permanently-broken file is dropped after 3
// strikes), and returns the error so asynq records the failure.
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

func (h *TaskHandler) complete(fileID string, version int, ex extracted) {
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"metadata_status":            "ready",
		"metadata_error":             nil,
		"metadata_extracted_version": version,
		"captured_at":                ex.CapturedAt,
		"gps_lat":                    ex.GpsLat,
		"gps_lon":                    ex.GpsLon,
		"camera_make":                ex.CameraMake,
		"camera_model":               ex.CameraModel,
	})
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
