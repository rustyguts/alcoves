package videoproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const (
	TaskTypeVideoProxy = "video:proxy"

	// ffmpeg encoding settings for web proxy
	maxHeight     = 1080
	crf           = "23"
	preset        = "medium"
	audioBitrate  = "128k"
	thumbnailTime = "00:00:01" // extract thumbnail at 1 second
)

// VideoProxyPayload is the asynq task payload for video proxy generation.
type VideoProxyPayload struct {
	FileID    string `json:"fileId"`
	LibraryID string `json:"libraryId"`
}

// TaskHandler handles video proxy asynq tasks.
type TaskHandler struct {
	db      *gorm.DB
	storage *storage.Service
}

// NewTaskHandler creates a new video proxy task handler.
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service) *TaskHandler {
	return &TaskHandler{
		db:      db,
		storage: storageSvc,
	}
}

// ProcessTask handles a single video:proxy task.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload VideoProxyPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid task payload: %w", err)
	}

	return h.processVideo(ctx, payload.LibraryID, payload.FileID)
}

func (h *TaskHandler) processVideo(ctx context.Context, libraryID, fileID string) error {
	// 1. Validate file exists, is video, not trashed
	var file models.File
	err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			log.Printf("video:proxy skipping — file %s not found or trashed", fileID)
			return nil
		}
		return err
	}

	if !strings.HasPrefix(file.MimeType, "video/") {
		log.Printf("video:proxy skipping — file %s is not a video (%s)", fileID, file.MimeType)
		return nil
	}

	// 2. Check idempotency — skip if already ready
	if file.ProxyStatus != nil && *file.ProxyStatus == "ready" {
		log.Printf("video:proxy skipping — file %s proxy already ready", fileID)
		return nil
	}

	// 3. Set status to processing
	h.setProxyStatus(fileID, "processing")

	// 4. Read source video to a temp file (ffmpeg needs file access)
	tmpDir, err := os.MkdirTemp("", "alcoves-proxy-*")
	if err != nil {
		h.setProxyStatus(fileID, "failed")
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	srcPath := filepath.Join(tmpDir, "source")
	proxyPath := filepath.Join(tmpDir, "proxy.mp4")
	thumbPath := filepath.Join(tmpDir, "thumbnail.webp")

	reader, err := h.storage.OpenFileReadStream(libraryID, fileID, nil)
	if err != nil {
		h.setProxyStatus(fileID, "failed")
		return fmt.Errorf("failed to open source file: %w", err)
	}

	srcFile, err := os.Create(srcPath)
	if err != nil {
		reader.Close()
		h.setProxyStatus(fileID, "failed")
		return fmt.Errorf("failed to create temp source: %w", err)
	}

	if _, err := srcFile.ReadFrom(reader); err != nil {
		srcFile.Close()
		reader.Close()
		h.setProxyStatus(fileID, "failed")
		return fmt.Errorf("failed to write temp source: %w", err)
	}
	srcFile.Close()
	reader.Close()

	// 5. Probe source to determine if transcoding is needed
	needsTranscode, sourceHeight, err := probeVideo(ctx, srcPath)
	if err != nil {
		log.Printf("video:proxy — probe failed for %s, will transcode anyway: %v", fileID, err)
		needsTranscode = true
	}

	if !needsTranscode {
		// Source is already web-compatible H.264/AAC MP4
		log.Printf("video:proxy — file %s is already web-compatible, marking as not_needed", fileID)
		h.setProxyStatus(fileID, "not_needed")

		// Still generate thumbnail
		if err := generateThumbnail(ctx, srcPath, thumbPath); err != nil {
			log.Printf("video:proxy — thumbnail failed for %s: %v", fileID, err)
		} else {
			h.storeThumbnail(libraryID, fileID, thumbPath)
		}

		return nil
	}

	// 6. Transcode with ffmpeg
	log.Printf("video:proxy — transcoding file %s (source height: %d)", fileID, sourceHeight)

	if err := transcodeVideo(ctx, srcPath, proxyPath, sourceHeight); err != nil {
		h.setProxyStatus(fileID, "failed")
		return fmt.Errorf("ffmpeg transcode failed: %w", err)
	}

	// 7. Store proxy in cache
	proxyData, err := os.ReadFile(proxyPath)
	if err != nil {
		h.setProxyStatus(fileID, "failed")
		return fmt.Errorf("failed to read proxy output: %w", err)
	}

	cacheKey := fmt.Sprintf("%s/%s/proxy.mp4", libraryID, fileID)
	if err := h.storage.StoreCacheBuffer(cacheKey, proxyData); err != nil {
		h.setProxyStatus(fileID, "failed")
		return fmt.Errorf("failed to store proxy: %w", err)
	}

	// 8. Generate and store thumbnail
	if err := generateThumbnail(ctx, srcPath, thumbPath); err != nil {
		log.Printf("video:proxy — thumbnail failed for %s: %v", fileID, err)
	} else {
		h.storeThumbnail(libraryID, fileID, thumbPath)
	}

	// 9. Mark as ready
	h.setProxyStatus(fileID, "ready")
	log.Printf("video:proxy — completed for file %s", fileID)

	return nil
}

