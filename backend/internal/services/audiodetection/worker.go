package audiodetection

import (
	"bufio"
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
	"sync"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	ort "github.com/yalue/onnxruntime_go"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// Package-level ONNX session cache keyed by the active model. The session is
// loaded lazily and reused across tasks; it is reloaded only when the active
// model/sample-rate changes (e.g. an admin swaps audio_detect_model at
// runtime), so inference never runs through a stale model. The mutex also
// guards concurrent inference calls because ort.DynamicAdvancedSession.Run is
// not documented as goroutine-safe.
var (
	cachedSession *sessionInfo
	cachedKey     string
	sessionMu     sync.Mutex
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
// rolled-back deploy) AND unavailable IDs (a model catalogued but not yet
// published to the bucket — selecting it would 404) fall back rather than
// failing the job. A non-empty ID that misses is logged so operators can see
// why their selection isn't taking effect.
func (h *TaskHandler) activeSpec() ModelSpec {
	id := ""
	if h.settingsSvc != nil {
		id = h.settingsSvc.Get().AudioDetectModel
	}
	spec, ok := LookupSpec(id)
	if id != "" && !ok {
		log.Printf("audio-detect: configured model %q is unknown or not published; falling back to %q", id, spec.ID)
	}
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

// getSession returns the ONNX session for the given model, loading it on the
// first call and reusing it for subsequent calls with the same
// (modelPath, sampleRate) key. When the key changes — e.g. an admin selects a
// different audio_detect_model at runtime — a fresh session is loaded so
// inference always runs through the active model rather than a stale one.
//
// The previous session is intentionally NOT Destroy()ed here: another in-flight
// job may still hold its pointer (inference is serialized by sessionMu, but the
// pointer is captured before the loop and outlives individual lock windows), so
// freeing its C memory would risk a use-after-free. A model switch is a rare
// admin action, so leaking one session per switch is an acceptable trade.
func getSession(modelPath string, sampleRate int) (*sessionInfo, error) {
	key := fmt.Sprintf("%s|%d", modelPath, sampleRate)
	sessionMu.Lock()
	defer sessionMu.Unlock()
	if cachedSession != nil && cachedKey == key {
		return cachedSession, nil
	}
	sess, err := LoadSession(modelPath, sampleRate)
	if err != nil {
		return nil, err
	}
	cachedSession = sess
	cachedKey = key
	return sess, nil
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

	// Validate minimum length without loading the full file.
	pcmInfo, err := os.Stat(pcmPath)
	if err != nil {
		h.fail(fileID, fmt.Errorf("stat pcm: %w", err))
		return err
	}
	// f32le PCM must be a whole number of 4-byte float32 samples. A non-multiple
	// size means a truncated/corrupt extraction; fail loudly rather than
	// silently dropping the trailing bytes (the pre-streaming bulk reader did
	// the same).
	if pcmInfo.Size()%4 != 0 {
		h.fail(fileID, fmt.Errorf("corrupt PCM: size %d not a multiple of 4 bytes", pcmInfo.Size()))
		return fmt.Errorf("corrupt PCM size %d", pcmInfo.Size())
	}
	totalSamples := int(pcmInfo.Size() / 4)
	if totalSamples < sampleRate/2 {
		h.fail(fileID, fmt.Errorf("audio too short (%d samples)", totalSamples))
		return nil
	}

	modelPath, labelsPath, err := EnsureAssets(ctx, h.cfg.ModelsPath, spec.ModelFile, h.modelURL(spec), h.cfg.AudioDetectLabelsURL)
	if err != nil {
		h.fail(fileID, err)
		return err
	}
	labels, err := LoadLabels(labelsPath)
	if err != nil {
		h.fail(fileID, err)
		return err
	}

	// Use the cached session — LoadSession is called at most once per process.
	sess, err := getSession(modelPath, sampleRate)
	if err != nil {
		h.fail(fileID, err)
		return err
	}

	windowLen := int(h.cfg.AudioDetectWindowSec * float64(sampleRate))
	if windowLen <= 0 {
		windowLen = 10 * sampleRate
	}

	var detections []models.AudioDetection
	nWindows := (totalSamples + windowLen - 1) / windowLen

	// Open the PCM file and stream one window at a time — peak RSS is
	// O(windowLen) not O(totalSamples).
	pcmFile, err := os.Open(pcmPath)
	if err != nil {
		h.fail(fileID, fmt.Errorf("open pcm: %w", err))
		return err
	}
	defer pcmFile.Close()

	br := bufio.NewReaderSize(pcmFile, 64*1024)
	// Reusable window buffer; padded with zeros for the final partial window.
	window := make([]float32, windowLen)
	windowBytes := windowLen * 4
	rawBuf := make([]byte, windowBytes)

	for wi := 0; wi < nWindows; wi++ {
		startSample := wi * windowLen

		n, rerr := io.ReadFull(br, rawBuf)
		actualLen := n / 4 // complete float32 samples read
		if rerr != nil && rerr != io.ErrUnexpectedEOF {
			if rerr == io.EOF {
				break
			}
			h.fail(fileID, fmt.Errorf("read pcm window %d: %w", wi, rerr))
			return rerr
		}

		// Decode raw bytes into the reusable window slice; zero-pad remainder.
		decodePCMBytes(rawBuf[:n], window)

		endSample := startSample + actualLen

		// Guard concurrent inference with the package-level mutex —
		// ort.DynamicAdvancedSession.Run is not documented as goroutine-safe.
		sessionMu.Lock()
		probs, inferErr := runInference(sess, window)
		sessionMu.Unlock()
		if inferErr != nil {
			h.fail(fileID, fmt.Errorf("inference window %d: %w", wi, inferErr))
			return inferErr
		}

		windowStart := float32(startSample) / float32(sampleRate)
		windowEnd := float32(endSample) / float32(sampleRate)
		actualDur := float32(totalSamples) / float32(sampleRate)
		if windowEnd > actualDur {
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
				Version:      targetVersion,
			})
		}

		progress := int(math.Round(float64(wi+1) / float64(nWindows) * 100))
		h.setState(fileID, ptr("processing"), &progress, nil, nil)
	}

	// Apply the results only if a concurrent reprocess hasn't bumped the
	// version out from under us — complete's guarded transaction makes the
	// check-and-write atomic, so a stale run can never clobber a fresh job's
	// detections or freshly-queued status.
	if err := h.complete(file.ID, targetVersion, detections, spec.ID); err != nil {
		if errors.Is(err, errSuperseded) {
			log.Printf("audio-detect: version moved on, discarding stale work for file %s", fileID)
			return nil
		}
		h.fail(fileID, fmt.Errorf("persist detections: %w", err))
		return err
	}

	log.Printf("audio-detect: file %s complete (%d detections)", fileID, len(detections))
	return nil
}

// errSuperseded signals that audio_detect_version moved on while a run was in
// flight (a reprocess was queued mid-run); returning it from inside complete's
// transaction rolls the detections delete+insert back along with the file
// update, so the stale results vanish without a trace.
var errSuperseded = errors.New("audio detect version superseded")

// complete replaces the file's detections and marks the job ready in a single
// transaction, but only if audio_detect_version still equals the version this
// run started from. The trigger side owns bumping audio_detect_version (the
// worker never touches it); a reprocess bumps the version, so the guard turns
// stale work into a no-op atomically (no read-then-write race).
func (h *TaskHandler) complete(fileID uuid.UUID, targetVersion int, detections []models.AudioDetection, modelID string) error {
	return h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("file_id = ?", fileID).Delete(&models.AudioDetection{}).Error; err != nil {
			return err
		}
		if len(detections) > 0 {
			if err := tx.Create(&detections).Error; err != nil {
				return err
			}
		}
		res := tx.Model(&models.File{}).
			Where("id = ? AND audio_detect_version = ?", fileID, targetVersion).
			Updates(map[string]interface{}{
				"audio_detect_status":      "ready",
				"audio_detect_progress":    100,
				"audio_detect_eta_seconds": nil,
				"audio_detect_error":       nil,
				"audio_detected_version":   targetVersion,
				"audio_detect_model":       modelID,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errSuperseded
		}
		return nil
	})
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

// decodePCMBytes decodes n bytes of little-endian float32 PCM from raw into
// dst, zero-padding any trailing dst elements not covered by raw.
// len(raw) must be a multiple of 4; len(dst) must be >= len(raw)/4.
func decodePCMBytes(raw []byte, dst []float32) {
	n := len(raw) / 4
	for j := 0; j < n; j++ {
		bits := binary.LittleEndian.Uint32(raw[j*4 : j*4+4])
		dst[j] = math.Float32frombits(bits)
	}
	for j := n; j < len(dst); j++ {
		dst[j] = 0
	}
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
