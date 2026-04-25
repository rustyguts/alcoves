package objectdetection

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	ort "github.com/yalue/onnxruntime_go"
)

const (
	objectModelFile = "yolo26x_fp16.onnx"

	// YOLO26x FP16 ONNX mirror.
	objectModelURL = "https://s3.rustyguts.net/models/yolo26x_fp16.onnx"

	minModelSize = 1 * 1024 * 1024 // 1MB — anything smaller is likely invalid
)

// EnsureModelsDownloaded downloads the YOLO26x ONNX model if not already present.
func EnsureModelsDownloaded(modelsPath string) error {
	if err := os.MkdirAll(modelsPath, 0o755); err != nil {
		return fmt.Errorf("failed to create models directory: %w", err)
	}

	dest := filepath.Join(modelsPath, objectModelFile)
	return downloadIfNeeded(dest, objectModelURL)
}

// downloadIfNeeded downloads a file from url to dest if the file doesn't exist or is invalid.
// Retries up to 6 times on transient (5xx / network) errors.
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

// LoadDetectionSession creates an ONNX Runtime session for the YOLO26x model.
// YOLO26x has input "pixel_values" and two outputs: "logits" [1,300,80] and "pred_boxes" [1,300,4].
// Downloads the model on first use if not already present.
func LoadDetectionSession(modelsPath string) (*ort.DynamicAdvancedSession, error) {
	if err := EnsureModelsDownloaded(modelsPath); err != nil {
		return nil, fmt.Errorf("failed to ensure object detection model: %w", err)
	}

	if err := initONNXRuntime(); err != nil {
		return nil, err
	}

	modelPath := filepath.Join(modelsPath, objectModelFile)

	session, err := ort.NewDynamicAdvancedSession(
		modelPath,
		[]string{"pixel_values"},
		[]string{"logits", "pred_boxes"},
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create ONNX session: %w", err)
	}

	// Test with a dummy input to verify the session works
	dummyData := make([]float32, 3*640*640)
	inputShape := ort.NewShape(1, 3, 640, 640)
	testInput, err := ort.NewTensor(inputShape, dummyData)
	if err != nil {
		session.Destroy()
		return nil, fmt.Errorf("failed to create test tensor: %w", err)
	}

	outputs := make([]ort.Value, 2)
	err = session.Run([]ort.Value{testInput}, outputs)
	testInput.Destroy()
	for _, o := range outputs {
		if o != nil {
			o.Destroy()
		}
	}

	if err != nil {
		session.Destroy()
		return nil, fmt.Errorf("YOLO26x inference test failed: %w", err)
	}

	log.Printf("YOLO26x object detection model loaded successfully")
	return session, nil
}
