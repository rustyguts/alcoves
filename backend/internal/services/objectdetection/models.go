package objectdetection

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var (
	ortInitOnce sync.Once
	ortInitErr  error
)

func initONNXRuntime() error {
	ortInitOnce.Do(func() {
		ortInitErr = ort.InitializeEnvironment()
		if ortInitErr != nil {
			log.Printf("Failed to initialize ONNX Runtime: %v", ortInitErr)
		}
	})
	return ortInitErr
}

const (
	objectModelFile = "yolov8s.onnx"

	// YOLOv8s ONNX model hosted on the alcoves-models HuggingFace repo.
	objectModelURL = "https://huggingface.co/rustyguts/alcoves-models/resolve/main/yolov8s.onnx"

	minModelSize = 1 * 1024 * 1024 // 1MB — anything smaller is likely invalid
)

// EnsureModelsDownloaded downloads the YOLOv8 ONNX model if not already present.
func EnsureModelsDownloaded(modelsPath string) error {
	if err := os.MkdirAll(modelsPath, 0o755); err != nil {
		return fmt.Errorf("failed to create models directory: %w", err)
	}

	dest := filepath.Join(modelsPath, objectModelFile)
	return downloadIfNeeded(dest, objectModelURL)
}

// downloadIfNeeded downloads a file from url to dest if the file doesn't exist or is invalid.
func downloadIfNeeded(dest, url string) error {
	if info, err := os.Stat(dest); err == nil {
		if info.Size() > minModelSize {
			return nil
		}
		log.Printf("Model file %s is too small (%d bytes), re-downloading", dest, info.Size())
	}

	log.Printf("Downloading model to %s ...", dest)

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d downloading %s", resp.StatusCode, url)
	}

	ct := resp.Header.Get("Content-Type")
	if strings.Contains(ct, "text/html") {
		return fmt.Errorf("got HTML response (LFS pointer?) for %s", url)
	}

	tmpFile := dest + ".tmp"
	f, err := os.Create(tmpFile)
	if err != nil {
		return err
	}

	written, err := io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		os.Remove(tmpFile)
		return err
	}

	if written < minModelSize {
		os.Remove(tmpFile)
		return fmt.Errorf("downloaded file too small (%d bytes), likely invalid", written)
	}

	return os.Rename(tmpFile, dest)
}

// LoadDetectionSession creates an ONNX Runtime session for the YOLOv8 model.
// YOLOv8 has a single input "images" and a single output "output0".
func LoadDetectionSession(modelsPath string) (*ort.DynamicAdvancedSession, error) {
	if err := initONNXRuntime(); err != nil {
		return nil, err
	}

	modelPath := filepath.Join(modelsPath, objectModelFile)

	// Try known input/output name combinations for YOLOv8 ONNX exports
	combinations := []struct {
		input  string
		output string
	}{
		{"images", "output0"},  // Ultralytics default export
		{"input", "output"},    // Alternative ONNX naming
		{"input.1", "output0"}, // Torch export variant
	}

	for _, combo := range combinations {
		session, err := ort.NewDynamicAdvancedSession(modelPath, []string{combo.input}, []string{combo.output}, nil)
		if err != nil {
			continue
		}

		// Test with a dummy input to verify the combination works
		dummyData := make([]float32, 3*640*640)
		inputShape := ort.NewShape(1, 3, 640, 640)
		testInput, err := ort.NewTensor(inputShape, dummyData)
		if err != nil {
			session.Destroy()
			continue
		}

		outputs := make([]ort.Value, 1)
		err = session.Run([]ort.Value{testInput}, outputs)
		testInput.Destroy()

		if err == nil {
			if outputs[0] != nil {
				outputs[0].Destroy()
			}
			log.Printf("Object detection model loaded successfully with input='%s', output='%s'", combo.input, combo.output)
			return session, nil
		}

		log.Printf("  Tried input='%s', output='%s' — inference test failed: %v", combo.input, combo.output, err)
		session.Destroy()
		for _, o := range outputs {
			if o != nil {
				o.Destroy()
			}
		}
	}

	return nil, fmt.Errorf("failed to load object detection model: tried all known input/output name combinations but none worked")
}
