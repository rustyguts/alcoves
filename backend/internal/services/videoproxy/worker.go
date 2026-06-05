package videoproxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const (
	TaskTypeVideoProxy = "video:proxy"
	TaskTypeVideoThumb = "video:thumbnail"

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
	Force     bool   `json:"force"`
}

type VideoThumbnailPayload struct {
	FileID    string `json:"fileId"`
	LibraryID string `json:"libraryId"`
}

// TaskHandler handles video proxy asynq tasks.
type TaskHandler struct {
	db          *gorm.DB
	storage     *storage.Service
	activitySvc *activity.Service
}

// NewTaskHandler creates a new video proxy task handler.
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, activitySvc *activity.Service) *TaskHandler {
	return &TaskHandler{
		db:          db,
		storage:     storageSvc,
		activitySvc: activitySvc,
	}
}

// ProcessTask handles a single video:proxy task.
func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload VideoProxyPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid task payload: %w", err)
	}

	return h.processVideo(ctx, payload.LibraryID, payload.FileID, payload.Force)
}

func (h *TaskHandler) ProcessThumbnailTask(ctx context.Context, t *asynq.Task) error {
	var payload VideoThumbnailPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid thumbnail task payload: %w", err)
	}

	return h.processVideoThumbnail(ctx, payload.LibraryID, payload.FileID)
}

