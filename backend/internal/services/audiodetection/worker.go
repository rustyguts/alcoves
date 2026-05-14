package audiodetection

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

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	ort "github.com/yalue/onnxruntime_go"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

type TaskHandler struct {
	db          *gorm.DB
	storage     *storage.Service
	cfg         *config.Config
	settingsSvc *settings.Service
}

// NewTaskHandler creates an audio-detect task handler. settingsSvc may be
// nil in tests; the worker falls back to the registry default
// (efficientat_mn10).
func NewTaskHandler(db *gorm.DB, storageSvc *storage.Service, cfg *config.Config, settingsSvc *settings.Service) *TaskHandler {
	return &TaskHandler{db: db, storage: storageSvc, cfg: cfg, settingsSvc: settingsSvc}
}

// activeSpec returns the ModelSpec for the admin-selected tagger, with
// fallback to the registry default. Unknown IDs (e.g. left over from a
// rolled-back deploy) fall back rather than failing the job.
func (h *TaskHandler) activeSpec() ModelSpec {
	id := ""
	if h.settingsSvc != nil {
		id = h.settingsSvc.Get().AudioDetectModel
	}
	spec, _ := LookupSpec(id)
	return spec
}

// modelURL constructs the download URL by appending the spec filename to
// the configured base URL. Empty base URL falls back to the canonical
// rustyguts mirror so a misconfigured pod still boots.
func (h *TaskHandler) modelURL(spec ModelSpec) string {
	base := h.cfg.AudioDetectModelBaseURL
	if base == "" {
		base = "https://s3.rustyguts.net/models"
	}
	return strings.TrimRight(base, "/") + "/" + spec.ModelFile
}

func newTask(p Payload) (*asynq.Task, error) {
	payload, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskTypeAudioDetect, payload), nil
}

func (h *TaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var p Payload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("invalid payload: %w", err)
	}
	return h.run(ctx, p.LibraryID, p.FileID)
}

func (h *TaskHandler) run(ctx context.Context, libraryID, fileID string) error {
	var file models.File
	err := h.db.Where("id = ? AND library_id = ? AND trashed_at IS NULL", fileID, libraryID).First(&file).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("audio-detect: file %s not found, skipping", fileID)
			return nil
		}
		return err
	}
	if !strings.HasPrefix(file.MimeType, "video/") && !strings.HasPrefix(file.MimeType, "audio/") {
		log.Printf("audio-detect: file %s not audio/video, skipping", fileID)
		return nil
	}

	targetVersion := file.AudioDetectVersion
	zero := 0
	h.setState(fileID, ptr("processing"), &zero, nil, nil)

	// Resolve the active model spec once per job. The spec drives ffmpeg's
	// target sample rate, the model file/URL, and the persisted
	// audio_detect_model column on success.
	spec := h.activeSpec()
	sampleRate := spec.SampleRate
	if sampleRate <= 0 {
		sampleRate = 32000
	}

	tmpDir, err := os.MkdirTemp("", "alcoves-audiodetect-*")
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

	pcmPath := filepath.Join(tmpDir, "audio.f32le")
	if err := extractAudio(ctx, h.cfg.FFmpegBinaryPath, srcPath, pcmPath, sampleRate); err != nil {
		h.fail(fileID, fmt.Errorf("ffmpeg: %w", err))
		return err
	}

	samples, err := readFloat32PCM(pcmPath)
	if err != nil {
		h.fail(fileID, fmt.Errorf("read pcm: %w", err))
		return err
	}
	if len(samples) < sampleRate/2 {
		h.fail(fileID, fmt.Errorf("audio too short (%d samples)", len(samples)))
		return nil
	}

	modelPath, labelsPath, err := EnsureAssets(h.cfg.ModelsPath, spec.ModelFile, h.modelURL(spec), h.cfg.AudioDetectLabelsURL)
	if err != nil {
		h.fail(fileID, err)
		return err
	}
	labels, err := LoadLabels(labelsPath)
	if err != nil {
		h.fail(fileID, err)
		return err
	}

	sess, err := LoadSession(modelPath, sampleRate)
	if err != nil {
		h.fail(fileID, err)
		return err
	}
	defer sess.session.Destroy()

	windowLen := int(h.cfg.AudioDetectWindowSec * float64(sampleRate))
	if windowLen <= 0 {
		windowLen = 10 * sampleRate
	}

	var detections []models.AudioDetection
	nWindows := (len(samples) + windowLen - 1) / windowLen

	for wi := 0; wi < nWindows; wi++ {
		startSample := wi * windowLen
		endSample := startSample + windowLen
		if endSample > len(samples) {
			endSample = len(samples)
		}
		window := samples[startSample:endSample]
		// pad to fixed windowLen for consistent inference
		if len(window) < windowLen {
			padded := make([]float32, windowLen)
			copy(padded, window)
			window = padded
		}

		probs, err := runInference(sess, window)
		if err != nil {
			h.fail(fileID, fmt.Errorf("inference window %d: %w", wi, err))
			return err
		}

		windowStart := float32(startSample) / float32(sampleRate)
		windowEnd := float32(endSample) / float32(sampleRate)
		if actualDur := float32(len(samples)) / float32(sampleRate); windowEnd > actualDur {
			windowEnd = actualDur
		}

		topK := topKAbove(probs, h.cfg.AudioDetectTopK, float32(h.cfg.AudioDetectThreshold))
		for _, idx := range topK {
			label := fmt.Sprintf("class_%d", idx)
			if idx >= 0 && idx < len(labels) {
				label = labels[idx]
			}
			detections = append(detections, models.AudioDetection{
				FileID:       file.ID,
				LibraryID:    file.LibraryID,
				Label:        label,
				ClassIndex:   idx,
				Score:        probs[idx],
				StartSeconds: windowStart,
				EndSeconds:   windowEnd,
				Version:      targetVersion + 1,
			})
		}

		progress := int(math.Round(float64(wi+1) / float64(nWindows) * 100))
		h.setState(fileID, ptr("processing"), &progress, nil, nil)
	}

	// Persist in a transaction: bump version, delete old detections, insert new.
	newVersion := targetVersion + 1
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("file_id = ?", file.ID).Delete(&models.AudioDetection{}).Error; err != nil {
			return err
		}
		if len(detections) > 0 {
			for i := range detections {
				detections[i].Version = newVersion
				detections[i].ID = uuid.Nil
			}
			if err := tx.Create(&detections).Error; err != nil {
				return err
			}
		}
		return tx.Model(&models.File{}).Where("id = ?", file.ID).Updates(map[string]interface{}{
			"audio_detect_status":      "ready",
			"audio_detect_progress":    100,
			"audio_detect_eta_seconds": nil,
			"audio_detect_error":       nil,
			"audio_detect_version":     newVersion,
			"audio_detected_version":   newVersion,
			"audio_detect_model":       spec.ID,
		}).Error
	})
	if err != nil {
		h.fail(fileID, fmt.Errorf("persist detections: %w", err))
		return err
	}

	log.Printf("audio-detect: file %s complete (%d detections)", fileID, len(detections))
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

