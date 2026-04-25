package audiodetection

import (
	"bufio"
	"encoding/csv"
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
	modelFile  = "panns_cnn14.onnx"
	labelsFile = "audioset_labels.csv"

	minModelSize = 1 * 1024 * 1024 // 1MB sanity threshold
)

// EnsureAssets downloads the PANNs ONNX model + label CSV if missing.
func EnsureAssets(modelsDir, modelURL, labelsURL string) (string, string, error) {
	if err := os.MkdirAll(modelsDir, 0o755); err != nil {
		return "", "", fmt.Errorf("mkdir models: %w", err)
	}
	modelPath := filepath.Join(modelsDir, modelFile)
	labelsPath := filepath.Join(modelsDir, labelsFile)

	if err := downloadIfMissing(modelPath, modelURL, minModelSize); err != nil {
		return "", "", fmt.Errorf("download model: %w", err)
	}
	if err := downloadIfMissing(labelsPath, labelsURL, 1024); err != nil {
		return "", "", fmt.Errorf("download labels: %w", err)
	}
	return modelPath, labelsPath, nil
}

func downloadIfMissing(dest, url string, minSize int64) error {
	if info, err := os.Stat(dest); err == nil {
		if info.Size() >= minSize {
			return nil
		}
		log.Printf("audiodetection: existing file %s too small (%d), re-downloading", dest, info.Size())
	}

	const maxAttempts = 6
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		log.Printf("audiodetection: downloading %s (attempt %d/%d)", url, attempt, maxAttempts)
		err := doDownload(dest, url)
		if err == nil {
			return nil
		}
		lastErr = err
		if !isTransient(err) {
			return err
		}
		backoff := time.Duration(1<<uint(attempt-1)) * time.Second
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
		log.Printf("audiodetection: transient error (%v), retrying in %s", err, backoff)
		time.Sleep(backoff)
	}
	return fmt.Errorf("download failed after %d attempts: %w", maxAttempts, lastErr)
}

type transientErr struct{ err error }

func (e *transientErr) Error() string { return e.err.Error() }
func (e *transientErr) Unwrap() error { return e.err }

func isTransient(err error) bool {
	var t *transientErr
	return err != nil && (errorAs(err, &t) || strings.Contains(err.Error(), "connection reset") || strings.Contains(err.Error(), "EOF") || strings.Contains(err.Error(), "unexpected EOF"))
}

func errorAs(err error, target **transientErr) bool {
	for e := err; e != nil; {
		if t, ok := e.(*transientErr); ok {
			*target = t
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := e.(unwrapper)
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}

func doDownload(dest, url string) error {
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return &transientErr{err: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return &transientErr{err: fmt.Errorf("http %d: %s", resp.StatusCode, url)}
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("http %d: %s", resp.StatusCode, url)
	}

	ct := resp.Header.Get("Content-Type")
	if strings.Contains(ct, "text/html") && !strings.HasSuffix(dest, ".csv") {
		return fmt.Errorf("got HTML response for %s (bad URL?)", url)
	}

	tmp := dest + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return &transientErr{err: err}
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
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

var panEnvInputs = []string{"audio", "input", "waveform", "x", "input_1", "input:0"}
var panEnvOutputs = []string{"clipwise_output", "output", "logits", "Identity:0", "Identity"}

// LoadSession opens the PANNs model, trying common input/output name combos.
func LoadSession(modelPath string) (*sessionInfo, error) {
	if err := initONNXRuntime(); err != nil {
		return nil, err
	}

	for _, in := range panEnvInputs {
		for _, out := range panEnvOutputs {
			sess, err := ort.NewDynamicAdvancedSession(modelPath, []string{in}, []string{out}, nil)
			if err != nil {
				continue
			}
			// Probe with a short 1s silent waveform at 32kHz.
			dummy := make([]float32, 32000)
			shape := ort.NewShape(1, 32000)
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
			log.Printf("audiodetection: session loaded (input=%s output=%s)", in, out)
			return &sessionInfo{session: sess, inputName: in, outputName: out}, nil
		}
	}
	return nil, fmt.Errorf("could not find a working input/output combination for PANNs model")
}
