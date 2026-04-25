package transcribe

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const TaskTypeTranscribe = "file:transcribe"

// Payload is the asynq task payload.
type Payload struct {
	LibraryID string `json:"libraryId"`
	FileID    string `json:"fileId"`
}

// TaskHandler processes transcribe tasks.
type TaskHandler struct {
	db      *gorm.DB
	storage *storage.Service
	cfg     *config.Config
}

// NewTaskHandler creates a transcribe task handler.
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, cfg *config.Config) *TaskHandler {
	return &TaskHandler{db: db, storage: storageSvc, cfg: cfg}
}

// NewTranscribeTask wraps a Payload into an asynq task.
func NewTranscribeTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(Payload{LibraryID: libraryID, FileID: fileID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeTranscribe, payload), nil
}

// ProcessTask handles one transcribe task.
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
			log.Printf("transcribe: skipping — file %s not found or trashed", fileID)
			return nil
		}
		return err
	}

	if !strings.HasPrefix(file.MimeType, "video/") && !strings.HasPrefix(file.MimeType, "audio/") {
		log.Printf("transcribe: skipping — file %s not audio/video (%s)", fileID, file.MimeType)
		return nil
	}

	// Capture version at start — skip if already in progress for a newer request.
	targetVersion := file.TranscribeVersion

	zero := 0
	h.setState(fileID, stringPtr("processing"), &zero, nil, nil)

	tmpDir, err := os.MkdirTemp("", "alcoves-transcribe-*")
	if err != nil {
		h.fail(fileID, fmt.Errorf("mktemp: %w", err))
		return err
	}
	defer os.RemoveAll(tmpDir)

	// 1. Stream source to temp file.
	srcPath := filepath.Join(tmpDir, "source")
	if err := h.copySourceToTemp(libraryID, fileID, srcPath); err != nil {
		h.fail(fileID, err)
		return err
	}

	// 2. Extract mono 16kHz wav.
	wavPath := filepath.Join(tmpDir, "audio.wav")
	if err := extractAudio(ctx, h.cfg.FFmpegBinaryPath, srcPath, wavPath); err != nil {
		h.fail(fileID, fmt.Errorf("ffmpeg extract audio: %w", err))
		return err
	}

	// 3. Ensure whisper model available (auto-download when missing).
	modelPath, err := ensureModel(ctx, h.cfg.WhisperModelsDir, h.cfg.WhisperModel, h.cfg.WhisperModelBaseURL)
	if err != nil {
		h.fail(fileID, fmt.Errorf("ensure whisper model: %w", err))
		return err
	}

	// 4. Run whisper.
	outBase := filepath.Join(tmpDir, "out")
	if err := runWhisper(ctx, h.cfg.WhisperBinaryPath, modelPath, wavPath, outBase, h.cfg.WhisperLanguage, func(pct int) {
		h.setState(fileID, stringPtr("processing"), intPtr(pct), nil, nil)
	}); err != nil {
		h.fail(fileID, fmt.Errorf("whisper: %w", err))
		return err
	}

	// 5. Read transcript outputs.
	txtBytes, _ := os.ReadFile(outBase + ".txt")
	vttBytes, _ := os.ReadFile(outBase + ".vtt")

	// 6. Persist.
	updates := map[string]interface{}{
		"transcribe_status":      "ready",
		"transcribe_progress":    100,
		"transcribe_eta_seconds": nil,
		"transcribe_error":       nil,
		"transcribed_version":    targetVersion,
		"transcript_text":        strings.TrimSpace(string(txtBytes)),
		"transcript_vtt":         string(vttBytes),
		"transcript_model":       h.cfg.WhisperModel,
	}
	if err := h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(updates).Error; err != nil {
		return fmt.Errorf("persist transcript: %w", err)
	}
	log.Printf("transcribe: done for file %s (%d chars)", fileID, len(txtBytes))
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
		return fmt.Errorf("create temp: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, r); err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	return nil
}

