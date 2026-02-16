package facedetection

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

const (
	detectionModelFile   = "detection-model.onnx"
	recognitionModelFile = "recognition-model.onnx"

	// HuggingFace model URLs (SCRFD_34G and GLintR100)
	detectionModelURL   = "https://huggingface.co/rustyguts/alcoves-models/resolve/main/det_10g.onnx"
	recognitionModelURL = "https://huggingface.co/rustyguts/alcoves-models/resolve/main/w600k_r50.onnx"

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
		if err := downloadIfNeeded(dest, m.url); err != nil {
			return fmt.Errorf("failed to download %s: %w", m.filename, err)
		}
	}
	return nil
}

// downloadIfNeeded downloads a file from url to dest if the file doesn't exist or is invalid.
func downloadIfNeeded(dest, url string) error {
	// Check if file already exists and is valid
	if info, err := os.Stat(dest); err == nil {
		if info.Size() > minModelSize {
			return nil // Already downloaded and valid
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

	// Check content type — HTML means we got an LFS pointer page
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

// LoadDetectionSession creates an ONNX Runtime session for the SCRFD detection model.
func LoadDetectionSession(modelsPath string) (*ort.DynamicAdvancedSession, error) {
	if err := initONNXRuntime(); err != nil {
		return nil, err
	}

	modelPath := filepath.Join(modelsPath, detectionModelFile)
	inputs := []string{"input.1"}
	outputs := []string{
		"score_8", "score_16", "score_32",
		"bbox_8", "bbox_16", "bbox_32",
		"kps_8", "kps_16", "kps_32",
	}

	session, err := ort.NewDynamicAdvancedSession(modelPath, inputs, outputs, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create detection session: %w", err)
	}
	return session, nil
}

// LoadRecognitionSession creates an ONNX Runtime session for the ArcFace recognition model.
func LoadRecognitionSession(modelsPath string) (*ort.DynamicAdvancedSession, error) {
	if err := initONNXRuntime(); err != nil {
		return nil, err
	}

	modelPath := filepath.Join(modelsPath, recognitionModelFile)
	inputs := []string{"data"}
	outputs := []string{"fc1"}

	session, err := ort.NewDynamicAdvancedSession(modelPath, inputs, outputs, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create recognition session: %w", err)
	}
	return session, nil
}