func (h *TaskHandler) processVideo(ctx context.Context, libraryID, fileID string, force bool) error {
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
	initialProgress := 0
	h.setProxyState(fileID, "processing", &initialProgress, nil)

	// 4. Read source video to a temp file (ffmpeg needs file access)
	tmpDir, err := os.MkdirTemp("", "alcoves-proxy-*")
	if err != nil {
		h.setProxyState(fileID, "failed", nil, nil)
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	srcPath := filepath.Join(tmpDir, "source")
	proxyPath := filepath.Join(tmpDir, "proxy.mp4")
	thumbPath := filepath.Join(tmpDir, "thumbnail.webp")

	reader, err := h.storage.OpenFileReadStream(libraryID, fileID, nil)
	if err != nil {
		h.setProxyState(fileID, "failed", nil, nil)
		return fmt.Errorf("failed to open source file: %w", err)
	}

	srcFile, err := os.Create(srcPath)
	if err != nil {
		reader.Close()
		h.setProxyState(fileID, "failed", nil, nil)
		return fmt.Errorf("failed to create temp source: %w", err)
	}

	if _, err := srcFile.ReadFrom(reader); err != nil {
		srcFile.Close()
		reader.Close()
		h.setProxyState(fileID, "failed", nil, nil)
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

	if !needsTranscode && !force {
		// Source is already web-compatible H.264/AAC MP4
		log.Printf("video:proxy — file %s is already web-compatible, marking as not_needed", fileID)
		completeProgress := 100
		h.setProxyState(fileID, "not_needed", &completeProgress, nil)

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

	durationSeconds, durErr := probeDurationSeconds(ctx, srcPath)
	if durErr != nil {
		log.Printf("video:proxy — duration probe failed for %s: %v", fileID, durErr)
	}

	if err := transcodeVideo(ctx, srcPath, proxyPath, sourceHeight, durationSeconds, func(progress int, etaSeconds *int) {
		h.setProxyState(fileID, "processing", &progress, etaSeconds)
	}); err != nil {
		h.setProxyState(fileID, "failed", nil, nil)
		return fmt.Errorf("ffmpeg transcode failed: %w", err)
	}

	// 7. Store proxy in cache
	proxyData, err := os.ReadFile(proxyPath)
	if err != nil {
		h.setProxyState(fileID, "failed", nil, nil)
		return fmt.Errorf("failed to read proxy output: %w", err)
	}

	proxyID := uuid.New()
	proxyName := buildProxyName(file.Name)
	proxyFile := models.File{
		BaseModel:    models.BaseModel{ID: proxyID},
		LibraryID:    file.LibraryID,
		Name:         proxyName,
		MimeType:     "video/mp4",
		Size:         int64(len(proxyData)),
		OwnerID:      file.OwnerID,
		SourceFileID: &file.ID,
	}
	if err := h.db.Create(&proxyFile).Error; err != nil {
		h.setProxyState(fileID, "failed", nil, nil)
		return fmt.Errorf("failed to create proxy file record: %w", err)
	}

	if err := h.storage.StoreFile(libraryID, proxyID.String(), proxyData); err != nil {
		h.setProxyState(fileID, "failed", nil, nil)
		return fmt.Errorf("failed to store proxy file: %w", err)
	}

	// 8. Generate and store thumbnail
	if err := generateThumbnail(ctx, srcPath, thumbPath); err != nil {
		log.Printf("video:proxy — thumbnail failed for %s: %v", fileID, err)
	} else {
		h.storeThumbnail(libraryID, fileID, thumbPath)
	}

	// 9. Mark as ready
	completeProgress := 100
	h.setProxyState(fileID, "ready", &completeProgress, nil)
	log.Printf("video:proxy — completed for file %s", fileID)

	if h.activitySvc != nil {
		var f models.File
		if err := h.db.Select("id, library_id, name").Where("id = ?", fileID).First(&f).Error; err == nil {
			fid := f.ID
			h.activitySvc.EmitAsync(activity.EmitParams{
				LibraryID:   f.LibraryID,
				ActorID:     nil,
				Action:      activity.ActionSystemVideoProxyReady,
				SubjectType: activity.SubjectFile,
				SubjectID:   &fid,
				Metadata: map[string]any{
					"fileId":   f.ID.String(),
					"fileName": f.Name,
				},
			})
		}
	}

	return nil
}

func (h *TaskHandler) processVideoThumbnail(ctx context.Context, libraryID, fileID string) error {
	var file models.File
	err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}

	if file.SourceFileID != nil || !strings.HasPrefix(file.MimeType, "video/") {
		return nil
	}

	tmpDir, err := os.MkdirTemp("", "alcoves-thumb-*")
	if err != nil {
		return fmt.Errorf("failed to create thumbnail temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	srcPath := filepath.Join(tmpDir, "source")
	thumbPath := filepath.Join(tmpDir, "thumbnail.jpg")

	reader, err := h.storage.OpenFileReadStream(libraryID, fileID, nil)
	if err != nil {
		return fmt.Errorf("failed to open source file for thumbnail: %w", err)
	}
	defer reader.Close()

	srcFile, err := os.Create(srcPath)
	if err != nil {
		return fmt.Errorf("failed to create thumbnail temp source: %w", err)
	}
	if _, err := srcFile.ReadFrom(reader); err != nil {
		srcFile.Close()
		return fmt.Errorf("failed to write thumbnail temp source: %w", err)
	}
	if err := srcFile.Close(); err != nil {
		return fmt.Errorf("failed to close thumbnail temp source: %w", err)
	}

	if err := generateJPEGThumbnail(ctx, srcPath, thumbPath); err != nil {
		return fmt.Errorf("failed to generate jpeg thumbnail: %w", err)
	}

	thumbData, err := os.ReadFile(thumbPath)
	if err != nil {
		return fmt.Errorf("failed to read jpeg thumbnail: %w", err)
	}

	now := time.Now()
	if err := h.db.Model(&models.File{}).
		Where("source_file_id = ? AND library_id = ? AND mime_type = ? AND trashed_at IS NULL", file.ID, file.LibraryID, "image/jpeg").
		Updates(map[string]interface{}{"trashed_at": now, "updated_at": now}).Error; err != nil {
		return fmt.Errorf("failed to expire previous thumbnails: %w", err)
	}

	thumbID := uuid.New()
	thumb := models.File{
		BaseModel:    models.BaseModel{ID: thumbID},
		LibraryID:    file.LibraryID,
		Name:         buildThumbnailName(file.Name),
		MimeType:     "image/jpeg",
		Size:         int64(len(thumbData)),
		OwnerID:      file.OwnerID,
		SourceFileID: &file.ID,
	}
	if err := h.db.Create(&thumb).Error; err != nil {
		return fmt.Errorf("failed to create thumbnail file record: %w", err)
	}

	if err := h.storage.StoreFile(libraryID, thumbID.String(), thumbData); err != nil {
		h.db.Where("id = ?", thumbID).Delete(&models.File{})
		return fmt.Errorf("failed to store thumbnail file: %w", err)
	}

	if err := h.db.Model(&models.File{}).Where("id = ?", file.ID).Updates(map[string]interface{}{
		"thumbnail_file_id": thumbID,
		"updated_at":        now,
	}).Error; err != nil {
		return fmt.Errorf("failed to update source thumbnail pointer: %w", err)
	}

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

func probeDurationSeconds(ctx context.Context, srcPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		srcPath,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe duration failed: %w", err)
	}

	value := strings.TrimSpace(string(out))
	duration, err := strconv.ParseFloat(value, 64)
	if err != nil || duration <= 0 {
		return 0, fmt.Errorf("invalid duration value: %q", value)
	}

	return duration, nil
}

// transcodeVideo runs ffmpeg to produce a web-playable H.264/AAC MP4.
func transcodeVideo(
	ctx context.Context,
	srcPath, dstPath string,
	sourceHeight int,
	durationSeconds float64,
	onProgress func(progress int, etaSeconds *int),
) error {
	args := []string{
		"-i", srcPath,
		"-progress", "pipe:2",
		"-nostats",
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
	cmd.Stdout = io.Discard
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create ffmpeg stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	lastProgress := -1
	lastETA := -1
	currentOutTimeSeconds := 0.0
	currentSpeed := 0.0

	scanner := bufio.NewScanner(stderrPipe)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := parts[0]
		value := parts[1]

		switch key {
		case "out_time":
			if parsed, parseErr := parseFFmpegOutTime(value); parseErr == nil {
				currentOutTimeSeconds = parsed
			}
		case "speed":
			if parsed, parseErr := parseFFmpegSpeed(value); parseErr == nil {
				currentSpeed = parsed
			}
		case "progress":
			if durationSeconds <= 0 || onProgress == nil {
				continue
			}

			percent := int(math.Round((currentOutTimeSeconds / durationSeconds) * 100))
			if percent < 0 {
				percent = 0
			}
			if percent > 100 {
				percent = 100
			}

			var etaSeconds *int
			etaVal := -1
			if currentSpeed > 0 && currentOutTimeSeconds < durationSeconds {
				remaining := durationSeconds - currentOutTimeSeconds
				eta := int(math.Ceil(remaining / currentSpeed))
				if eta < 0 {
					eta = 0
				}
				etaSeconds = &eta
				etaVal = eta
			}

			if percent != lastProgress || etaVal != lastETA {
				onProgress(percent, etaSeconds)
				lastProgress = percent
				lastETA = etaVal
			}
		}
	}

	if scanErr := scanner.Err(); scanErr != nil {
		log.Printf("video:proxy — ffmpeg progress parse warning: %v", scanErr)
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg exited with error: %w", err)
	}

	if onProgress != nil {
		complete := 100
		onProgress(complete, nil)
	}

	// Verify output exists and is non-empty
	info, err := os.Stat(dstPath)
	if err != nil || info.Size() == 0 {
		return fmt.Errorf("ffmpeg produced no output")
	}

	return nil
}

func parseFFmpegOutTime(value string) (float64, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return 0, fmt.Errorf("invalid out_time: %q", value)
	}

	hours, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, err
	}
	minutes, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0, err
	}
	seconds, err := strconv.ParseFloat(parts[2], 64)
	if err != nil {
		return 0, err
	}

	return (hours * 3600) + (minutes * 60) + seconds, nil
}

func parseFFmpegSpeed(value string) (float64, error) {
	trimmed := strings.TrimSuffix(strings.TrimSpace(value), "x")
	if trimmed == "" {
		return 0, fmt.Errorf("empty speed")
	}

	speed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, err
	}
	if speed <= 0 {
		return 0, fmt.Errorf("invalid speed: %f", speed)
	}

	return speed, nil
}