func (h *TaskHandler) setState(fileID string, status *string, progress *int, eta *int, errMsg *string) {
	updates := map[string]interface{}{
		"transcribe_status":      status,
		"transcribe_progress":    progress,
		"transcribe_eta_seconds": eta,
		"transcribe_error":       errMsg,
	}
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(updates)
}

func (h *TaskHandler) fail(fileID string, err error) {
	msg := err.Error()
	h.setState(fileID, stringPtr("failed"), nil, nil, &msg)
}

func stringPtr(s string) *string { return &s }
func intPtr(i int) *int          { return &i }

// extractAudio runs ffmpeg to produce mono 16kHz PCM WAV.
func extractAudio(ctx context.Context, ffmpeg, srcPath, wavPath string) error {
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-y",
		"-i", srcPath,
		"-vn",
		"-ac", "1",
		"-ar", "16000",
		"-acodec", "pcm_s16le",
		wavPath,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ensureModel checks for the whisper ggml-<model>.bin file in modelsDir and
// downloads it if missing.
func ensureModel(ctx context.Context, modelsDir, modelName, baseURL string) (string, error) {
	if err := os.MkdirAll(modelsDir, 0o755); err != nil {
		return "", err
	}
	fileName := fmt.Sprintf("ggml-%s.bin", modelName)
	fullPath := filepath.Join(modelsDir, fileName)
	if _, err := os.Stat(fullPath); err == nil {
		return fullPath, nil
	}

	url := strings.TrimRight(baseURL, "/") + "/" + fileName
	const maxAttempts = 6
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		log.Printf("transcribe: downloading whisper model %s from %s (attempt %d/%d)", modelName, url, attempt, maxAttempts)
		err := whisperFetch(ctx, url, fullPath)
		if err == nil {
			log.Printf("transcribe: saved whisper model to %s", fullPath)
			return fullPath, nil
		}
		lastErr = err
		// Retry only on transient errors (5xx / network).
		s := err.Error()
		if !(strings.Contains(s, "http 5") || strings.Contains(s, "connection reset") || strings.Contains(s, "unexpected EOF") || strings.Contains(s, "EOF")) {
			return "", err
		}
		backoff := time.Duration(1<<uint(attempt-1)) * time.Second
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
		log.Printf("transcribe: transient error (%v), retrying in %s", err, backoff)
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(backoff):
		}
	}
	return "", fmt.Errorf("whisper model download failed after %d attempts: %w", maxAttempts, lastErr)
}

func whisperFetch(ctx context.Context, url, fullPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("model download failed: http %d", resp.StatusCode)
	}

	tmpPath := fullPath + ".part"
	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, fullPath)
}

var progressRegex = regexp.MustCompile(`progress\s*=\s*(\d+)%?`)

// runWhisper invokes whisper-cli and streams progress updates to onProgress.
func runWhisper(ctx context.Context, binary, modelPath, wavPath, outBase, language string, onProgress func(int)) error {
	if _, err := exec.LookPath(binary); err != nil {
		return fmt.Errorf(
			"whisper binary %q not found in PATH. Install whisper.cpp (https://github.com/ggerganov/whisper.cpp) and ensure the binary is on PATH, or set ALCOVES_WHISPER_BINARY to an absolute path",
			binary,
		)
	}
	args := []string{
		"-m", modelPath,
		"-f", wavPath,
		"-otxt",
		"-ovtt",
		"-of", outBase,
		"-pp",
	}
	if language != "" && language != "auto" {
		args = append(args, "-l", language)
	}
	cmd := exec.CommandContext(ctx, binary, args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	var wg sync.WaitGroup
	var lastErrLine string
	readPipe := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			if m := progressRegex.FindStringSubmatch(line); m != nil {
				if n, err := strconv.Atoi(m[1]); err == nil && onProgress != nil {
					onProgress(n)
				}
			}
			if strings.Contains(strings.ToLower(line), "error") {
				lastErrLine = line
			}
		}
	}

	wg.Add(2)
	go readPipe(stderr)
	go readPipe(stdout)
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		if lastErrLine != "" {
			return fmt.Errorf("%w: %s", err, lastErrLine)
		}
		return err
	}
	return nil
}
