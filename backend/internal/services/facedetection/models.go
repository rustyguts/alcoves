package facedetection

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/alcoves/alcoves-backend/internal/services/modelfetch"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	detectionModelFile   = "detection-model.onnx"
	recognitionModelFile = "recognition-model.onnx"

	// Self-hosted mirrors (SCRFD det_10g + ArcFace W600K R50, originally from InsightFace buffalo_l)
	detectionModelURL   = "https://s3.rustyguts.net/models/det_10g.onnx"
	recognitionModelURL = "https://s3.rustyguts.net/models/w600k_r50.onnx"

	minModelSize = 1 * 1024 * 1024 // 1MB — anything smaller is likely an LFS pointer or error page
)

var (
	ortInitOnce sync.Once
	ortInitErr  error
)

// initONNXRuntime initializes the ONNX Runtime library once.
func initONNXRuntime() error {
	ortInitOnce.Do(func() {
		ortInitErr = ort.InitializeEnvironment()
		if ortInitErr != nil {
			log.Printf("Failed to initialize ONNX Runtime: %v", ortInitErr)
		}
	})
	return ortInitErr
}

// EnsureModelsDownloaded downloads ONNX models to modelsPath if they don't already exist.
func EnsureModelsDownloaded(modelsPath string) error {
	if err := os.MkdirAll(modelsPath, 0o755); err != nil {
		return fmt.Errorf("failed to create models directory: %w", err)
	}

	models := []struct {
		filename string
		url      string
	}{
		{detectionModelFile, detectionModelURL},
		{recognitionModelFile, recognitionModelURL},
	}

	for _, m := range models {
		dest := filepath.Join(modelsPath, m.filename)
		if err := modelfetch.FetchToFile(context.Background(), m.url, dest, modelfetch.Options{
			MinSize:     minModelSize,
			RejectHTML:  true,
			LogProgress: true,
		}); err != nil {
			return fmt.Errorf("failed to download %s: %w", m.filename, err)
		}
	}
	return nil
}

// LoadDetectionSession creates an ONNX Runtime session for the SCRFD detection model.
// Downloads models on first use if not already present.
func LoadDetectionSession(modelsPath string) (*ort.DynamicAdvancedSession, error) {
	if err := EnsureModelsDownloaded(modelsPath); err != nil {
		return nil, fmt.Errorf("failed to ensure face detection models: %w", err)
	}

	if err := initONNXRuntime(); err != nil {
		return nil, err
	}

	modelPath := filepath.Join(modelsPath, detectionModelFile)

	// SCRFD det_10g ships under two output-naming conventions: the canonical
	// InsightFace export uses numeric node names (448, 471, 494, …) while some
	// re-exports rename them to score_8/bbox_8/kps_8/…. Both declare the same
	// nine outputs in the same semantic order — scores (stride 8/16/32), bboxes
	// (8/16/32), keypoints (8/16/32) — which is exactly the order detect.go
	// decodes by index. Read the names from the model rather than hard-coding one
	// convention, so whichever variant is on the mirror loads correctly.
	// (Hard-coding "score_8" failed at inference against the numeric-named mirror
	// model with "Invalid output name: score_8".)
	inInfo, outInfo, err := ort.GetInputOutputInfo(modelPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read detection model i/o info: %w", err)
	}
	if len(inInfo) != 1 || len(outInfo) != 9 {
		return nil, fmt.Errorf("unexpected SCRFD model shape: %d inputs / %d outputs (want 1 / 9)", len(inInfo), len(outInfo))
	}
	inputs := []string{inInfo[0].Name}
	outputs := make([]string, len(outInfo))
	for i, o := range outInfo {
		outputs[i] = o.Name
	}

	session, err := ort.NewDynamicAdvancedSession(modelPath, inputs, outputs, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create detection session: %w", err)
	}
	return session, nil
}

// LoadRecognitionSession creates an ONNX Runtime session for the ArcFace recognition model.
// It tries different input/output name combinations until one works with actual inference.
func LoadRecognitionSession(modelsPath string) (*ort.DynamicAdvancedSession, error) {
	if err := initONNXRuntime(); err != nil {
		return nil, err
	}

	modelPath := filepath.Join(modelsPath, recognitionModelFile)

	// Known input/output name combinations for different InsightFace ArcFace models
	combinations := []struct {
		input  string
		output string
	}{
		{"input.1", "683"},     // InsightFace buffalo_l (official ONNX export)
		{"input.1", "267"},     // Alternative ONNX numbered outputs
		{"input.1", "fc1"},     // ONNX with standard output
		{"data", "fc1"},        // Original InsightFace Python API
		{"input", "fc1"},       // Alternative variant
		{"input.1", "output"},  // ONNX generic output
		{"data", "output"},     // Alternative combinations
		{"input", "output"},    // Common generic names
		{"input", "embedding"}, // Alternative embedding output
	}

	// We'll store the first working session we find
	for _, combo := range combinations {
		session, err := ort.NewDynamicAdvancedSession(modelPath, []string{combo.input}, []string{combo.output}, nil)
		if err != nil {
			continue // Try next combination
		}

		// Test if this combination actually works by creating a dummy input and running inference
		dummyData := make([]float32, 3*112*112) // ArcFace input size
		inputShape := ort.NewShape(1, 3, 112, 112)
		testInput, err := ort.NewTensor(inputShape, dummyData)
		if err != nil {
			session.Destroy()
			continue
		}

		outputs := make([]ort.Value, 1)
		err = session.Run([]ort.Value{testInput}, outputs)
		testInput.Destroy()

		if err == nil {
			// Success! This combination works
			if outputs[0] != nil {
				outputs[0].Destroy()
			}
			log.Printf("✓ Recognition model loaded successfully with input='%s', output='%s'", combo.input, combo.output)
			return session, nil
		}

		// Log why this combination failed
		log.Printf("  Tried input='%s', output='%s' - inference test failed: %v", combo.input, combo.output, err)

		// Clean up failed attempt
		session.Destroy()
		for _, o := range outputs {
			if o != nil {
				o.Destroy()
			}
		}
	}

	return nil, fmt.Errorf("failed to load recognition model: tried all known input/output name combinations but none worked")
}