// thumbnailColorFilter normalizes arbitrary SDR/HDR inputs to SDR BT.709
// before scaling. It linearizes, tone-maps HDR peaks (PQ/HLG) with Hable,
// then re-encodes to BT.709 limited-range yuv420p. SDR BT.709 input passes
// through effectively unchanged. Requires ffmpeg built with zimg (zscale).
const thumbnailColorFilter = "zscale=t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p"

// thumbnailFallbackSDR explicitly sets BT.709 SDR input and output params on
// the first zscale filter for content that is missing colorspace metadata.
// When auto-detection fails (common for videos encoded without color tags),
// this tells zimg exactly what the source colorspace is.
const thumbnailFallbackSDR = "zscale=pin=bt709:tin=bt709:min=bt709:rin=tv:p=bt709:t=linear:npl=100:m=bt709:r=tv,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p"

func runThumbFFmpeg(ctx context.Context, srcPath, thumbPath, vf, seek string, extraArgs ...string) (stderr string, err error) {
	args := []string{"-i", srcPath, "-vframes", "1", "-vf", vf, "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-y"}
	if seek != "" {
		args = append(args, "-ss", seek)
	}
	args = append(args, extraArgs...)
	args = append(args, thumbPath)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	var buf bytes.Buffer
	cmd.Stderr = &buf
	err = cmd.Run()
	return buf.String(), err
}