func (h *TaskHandler) setState(fileID string, status *string, progress, eta *int, errMsg *string) {
	updates := map[string]interface{}{
		"audio_detect_status":      status,
		"audio_detect_progress":    progress,
		"audio_detect_eta_seconds": eta,
		"audio_detect_error":       errMsg,
	}
	h.db.Model(&models.File{}).Where("id = ?", fileID).Updates(updates)
}

func (h *TaskHandler) fail(fileID string, err error) {
	msg := err.Error()
	h.setState(fileID, ptr("failed"), nil, nil, &msg)
}

func ptr(s string) *string { return &s }

// extractAudio emits mono float32 PCM raw at the requested sample rate.
// CED models want 16 kHz, PANN + EfficientAT want 32 kHz; the active
// model's spec drives sampleRate at call time.
func extractAudio(ctx context.Context, ffmpeg, src, dst string, sampleRate int) error {
	if sampleRate <= 0 {
		sampleRate = 32000
	}
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-y",
		"-i", src,
		"-vn",
		"-ac", "1",
		"-ar", fmt.Sprintf("%d", sampleRate),
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

func readFloat32PCM(path string) ([]float32, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("pcm size %d not multiple of 4", len(data))
	}
	n := len(data) / 4
	out := make([]float32, n)
	for i := 0; i < n; i++ {
		bits := binary.LittleEndian.Uint32(data[i*4 : i*4+4])
		out[i] = math.Float32frombits(bits)
	}
	return out, nil
}

func runInference(sess *sessionInfo, window []float32) ([]float32, error) {
	shape := ort.NewShape(1, int64(len(window)))
	input, err := ort.NewTensor(shape, window)
	if err != nil {
		return nil, fmt.Errorf("new tensor: %w", err)
	}
	defer input.Destroy()

	outputs := make([]ort.Value, 1)
	if err := sess.session.Run([]ort.Value{input}, outputs); err != nil {
		return nil, fmt.Errorf("run: %w", err)
	}
	defer func() {
		for _, o := range outputs {
			if o != nil {
				o.Destroy()
			}
		}
	}()

	t, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, fmt.Errorf("unexpected output tensor type")
	}
	raw := t.GetData()
	// If output looks like logits (not in [0,1]), apply sigmoid.
	if needsSigmoid(raw) {
		sig := make([]float32, len(raw))
		for i, v := range raw {
			sig[i] = float32(1.0 / (1.0 + math.Exp(-float64(v))))
		}
		return sig, nil
	}
	// Copy to decouple from ORT memory.
	out := make([]float32, len(raw))
	copy(out, raw)
	return out, nil
}

func needsSigmoid(v []float32) bool {
	// Treat as logits if any value is outside [-0.01, 1.01].
	for _, x := range v {
		if x < -0.01 || x > 1.01 {
			return true
		}
	}
	return false
}

func topKAbove(probs []float32, k int, threshold float32) []int {
	type pair struct {
		idx   int
		score float32
	}
	all := make([]pair, 0, len(probs))
	for i, p := range probs {
		if p >= threshold {
			all = append(all, pair{i, p})
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].score > all[j].score })
	if k > 0 && len(all) > k {
		all = all[:k]
	}
	out := make([]int, len(all))
	for i, p := range all {
		out[i] = p.idx
	}
	return out
}
