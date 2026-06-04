package testsupport

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// This file provides shared fixtures + dependency-resolution helpers for the
// real-data ML/inference tests (face, object, audio, transcription, waveform).
// The committed fixtures live under internal/testsupport/testdata and are
// resolved relative to this source file, so they load correctly regardless of
// the test's working directory or whether it runs inside a git worktree.

// FixturesDir returns the absolute path to the shared ML fixtures directory.
func FixturesDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "testdata")
}

// Fixture returns the absolute path to a fixture (e.g. "images/dog.jpg"),
// failing the test if the file is missing.
func Fixture(t *testing.T, rel string) string {
	t.Helper()
	p := filepath.Join(FixturesDir(), filepath.FromSlash(rel))
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("missing fixture %q: %v", rel, err)
	}
	return p
}

// FixtureBytes reads a fixture's bytes, failing the test if it is missing.
func FixtureBytes(t *testing.T, rel string) []byte {
	t.Helper()
	b, err := os.ReadFile(Fixture(t, rel))
	if err != nil {
		t.Fatalf("read fixture %q: %v", rel, err)
	}
	return b
}

// FileExists reports whether p exists and is a regular file.
func FileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

// RepoRoot walks up from this source file to the backend module (the directory
// containing go.mod) and returns its parent — the repository root. Returns ""
// if not found. Used to locate developer-local, git-ignored caches such as
// data/.models, data/.whisper and data/.ort.
func RepoRoot() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}
	dir := filepath.Dir(file) // .../backend/internal/testsupport
	for range 8 {
		if FileExists(filepath.Join(dir, "go.mod")) {
			return filepath.Dir(dir) // parent of backend == repo root
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// ModelsCacheDir returns the directory ONNX model weights should be read from
// or downloaded to. $ALCOVES_MODELS_PATH (a pre-populated cache) wins; a
// developer-local data/.models is used next; otherwise a stable per-run temp
// directory is used so the (large) weights download at most once per runner
// rather than once per test.
func ModelsCacheDir() string {
	if p := os.Getenv("ALCOVES_MODELS_PATH"); p != "" {
		return p
	}
	if root := RepoRoot(); root != "" {
		if d := filepath.Join(root, "data", ".models"); dirExists(d) {
			return d
		}
	}
	return sharedCacheDir("alcoves-test-onnx-models")
}

// WhisperCacheDir resolves the whisper.cpp model directory the same way:
// $ALCOVES_WHISPER_MODELS_DIR, then a developer-local data/.whisper, then a
// stable per-run temp directory.
func WhisperCacheDir() string {
	if p := os.Getenv("ALCOVES_WHISPER_MODELS_DIR"); p != "" {
		return p
	}
	if root := RepoRoot(); root != "" {
		if d := filepath.Join(root, "data", ".whisper"); dirExists(d) {
			return d
		}
	}
	return sharedCacheDir("alcoves-test-whisper")
}

// sharedCacheDir returns a stable directory under the OS temp dir (shared
// across tests and packages on the same host) so model weights download once.
func sharedCacheDir(name string) string {
	d := filepath.Join(os.TempDir(), name)
	_ = os.MkdirAll(d, 0o755)
	return d
}

// FfmpegBin returns a usable ffmpeg path, or "" if none is found.
func FfmpegBin() string { return lookBinary("ffmpeg", "ALCOVES_FFMPEG_BINARY") }

// WhisperCliBin returns a usable whisper.cpp CLI path, or "" if none is found.
func WhisperCliBin() string { return lookBinary("whisper-cli", "ALCOVES_WHISPER_BINARY") }

func lookBinary(name, env string) string {
	if p := os.Getenv(env); p != "" {
		if _, err := exec.LookPath(p); err == nil {
			return p
		}
		if FileExists(p) {
			return p
		}
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, p := range []string{"/opt/homebrew/bin/" + name, "/usr/local/bin/" + name} {
		if FileExists(p) {
			return p
		}
	}
	return ""
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}