func generateThumbnail(ctx context.Context, srcPath, thumbPath string) error {
	vfAuto := thumbnailColorFilter + ",scale=480:-2"
	vfSDR := thumbnailFallbackSDR + ",scale=480:-2"

	stderr, err := runThumbFFmpeg(ctx, srcPath, thumbPath, vfAuto, thumbnailTime, "-c:v", "libwebp", "-quality", "80")
	if err == nil {
		return nil
	}
	if stderr, err = runThumbFFmpeg(ctx, srcPath, thumbPath, vfSDR, thumbnailTime, "-c:v", "libwebp", "-quality", "80"); err == nil {
		return nil
	}
	if stderr, err = runThumbFFmpeg(ctx, srcPath, thumbPath, vfSDR, "", "-c:v", "libwebp", "-quality", "80"); err == nil {
		return nil
	}
	vfSimple := "scale=480:-2"
	if stderr, err = runThumbFFmpeg(ctx, srcPath, thumbPath, vfSimple, thumbnailTime, "-c:v", "libwebp", "-quality", "80"); err == nil {
		return nil
	}
	return fmt.Errorf("ffmpeg: all strategies failed, last stderr: %s: %w", stderr, err)
}

func generateJPEGThumbnail(ctx context.Context, srcPath, thumbPath string) error {
	vfAuto := thumbnailColorFilter + ",scale=1280:-2"
	vfSDR := thumbnailFallbackSDR + ",scale=1280:-2"

	stderr, err := runThumbFFmpeg(ctx, srcPath, thumbPath, vfAuto, thumbnailTime, "-q:v", "3")
	if err == nil {
		return nil
	}
	if stderr, err = runThumbFFmpeg(ctx, srcPath, thumbPath, vfSDR, thumbnailTime, "-q:v", "3"); err == nil {
		return nil
	}
	if stderr, err = runThumbFFmpeg(ctx, srcPath, thumbPath, vfSDR, "", "-q:v", "3"); err == nil {
		return nil
	}
	vfSimple := "scale=1280:-2"
	if stderr, err = runThumbFFmpeg(ctx, srcPath, thumbPath, vfSimple, thumbnailTime, "-q:v", "3"); err == nil {
		return nil
	}
	return fmt.Errorf("ffmpeg: all strategies failed, last stderr: %s: %w", stderr, err)
}

func (h *TaskHandler) setProxyState(fileID, status string, progress, etaSeconds *int) {
	updates := map[string]interface{}{
		"proxy_status":      status,
		"proxy_progress":    progress,
		"proxy_eta_seconds": etaSeconds,
	}
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(updates)
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
func NewVideoProxyTask(libraryID, fileID string, force bool) (*asynq.Task, error) {
	payload, err := json.Marshal(VideoProxyPayload{
		FileID:    fileID,
		LibraryID: libraryID,
		Force:     force,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeVideoProxy, payload), nil
}

func NewVideoThumbnailTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(VideoThumbnailPayload{FileID: fileID, LibraryID: libraryID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeVideoThumb, payload), nil
}

func buildProxyName(sourceName string) string {
	idx := strings.LastIndex(sourceName, ".")
	base := sourceName
	if idx > 0 {
		base = sourceName[:idx]
	}
	return fmt.Sprintf("%s_proxy_%s.mp4", base, time.Now().UTC().Format("20060102T150405Z"))
}

func buildThumbnailName(sourceName string) string {
	idx := strings.LastIndex(sourceName, ".")
	base := sourceName
	if idx > 0 {
		base = sourceName[:idx]
	}
	return fmt.Sprintf("%s_thumbnail_%s.jpg", base, time.Now().UTC().Format("20060102T150405Z"))
}
