// Package modelfetch is the single, correct implementation of "download a model
// file robustly with retry/backoff". It replaces four drifted copies that lived
// in facedetection, objectdetection, audiodetection, and transcribe.
package modelfetch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Options tunes a FetchToFile download. Zero values give sane defaults.
type Options struct {
	MinSize     int64         // skip re-download if existing file >= MinSize; reject a finished download < MinSize. 0 disables the size check.
	RejectHTML  bool          // treat a text/html response body as a permanent error (LFS pointer / error page).
	Timeout     time.Duration // per-attempt HTTP client timeout. 0 → 30*time.Minute.
	MaxAttempts int           // 0 → 6.
	Label       string        // progress log label. "" → filepath.Base(dest).
	LogProgress bool          // periodic (~5s) download-progress logging.
	// SHA256 is the expected lowercase-hex SHA-256 of the file. When set, a
	// cached file is reused only if its hash matches (a stale file of the wrong
	// model — right size, wrong contents — is re-downloaded rather than silently
	// used), and a finished download whose hash mismatches is a permanent error.
	// "" disables hash verification.
	SHA256 string
}

// fileSHA256 returns the lowercase hex SHA-256 of the file at path.
func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// errTransient marks an error as worth retrying. Network failures, HTTP 5xx,
// and connection-reset / EOF mid-stream wrap it; 4xx, HTML bodies, and
// undersized results do not (they are permanent).
var errTransient = errors.New("transient download error")

func transient(err error) error {
	return fmt.Errorf("%w: %w", errTransient, err)
}

func isTransient(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errTransient) {
		return true
	}
	// Defensive: catch reset/EOF strings that may surface without the wrapper.
	s := err.Error()
	return strings.Contains(s, "connection reset") ||
		strings.Contains(s, "unexpected EOF") ||
		strings.Contains(s, "EOF")
}

// FetchToFile downloads url to dest atomically (temp file + rename), skipping
// the work when dest already exists at >= MinSize. It retries transient
// failures (network errors, HTTP 5xx, connection reset / EOF mid-stream) with
// exponential backoff capped at 30s, and is ctx-aware: ctx cancellation aborts
// both the in-flight request and the backoff sleep. 4xx, an HTML body (when
// RejectHTML), and an undersized result are permanent (no retry).
func FetchToFile(ctx context.Context, url, dest string, opts Options) error {
	if opts.Timeout <= 0 {
		opts.Timeout = 30 * time.Minute
	}
	if opts.MaxAttempts <= 0 {
		opts.MaxAttempts = 6
	}
	label := opts.Label
	if label == "" {
		label = filepath.Base(dest)
	}

	// Pre-stat: a present, big-enough, correct-hash file means we're done.
	if info, err := os.Stat(dest); err == nil {
		switch {
		case opts.MinSize > 0 && info.Size() < opts.MinSize:
			log.Printf("modelfetch: existing file %s too small (%d bytes), re-downloading", dest, info.Size())
		case opts.SHA256 != "":
			got, herr := fileSHA256(dest)
			if herr != nil {
				log.Printf("modelfetch: existing file %s could not be hashed (%v), re-downloading", dest, herr)
			} else if got == opts.SHA256 {
				return nil
			} else {
				log.Printf("modelfetch: existing file %s hash mismatch (have %s, want %s), re-downloading", dest, got, opts.SHA256)
			}
		default:
			return nil
		}
	}

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", filepath.Dir(dest), err)
	}

	var lastErr error
	for attempt := 1; attempt <= opts.MaxAttempts; attempt++ {
		log.Printf("modelfetch: downloading %s → %s (attempt %d/%d)", url, dest, attempt, opts.MaxAttempts)
		err := doDownload(ctx, url, dest, label, opts)
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
		log.Printf("modelfetch: transient error (%v), retrying in %s", err, backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}
	return fmt.Errorf("download failed after %d attempts: %w", opts.MaxAttempts, lastErr)
}

func doDownload(ctx context.Context, url, dest, label string, opts Options) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: opts.Timeout}
	resp, err := client.Do(req)
	if err != nil {
		return transient(fmt.Errorf("HTTP request failed: %w", err))
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return transient(fmt.Errorf("http %d downloading %s", resp.StatusCode, url))
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("http %d downloading %s", resp.StatusCode, url)
	}

	if opts.RejectHTML {
		ct := resp.Header.Get("Content-Type")
		if strings.Contains(ct, "text/html") {
			return fmt.Errorf("got HTML response (LFS pointer?) for %s", url)
		}
	}

	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}

	var src io.Reader = resp.Body
	if opts.LogProgress {
		src = &progressReader{r: resp.Body, total: resp.ContentLength, label: label}
	}
	written, copyErr := io.Copy(f, src)
	closeErr := f.Close()
	if copyErr != nil {
		os.Remove(tmp)
		return transient(copyErr)
	}
	if closeErr != nil {
		os.Remove(tmp)
		return closeErr
	}

	if opts.LogProgress {
		log.Printf("modelfetch: download complete: %s (%d bytes)", label, written)
	}

	if opts.MinSize > 0 && written < opts.MinSize {
		os.Remove(tmp)
		return fmt.Errorf("downloaded file too small (%d bytes)", written)
	}

	if opts.SHA256 != "" {
		got, err := fileSHA256(tmp)
		if err != nil {
			os.Remove(tmp)
			return fmt.Errorf("failed to hash downloaded file: %w", err)
		}
		if got != opts.SHA256 {
			os.Remove(tmp)
			return fmt.Errorf("downloaded %s hash mismatch (have %s, want %s)", label, got, opts.SHA256)
		}
	}

	return os.Rename(tmp, dest)
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
