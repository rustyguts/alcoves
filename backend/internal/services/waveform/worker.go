package waveform

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
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

const defaultPeaksPerSecond = 50
const sampleRateHz = 16000

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

func NewWaveformTask(libraryID, fileID string) (*asynq.Task, error) {
	payload, err := json.Marshal(Payload{LibraryID: libraryID, FileID: fileID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeWaveform, payload), nil
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
			log.Printf("waveform: skipping — file %s not found or trashed", fileID)
			return nil
		}
		return err
	}

	if !strings.HasPrefix(file.MimeType, "video/") && !strings.HasPrefix(file.MimeType, "audio/") {
		log.Printf("waveform: skipping — file %s not audio/video (%s)", fileID, file.MimeType)
		return nil
	}

	targetVersion := file.WaveformVersion

	zero := 0
	h.setState(fileID, stringPtr("processing"), &zero, nil)

	tmpDir, err := os.MkdirTemp("", "alcoves-waveform-*")
	if err != nil {
		h.fail(fileID, fmt.Errorf("mktemp: %w", err))
		return err
	}
	defer os.RemoveAll(tmpDir)

	srcPath := filepath.Join(tmpDir, "source")
	if err := h.copySourceToTemp(libraryID, fileID, srcPath); err != nil {
		h.fail(fileID, err)
		return err
	}

	// Check for audio stream — if none, store empty waveform and mark ready.
	hasAudio, err := h.probeAudioStream(ctx, srcPath)
	if err != nil {
		h.fail(fileID, fmt.Errorf("audio probe: %w", err))
		return err
	}
	if !hasAudio {
		h.storeEmptyWaveform(libraryID, fileID)
		h.complete(fileID, targetVersion, defaultPeaksPerSecond)
		return nil
	}

	// Extract mono 16kHz float32 PCM
	pcmPath := filepath.Join(tmpDir, "audio.pcm")
	if err := h.extractPCM(ctx, srcPath, pcmPath); err != nil {
		h.fail(fileID, fmt.Errorf("audio extract: %w", err))
		return err
	}

	// Compute peaks
	peaksPerSec := defaultPeaksPerSecond
	peaks, err := h.computePeaks(pcmPath, peaksPerSec)
	if err != nil {
		h.fail(fileID, fmt.Errorf("compute peaks: %w", err))
		return err
	}

	// Store waveform JSON in cache
	waveformData := map[string]interface{}{
		"peaks":           peaks,
		"peaksPerSecond":  peaksPerSec,
		"sampleRate":      sampleRateHz,
	}
	jsonBytes, err := json.Marshal(waveformData)
	if err != nil {
		h.fail(fileID, fmt.Errorf("marshal waveform: %w", err))
		return err
	}
	cacheKey := fmt.Sprintf("%s/%s/waveform.json", libraryID, fileID)
	if err := h.storage.StoreCacheBuffer(cacheKey, jsonBytes); err != nil {
		h.fail(fileID, fmt.Errorf("store waveform cache: %w", err))
		return err
	}

	// Verify we haven't been superseded
	var current models.File
	if err := h.db.Where("id = ?", fileID).First(&current).Error; err != nil {
		return err
	}
	if current.WaveformVersion != targetVersion {
		log.Printf("waveform: version changed (%d → %d), discarding work for file %s", targetVersion, current.WaveformVersion, fileID)
		return nil
	}

	h.complete(fileID, targetVersion, defaultPeaksPerSecond)
	log.Printf("waveform: complete for file %s (%d peaks)", fileID, len(peaks))
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

func (h *TaskHandler) probeAudioStream(ctx context.Context, src string) (bool, error) {
	ffmpeg := h.cfg.FFmpegBinaryPath
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner",
		"-i", src,
		"-f", "null",
		"-",
	)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return false, err
	}
	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("ffmpeg start: %w", err)
	}
	stderrBytes, _ := io.ReadAll(stderr)
	cmd.Wait()
	return strings.Contains(string(stderrBytes), "Stream #0"), nil
}

func (h *TaskHandler) extractPCM(ctx context.Context, src, dst string) error {
	ffmpeg := h.cfg.FFmpegBinaryPath
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-y",
		"-i", src,
		"-vn",
		"-ac", "1",
		"-ar", fmt.Sprintf("%d", sampleRateHz),
		"-f", "f32le",
		"-acodec", "pcm_f32le",
		dst,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (h *TaskHandler) computePeaks(pcmPath string, peaksPerSec int) ([]float64, error) {
	data, err := os.ReadFile(pcmPath)
	if err != nil {
		return nil, err
	}
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("pcm size %d not multiple of 4", len(data))
	}

	sampleCount := len(data) / 4
	windowSize := sampleRateHz / peaksPerSec
	if windowSize < 1 {
		windowSize = 1
	}

	numPeaks := sampleCount / windowSize
	peaks := make([]float64, 0, numPeaks)

	for i := 0; i+windowSize <= sampleCount; i += windowSize {
		maxAmp := float64(0)
		for j := 0; j < windowSize; j++ {
			offset := (i + j) * 4
			bits := binary.LittleEndian.Uint32(data[offset : offset+4])
			sample := float64(math.Float32frombits(bits))
			abs := math.Abs(sample)
			if abs > maxAmp {
				maxAmp = abs
			}
		}
		normalized := math.Min(maxAmp, 1.0)
		peaks = append(peaks, normalized)
	}

	return peaks, nil
}

func (h *TaskHandler) storeEmptyWaveform(libraryID, fileID string) {
	data := map[string]interface{}{
		"peaks":          []float64{},
		"peaksPerSecond": defaultPeaksPerSecond,
		"sampleRate":     sampleRateHz,
	}
	jsonBytes, _ := json.Marshal(data)
	cacheKey := fmt.Sprintf("%s/%s/waveform.json", libraryID, fileID)
	_ = h.storage.StoreCacheBuffer(cacheKey, jsonBytes)
}

func (h *TaskHandler) setState(fileID string, status *string, progress *int, errMsg *string) {
	updates := map[string]interface{}{
		"waveform_status":   status,
		"waveform_progress": progress,
		"waveform_error":    errMsg,
	}
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(updates)
}

func (h *TaskHandler) fail(fileID string, err error) {
	log.Printf("waveform: failed for file %s: %v", fileID, err)
	msg := err.Error()
	h.setState(fileID, stringPtr("failed"), nil, &msg)
}

func (h *TaskHandler) complete(fileID string, version int, peaksPerSec int) {
	ready := "ready"
	full := 100
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"waveform_status":           ready,
		"waveform_progress":         full,
		"waveform_error":            nil,
		"waveformed_version":        version,
		"waveform_peaks_per_second": peaksPerSec,
	})
}

func stringPtr(s string) *string { return &s }