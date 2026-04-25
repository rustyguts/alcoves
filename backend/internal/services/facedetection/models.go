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
	"time"

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
		if err := downloadIfNeeded(dest, m.url); err != nil {
			return fmt.Errorf("failed to download %s: %w", m.filename, err)
		}
	}
	return nil
}

// downloadIfNeeded downloads a file from url to dest if the file doesn't exist or is invalid.
// Retries up to 6 times on transient (5xx / network) errors with exponential backoff.
func downloadIfNeeded(dest, url string) error {
	if info, err := os.Stat(dest); err == nil {
		if info.Size() > minModelSize {
			return nil
		}
		log.Printf("Model file %s is too small (%d bytes), re-downloading", dest, info.Size())
	}

	const maxAttempts = 6
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		log.Printf("Downloading model to %s (attempt %d/%d)...", dest, attempt, maxAttempts)
		err := doDownload(dest, url)
		if err == nil {
			return nil
		}
		lastErr = err
		s := err.Error()
		if !(strings.Contains(s, "HTTP 5") || strings.Contains(s, "connection reset") || strings.Contains(s, "unexpected EOF") || strings.Contains(s, "EOF")) {
			return err
		}
		backoff := time.Duration(1<<uint(attempt-1)) * time.Second
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
		log.Printf("Transient download error (%v), retrying in %s", err, backoff)
		time.Sleep(backoff)
	}
	return fmt.Errorf("download failed after %d attempts: %w", maxAttempts, lastErr)
}

func doDownload(dest, url string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
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

	totalSize := resp.ContentLength

	tmpFile := dest + ".tmp"
	f, err := os.Create(tmpFile)
	if err != nil {
		return err
	}

	written, err := io.Copy(f, &progressReader{r: resp.Body, total: totalSize, label: filepath.Base(dest)})
	f.Close()
	if err != nil {
		os.Remove(tmpFile)
		return err
	}

	log.Printf("Download complete: %s (%d bytes)", filepath.Base(dest), written)

	if written < minModelSize {
		os.Remove(tmpFile)
		return fmt.Errorf("downloaded file too small (%d bytes), likely invalid", written)
	}

	return os.Rename(tmpFile, dest)
}

// progressReader wraps an io.Reader and logs download progress periodically.
type progressReader struct {
	r          io.Reader
	total      int64
	read       int64
	label      string
	lastReport time.Time
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	pr.read += int64(n)
	if time.Since(pr.lastReport) > 5*time.Second {
		pr.lastReport = time.Now()
		if pr.total > 0 {
			pct := float64(pr.read) / float64(pr.total) * 100
			log.Printf("Downloading %s: %.1f%% (%d / %d bytes)", pr.label, pct, pr.read, pr.total)
		} else {
			log.Printf("Downloading %s: %d bytes", pr.label, pr.read)
		}
	}
	return n, err
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
