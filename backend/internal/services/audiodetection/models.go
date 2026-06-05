package audiodetection

import (
	"bufio"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/alcoves/alcoves-backend/internal/services/modelfetch"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	// labelsFile is the on-disk cache name for the AudioSet 527-class
	// display-name CSV. Shared across every model in the registry — the
	// label space is identical for PANN, EfficientAT, and CED.
	labelsFile = "audioset_labels.csv"

	minModelSize = 1 * 1024 * 1024 // 1MB sanity threshold
)

// EnsureAssets downloads the active ONNX model + the shared label CSV if
// missing. modelFile is the per-model filename from the registry; modelURL
// is the fully-resolved URL the worker constructed from
// AudioDetectModelBaseURL + modelFile.
func EnsureAssets(ctx context.Context, modelsDir, modelFile, modelURL, labelsURL string) (string, string, error) {
	if err := os.MkdirAll(modelsDir, 0o755); err != nil {
		return "", "", fmt.Errorf("mkdir models: %w", err)
	}
	modelPath := filepath.Join(modelsDir, modelFile)
	labelsPath := filepath.Join(modelsDir, labelsFile)

	if err := modelfetch.FetchToFile(ctx, modelURL, modelPath, modelfetch.Options{
		MinSize:    minModelSize,
		RejectHTML: true,
	}); err != nil {
		return "", "", fmt.Errorf("download model: %w", err)
	}
	if err := modelfetch.FetchToFile(ctx, labelsURL, labelsPath, modelfetch.Options{
		MinSize:    1024,
		RejectHTML: false, // csv: html allowed
	}); err != nil {
		return "", "", fmt.Errorf("download labels: %w", err)
	}
	return modelPath, labelsPath, nil
}

// LoadLabels parses an AudioSet class_labels_indices.csv
// Expected columns: index, mid, display_name (header row skipped).
func LoadLabels(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	r := csv.NewReader(bufio.NewReader(f))
	r.FieldsPerRecord = -1

	labels := make([]string, 0, 527)
	first := true
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse labels csv: %w", err)
		}
		if first {
			first = false
			// detect header
			if len(rec) >= 3 && (strings.EqualFold(rec[0], "index") || strings.EqualFold(rec[0], "idx")) {
				continue
			}
		}
		if len(rec) < 3 {
			continue
		}
		labels = append(labels, strings.TrimSpace(rec[2]))
	}
	if len(labels) == 0 {
		return nil, fmt.Errorf("no labels parsed from %s", path)
	}
	return labels, nil
}

type sessionInfo struct {
	session    *ort.DynamicAdvancedSession
	inputName  string
	outputName string
}

// probeInputs / probeOutputs cover the common input/output node naming
// conventions across PANN, EfficientAT, and CED ONNX exports. The worker
// tries every combo and keeps the first that runs successfully against
// a 1-second silent probe at the model's expected sample rate.
//
// Conventions seen in the wild:
//   - PANN waveform models: input "audio"/"input"/"waveform"/"x", output
//     "clipwise_output".
//   - HF Optimum exports (CED, AST): input "input_values", output "logits".
//   - torch.onnx.export defaults: input "input.1"/"onnx::*", output
//     "Identity:0".
var probeInputs = []string{
	"audio", "input", "waveform", "x",
	"input_1", "input:0", "input_values", "input.1",
	"spec", "mel", "wav", "audio_input",
}
var probeOutputs = []string{
	"clipwise_output", "output", "logits", "pred", "preds",
	"Identity", "Identity:0", "Identity_1:0",
}

// LoadSession opens the ONNX model, trying common input/output name combos
// and verifying the chosen pair runs against a 1s silent probe at sampleRate.
// sampleRate must match the model's expected input rate (32 kHz for PANN
// + EfficientAT, 16 kHz for CED) — otherwise the probe shape mismatches
// any single-rate model that bakes its rate into the graph.
func LoadSession(modelPath string, sampleRate int) (*sessionInfo, error) {
	if err := initONNXRuntime(); err != nil {
		return nil, err
	}
	if sampleRate <= 0 {
		sampleRate = 32000
	}

	for _, in := range probeInputs {
		for _, out := range probeOutputs {
			sess, err := ort.NewDynamicAdvancedSession(modelPath, []string{in}, []string{out}, nil)
			if err != nil {
				continue
			}
			dummy := make([]float32, sampleRate)
			shape := ort.NewShape(1, int64(sampleRate))
			testInput, terr := ort.NewTensor(shape, dummy)
			if terr != nil {
				sess.Destroy()
				continue
			}
			outputs := make([]ort.Value, 1)
			rerr := sess.Run([]ort.Value{testInput}, outputs)
			testInput.Destroy()
			for _, o := range outputs {
				if o != nil {
					o.Destroy()
				}
			}
			if rerr != nil {
				sess.Destroy()
				continue
			}
			log.Printf("audiodetection: session loaded (input=%s output=%s rate=%d)", in, out, sampleRate)
			return &sessionInfo{session: sess, inputName: in, outputName: out}, nil
		}
	}
	return nil, fmt.Errorf("could not find a working input/output combination for audio-tagger model")
}