// probeVideo checks if the video needs transcoding. Returns false if it's
// already H.264+AAC in MP4 container (web-playable as-is).
func probeVideo(ctx context.Context, srcPath string) (needsTranscode bool, height int, err error) {
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		srcPath,
	)
	out, err := cmd.Output()
	if err != nil {
		return true, 0, fmt.Errorf("ffprobe failed: %w", err)
	}

	var probe struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
			Height    int    `json:"height"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &probe); err != nil {
		return true, 0, fmt.Errorf("ffprobe parse failed: %w", err)
	}

	hasH264 := false
	hasAAC := false
	for _, s := range probe.Streams {
		if s.CodecType == "video" {
			if s.CodecName == "h264" {
				hasH264 = true
			}
			if s.Height > height {
				height = s.Height
			}
		}
		if s.CodecType == "audio" && s.CodecName == "aac" {
			hasAAC = true
		}
	}

	// Check container format
	isMP4 := strings.HasSuffix(strings.ToLower(srcPath), ".mp4")
	if !isMP4 {
		// Probe container format
		fmtCmd := exec.CommandContext(ctx, "ffprobe",
			"-v", "quiet",
			"-print_format", "json",
			"-show_format",
			srcPath,
		)
		fmtOut, err := fmtCmd.Output()
		if err == nil {
			var fmtProbe struct {
				Format struct {
					FormatName string `json:"format_name"`
				} `json:"format"`
			}
			if json.Unmarshal(fmtOut, &fmtProbe) == nil {
				isMP4 = strings.Contains(fmtProbe.Format.FormatName, "mp4") ||
					strings.Contains(fmtProbe.Format.FormatName, "mov")
			}
		}
	}

	// Web-compatible if H.264 video, AAC audio (or no audio), in MP4 container, <= 1080p
	if hasH264 && (hasAAC || !hasAudioStream(probe.Streams)) && isMP4 && height <= maxHeight {
		return false, height, nil
	}

	return true, height, nil
}

func hasAudioStream(streams []struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Height    int    `json:"height"`
}) bool {
	for _, s := range streams {
		if s.CodecType == "audio" {
			return true
		}
	}
	return false
}

// transcodeVideo runs ffmpeg to produce a web-playable H.264/AAC MP4.
func transcodeVideo(ctx context.Context, srcPath, dstPath string, sourceHeight int) error {
	args := []string{
		"-i", srcPath,
		"-c:v", "libx264",
		"-crf", crf,
		"-preset", preset,
		"-profile:v", "high",
		"-level:v", "4.1",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", audioBitrate,
		"-ac", "2",
		"-movflags", "+faststart",
		"-y",
	}

	// Scale down to maxHeight if source is larger, maintaining aspect ratio.
	// Use -2 for width to ensure it's divisible by 2.
	if sourceHeight > maxHeight {
		args = append(args, "-vf", "scale=-2:"+strconv.Itoa(maxHeight))
	}

	args = append(args, dstPath)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.Stderr = os.Stderr // Let ffmpeg logs flow to server stderr for debugging
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg exited with error: %w", err)
	}

	// Verify output exists and is non-empty
	info, err := os.Stat(dstPath)
	if err != nil || info.Size() == 0 {
		return fmt.Errorf("ffmpeg produced no output")
	}

	return nil
}

// generateThumbnail extracts a thumbnail frame from the video as WebP.
func generateThumbnail(ctx context.Context, srcPath, thumbPath string) error {
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-i", srcPath,
		"-ss", thumbnailTime,
		"-vframes", "1",
		"-vf", "scale=480:-2",
		"-c:v", "libwebp",
		"-quality", "80",
		"-y",
		thumbPath,
	)
	if err := cmd.Run(); err != nil {
		// Try at the very start if seeking to 1s fails (very short video)
		cmd2 := exec.CommandContext(ctx, "ffmpeg",
			"-i", srcPath,
			"-vframes", "1",
			"-vf", "scale=480:-2",
			"-c:v", "libwebp",
			"-quality", "80",
			"-y",
			thumbPath,
		)
		return cmd2.Run()
	}
	return nil
}

func (h *TaskHandler) setProxyStatus(fileID, status string) {
	h.db.Model(&models.File{}).Where("id = ?", fileID).Update("proxy_status", status)
}

func (h *TaskHandler) storeThumbnail(libraryID, fileID, thumbPath string) {
	data, err := os.ReadFile(thumbPath)
	if err != nil {
		log.Printf("video:proxy — failed to read thumbnail for %s: %v", fileID, err)
		return
	}
	cacheKey := fmt.Sprintf("%s/%s/thumbnail.webp", libraryID, fileID)
	if err := h.storage.StoreCacheBuffer(cacheKey, data); err != nil {
		log.Printf("video:proxy — failed to store thumbnail for %s: %v", fileID, err)
	}
}

// NewVideoProxyTask creates a new asynq task for video proxy generation.
func NewVideoProxyTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(VideoProxyPayload{
		FileID:    fileID,
		LibraryID: libraryID,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeVideoProxy, payload), nil
}
