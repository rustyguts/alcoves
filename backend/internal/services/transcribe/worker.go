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
	"github.com/alcoves/alcoves-backend/internal/services/activity"
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
	db          *gorm.DB
	storage     *storage.Service
	cfg         *config.Config
	activitySvc *activity.Service
}

// NewTaskHandler creates a transcribe task handler.
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, cfg *config.Config, activitySvc *activity.Service) *TaskHandler {
	return &TaskHandler{db: db, storage: storageSvc, cfg: cfg, activitySvc: activitySvc}
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

	// Derive duration from the extracted WAV (always 16-bit mono 16kHz PCM, so
	// 32000 bytes per second of audio after the 44-byte WAV header). Used for
	// smooth progress reporting based on per-segment timestamps.
	audioSec := wavDurationSeconds(wavPath)

	// 3. Ensure whisper model available (auto-download when missing).
	modelPath, err := ensureModel(ctx, h.cfg.WhisperModelsDir, h.cfg.WhisperModel, h.cfg.WhisperModelBaseURL)
	if err != nil {
		h.fail(fileID, fmt.Errorf("ensure whisper model: %w", err))
		return err
	}

	// 3b. Ensure VAD model when enabled. VAD is required to suppress
	// repetition-loop hallucinations on long non-speech regions; failure
	// to fetch should not be silently swallowed since transcription
	// quality drops materially without it.
	var vadModelPath string
	if h.cfg.WhisperVADModel != "" {
		vadModelPath, err = ensureModel(ctx, h.cfg.WhisperModelsDir, h.cfg.WhisperVADModel, h.cfg.WhisperModelBaseURL)
		if err != nil {
			h.fail(fileID, fmt.Errorf("ensure whisper VAD model: %w", err))
			return err
		}
	}

	// 4. Run whisper.
	outBase := filepath.Join(tmpDir, "out")
	if err := runWhisper(ctx, h.cfg.WhisperBinaryPath, modelPath, vadModelPath, wavPath, outBase, h.cfg.WhisperLanguage, audioSec, func(pct int) {
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

	if h.activitySvc != nil {
		var f models.File
		if err := h.db.Select("id, library_id, name").Where("id = ?", fileID).First(&f).Error; err == nil {
			fid := f.ID
			h.activitySvc.EmitAsync(activity.EmitParams{
				LibraryID:   f.LibraryID,
				ActorID:     nil,
				Action:      activity.ActionSystemTranscribeReady,
				SubjectType: activity.SubjectFile,
				SubjectID:   &fid,
				Metadata: map[string]any{
					"fileId":   f.ID.String(),
					"fileName": f.Name,
					"model":    h.cfg.WhisperModel,
				},
			})
		}
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
		backoff := min(time.Duration(1<<uint(attempt-1))*time.Second, 30*time.Second)
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

var (
	// `whisper_print_progress_callback: progress = X%` — fires every 5% by
	// default, so on long audio with a slow model it can be tens of minutes
	// between ticks. Used as a fallback signal.
	progressRegex = regexp.MustCompile(`progress\s*=\s*(\d+)%?`)

	// Per-segment line: `[hh:mm:ss.SSS --> hh:mm:ss.SSS]`. We use the end
	// timestamp + the known audio duration to derive smooth progress, which
	// updates roughly per chunk (every few seconds of wall clock).
	timestampRegex = regexp.MustCompile(`-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})`)
)

// buildWhisperArgs assembles the whisper-cli argument list. Pulled out so
// flag policy can be unit-tested without spawning a real binary. The
// repetition-loop fixes (-mc 0, -sns, --vad) are policy decisions, not
// implementation details — losing one regresses transcript quality on
// non-speech audio (game/music/silence), so we lock the set in tests.
func buildWhisperArgs(modelPath, vadModelPath, wavPath, outBase, language string) []string {
	args := []string{
		"-m", modelPath,
		"-f", wavPath,
		"-otxt",
		"-ovtt",
		"-of", outBase,
		"-pp",
		// Disable carrying previous segment text as decoder context. Default
		// (-mc -1) keeps all prior tokens, which traps the model in a
		// repetition loop on quiet / non-speech audio: once it emits a
		// hallucinated phrase, that phrase becomes the prompt for every
		// subsequent segment and gets re-emitted indefinitely.
		"-mc", "0",
		// Suppress non-speech tokens (music, noise, etc.) to reduce the
		// chance of the model latching onto a hallucinated phrase during
		// silent regions.
		"-sns",
	}
	if vadModelPath != "" {
		// Voice Activity Detection. Skips the decoder over regions Silero
		// flags as non-speech, which is the only reliable cure for the
		// repetition-loop hallucination on game/music/silence audio. `-mc 0`
		// + `-sns` alone are not enough — see docs/models.md and the
		// reproduction in data/whisper-debug/.
		args = append(args, "--vad", "--vad-model", vadModelPath)
	}
	if language != "" && language != "auto" {
		args = append(args, "-l", language)
	}
	return args
}

// runWhisper invokes whisper-cli and streams progress updates to onProgress.
// `audioSec` is the duration of the input wav (used for per-segment progress);
// pass 0 to disable timestamp-based progress and rely on `-pp` only.
// `vadModelPath` enables Silero VAD when non-empty (required for whisper.cpp
// >= v1.7.6); pass "" to skip VAD.
func runWhisper(ctx context.Context, binary, modelPath, vadModelPath, wavPath, outBase, language string, audioSec float64, onProgress func(int)) error {
	if _, err := exec.LookPath(binary); err != nil {
		return fmt.Errorf(
			"whisper binary %q not found in PATH. Install whisper.cpp (https://github.com/ggerganov/whisper.cpp) and ensure the binary is on PATH, or set ALCOVES_WHISPER_BINARY to an absolute path",
			binary,
		)
	}
	whisperArgs := buildWhisperArgs(modelPath, vadModelPath, wavPath, outBase, language)

	// libc switches stdout/stderr to fully-buffered mode when they are pipes
	// (not a TTY). Whisper writes per-segment timestamp lines via fprintf, so
	// without an explicit flush they accumulate in the 4KB pipe buffer and we
	// don't see progress for many minutes on long audio. `stdbuf -oL -eL`
	// forces line buffering so each `\n` flushes immediately. Falls back to a
	// direct invocation if stdbuf isn't on PATH.
	var cmd *exec.Cmd
	if stdbuf, lookupErr := exec.LookPath("stdbuf"); lookupErr == nil {
		stdbufArgs := append([]string{"-oL", "-eL", binary}, whisperArgs...)
		cmd = exec.CommandContext(ctx, stdbuf, stdbufArgs...)
	} else {
		cmd = exec.CommandContext(ctx, binary, whisperArgs...)
	}
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

	var (
		wg          sync.WaitGroup
		lastErrLine string
		mu          sync.Mutex
		lastPct     int
	)
	tracker := &progressTracker{audioSec: audioSec, onProgress: onProgress, mu: &mu, lastPct: &lastPct}
	readPipe := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			tracker.consume(line)
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

// progressTracker parses whisper-cli output lines into monotonic progress
// percentages and forwards them via onProgress. Pulled out of runWhisper so
// the pipe-parsing logic can be unit-tested without spawning a real binary.
type progressTracker struct {
	audioSec   float64
	onProgress func(int)
	mu         *sync.Mutex
	lastPct    *int
}

// consume inspects a single line from whisper-cli stdout/stderr and emits a
// progress callback if the line contains a recognizable signal:
//   - `[hh:mm:ss.SSS --> hh:mm:ss.SSS]` segment line — derives % from end time
//     against the audio duration. Fires per-segment (every few seconds wall).
//   - `progress = N%` line emitted by whisper's `-pp` mode — fallback signal,
//     ticks every 5% by default.
//
// emit is monotonic: skips any value ≤ the last value sent.
func (p *progressTracker) consume(line string) {
	if p.audioSec > 0 {
		if m := timestampRegex.FindStringSubmatch(line); m != nil {
			hh, _ := strconv.Atoi(m[1])
			mm, _ := strconv.Atoi(m[2])
			ss, _ := strconv.Atoi(m[3])
			ms, _ := strconv.Atoi(m[4])
			endSec := float64(hh*3600+mm*60+ss) + float64(ms)/1000
			p.emit(int(endSec / p.audioSec * 100))
		}
	}
	if m := progressRegex.FindStringSubmatch(line); m != nil {
		if n, err := strconv.Atoi(m[1]); err == nil {
			p.emit(n)
		}
	}
}

func (p *progressTracker) emit(pct int) {
	if p.onProgress == nil {
		return
	}
	if pct < 0 {
		pct = 0
	}
	if pct > 99 {
		// 100 is reserved for "fully done" — written once after outputs are read.
		pct = 99
	}
	p.mu.Lock()
	if pct > *p.lastPct {
		*p.lastPct = pct
		p.mu.Unlock()
		p.onProgress(pct)
		return
	}
	p.mu.Unlock()
}

// wavDurationSeconds estimates audio length from a 16-bit mono 16kHz PCM WAV
// file (the format `extractAudio` always produces). Returns 0 on stat error;
// callers should treat 0 as "duration unknown" and skip duration-based math.
func wavDurationSeconds(path string) float64 {
	const (
		wavHeaderBytes = 44
		bytesPerSecond = 16000 * 2 // 16 kHz * 16-bit mono
	)
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	dataBytes := st.Size() - wavHeaderBytes
	if dataBytes <= 0 {
		return 0
	}
	return float64(dataBytes) / float64(bytesPerSecond)
}
