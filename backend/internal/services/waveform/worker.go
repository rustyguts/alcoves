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
	"sort"
	"strings"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

const defaultPeaksPerSecond = 50
const sampleRateHz = 16000

// Waveform display tuning. The pipeline is: per-window RMS → per-file
// normalize against a robust reference (a high quantile, so a single clipped
// sample doesn't squash the rest of the file) → dB curve mapped onto a fixed
// visual range. This produces a visually balanced waveform regardless of the
// source's mastering level.
const (
	// Reference quantile of per-window RMS used as the file's "peak" for
	// normalization. Using p99 instead of max keeps occasional outliers
	// (a stray clip, a single loud transient) from compressing the rest of
	// the waveform.
	normalizationQuantile = 0.99

	// Files whose reference RMS is below this floor are treated as silent
	// and emitted as all-zero peaks. Otherwise we'd amplify the noise floor
	// of a truly-silent file all the way to full scale.
	silenceFloorRMS = 1e-4

	// dB floor for the visual mapping. Values quieter than this map to 0;
	// 0dB (the file's reference level) maps to 1. -50dB gives ~50dB of
	// usable visual range, which covers most dialog/music dynamics without
	// devoting half the canvas to inaudible content.
	waveformDBFloor = -50.0
)

type Payload struct {
	LibraryID string `json:"libraryId"`
	FileID    string `json:"fileId"`
}

type TaskHandler struct {
	db          *gorm.DB
	storage     *storage.Service
	cfg         *config.Config
	activitySvc *activity.Service
}

func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, cfg *config.Config, activitySvc *activity.Service) *TaskHandler {
	return &TaskHandler{db: db, storage: storageSvc, cfg: cfg, activitySvc: activitySvc}
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

	numWindows := sampleCount / windowSize
	rms := make([]float64, 0, numWindows)

	for i := 0; i+windowSize <= sampleCount; i += windowSize {
		var sumSq float64
		for j := 0; j < windowSize; j++ {
			offset := (i + j) * 4
			bits := binary.LittleEndian.Uint32(data[offset : offset+4])
			sample := float64(math.Float32frombits(bits))
			sumSq += sample * sample
		}
		rms = append(rms, math.Sqrt(sumSq/float64(windowSize)))
	}

	return normalizeAndScale(rms), nil
}

// normalizeAndScale applies per-file loudness normalization and a dB curve
// to a slice of per-window RMS values, producing the [0,1] heights the
// frontend renders. The transform has three stages:
//
//  1. Pick a reference loudness as the file's high quantile of RMS (p99 by
//     default). A single clipped sample no longer dictates the scale.
//  2. Divide every value by the reference (clamped at the silence floor),
//     then clamp results to [0,1] — values above the reference (the top 1%)
//     pin to full scale.
//  3. Convert to dB and map [waveformDBFloor, 0] → [0, 1]. Values quieter
//     than the floor map to 0.
//
// Files whose reference is below silenceFloorRMS are treated as silent and
// emit all-zero peaks; otherwise we'd amplify pure noise to full scale.
func normalizeAndScale(rms []float64) []float64 {
	if len(rms) == 0 {
		return []float64{}
	}

	ref := quantile(rms, normalizationQuantile)
	if ref < silenceFloorRMS {
		return make([]float64, len(rms))
	}

	out := make([]float64, len(rms))
	const visualSpan = -waveformDBFloor
	for i, v := range rms {
		if v <= 0 {
			continue
		}
		norm := v / ref
		if norm > 1 {
			norm = 1
		}
		db := 20 * math.Log10(norm)
		if db <= waveformDBFloor {
			continue
		}
		out[i] = (db - waveformDBFloor) / visualSpan
	}
	return out
}

// quantile returns the q-quantile of values using the nearest-rank method.
// q is clamped to [0,1]. The input is not modified.
func quantile(values []float64, q float64) float64 {
	if len(values) == 0 {
		return 0
	}
	if q < 0 {
		q = 0
	} else if q > 1 {
		q = 1
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	idx := int(math.Round(q * float64(len(sorted)-1)))
	return sorted[idx]
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

	if h.activitySvc != nil {
		var f models.File
		if err := h.db.Select("id, library_id, name").Where("id = ?", fileID).First(&f).Error; err == nil {
			fid := f.ID
			h.activitySvc.EmitAsync(activity.EmitParams{
				LibraryID:   f.LibraryID,
				ActorID:     nil, // system event
				Action:      activity.ActionSystemWaveformReady,
				SubjectType: activity.SubjectFile,
				SubjectID:   &fid,
				Metadata: map[string]any{
					"fileId":   f.ID.String(),
					"fileName": f.Name,
				},
			})
		}
	}
}


func stringPtr(s string) *string { return &s }