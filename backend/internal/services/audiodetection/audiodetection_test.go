package audiodetection

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alcoves/alcoves-backend/internal/config"
)

// --- worker.go: needsSigmoid ---

func TestNeedsSigmoid(t *testing.T) {
	cases := []struct {
		name string
		in   []float32
		want bool
	}{
		{"all in range", []float32{0, 0.5, 1.0, 0.99}, false},
		{"slightly above one but within tolerance", []float32{1.005}, false},
		{"slightly below zero within tolerance", []float32{-0.005}, false},
		{"value above 1.01", []float32{2.0}, true},
		{"negative value below -0.01", []float32{-3.0}, true},
		{"empty", []float32{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := needsSigmoid(c.in); got != c.want {
				t.Errorf("needsSigmoid(%v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

// --- worker.go: topKAbove ---

func TestTopKAbove(t *testing.T) {
	probs := []float32{0.1, 0.9, 0.5, 0.05, 0.7}
	// threshold 0.4 keeps indices 1(0.9), 2(0.5), 4(0.7); top-2 -> [1,4]
	got := topKAbove(probs, 2, 0.4)
	if len(got) != 2 {
		t.Fatalf("expected 2 results, got %d (%v)", len(got), got)
	}
	if got[0] != 1 || got[1] != 4 {
		t.Errorf("topKAbove = %v, want [1 4]", got)
	}
}

func TestTopKAbove_NoCapWhenKZeroOrNegative(t *testing.T) {
	probs := []float32{0.9, 0.8, 0.7, 0.6}
	for _, k := range []int{0, -1} {
		got := topKAbove(probs, k, 0.5)
		if len(got) != 4 {
			t.Errorf("k=%d: expected all 4 above threshold, got %d", k, len(got))
		}
	}
}

func TestTopKAbove_AllBelowThreshold(t *testing.T) {
	probs := []float32{0.1, 0.2, 0.3}
	got := topKAbove(probs, 5, 0.9)
	if len(got) != 0 {
		t.Errorf("expected empty, got %v", got)
	}
}

func TestTopKAbove_SortedDescending(t *testing.T) {
	probs := []float32{0.5, 0.95, 0.6, 0.99, 0.55}
	got := topKAbove(probs, 10, 0.0)
	// Verify scores at returned indices are non-increasing.
	for i := 1; i < len(got); i++ {
		if probs[got[i-1]] < probs[got[i]] {
			t.Errorf("not sorted descending at %d: %v", i, got)
		}
	}
}

// --- worker.go: ptr ---

func TestPtr(t *testing.T) {
	p := ptr("hello")
	if p == nil || *p != "hello" {
		t.Fatalf("ptr returned %v", p)
	}
}

// --- worker.go: modelURL / activeSpec (no DB / no settings) ---

func TestModelURL_DefaultBaseWhenEmpty(t *testing.T) {
	h := &TaskHandler{cfg: &config.Config{AudioDetectModelBaseURL: ""}}
	spec := Registry["efficientat_mn10"]
	url := h.modelURL(spec)
	want := "https://s3.rustyguts.net/models/" + spec.ModelFile
	if url != want {
		t.Errorf("modelURL = %q, want %q", url, want)
	}
}

func TestModelURL_TrimsTrailingSlash(t *testing.T) {
	h := &TaskHandler{cfg: &config.Config{AudioDetectModelBaseURL: "https://example.com/models/"}}
	spec := Registry["ced_base"]
	url := h.modelURL(spec)
	want := "https://example.com/models/" + spec.ModelFile
	if url != want {
		t.Errorf("modelURL = %q, want %q", url, want)
	}
}

func TestActiveSpec_NilSettingsFallsBackToDefault(t *testing.T) {
	h := &TaskHandler{settingsSvc: nil}
	spec := h.activeSpec()
	if spec.ID != DefaultModelID {
		t.Errorf("activeSpec with nil settings = %q, want %q", spec.ID, DefaultModelID)
	}
}

// --- service.go: NewService / NewTaskHandler (constructors) ---

func TestNewService_Wired(t *testing.T) {
	cfg := &config.Config{}
	svc := NewService(nil, nil, nil, cfg, nil)
	if svc == nil {
		t.Fatal("nil service")
	}
	if svc.cfg != cfg {
		t.Error("cfg not wired")
	}
	h := svc.NewTaskHandler()
	if h == nil {
		t.Fatal("nil task handler")
	}
	if h.cfg != cfg {
		t.Error("handler cfg not wired")
	}
}

func TestNewTaskHandler_Wired(t *testing.T) {
	cfg := &config.Config{}
	h := NewTaskHandler(nil, nil, cfg, nil)
	if h == nil || h.cfg != cfg {
		t.Fatal("handler not wired")
	}
}

// --- models.go: transientErr / isTransient / errorAs ---

func TestTransientErr_ErrorAndUnwrap(t *testing.T) {
	inner := errors.New("boom")
	te := &transientErr{err: inner}
	if te.Error() != "boom" {
		t.Errorf("Error() = %q, want boom", te.Error())
	}
	if !errors.Is(te, inner) {
		t.Error("expected Unwrap to expose inner error")
	}
}

func TestIsTransient(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"explicit transientErr", &transientErr{err: errors.New("x")}, true},
		{"wrapped transientErr", fmt.Errorf("ctx: %w", &transientErr{err: errors.New("x")}), true},
		{"connection reset string", errors.New("read: connection reset by peer"), true},
		{"EOF string", errors.New("unexpected EOF"), true},
		{"plain other error", errors.New("404 not found"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isTransient(c.err); got != c.want {
				t.Errorf("isTransient(%v) = %v, want %v", c.err, got, c.want)
			}
		})
	}
}

func TestErrorAs(t *testing.T) {
	var target *transientErr
	te := &transientErr{err: errors.New("inner")}
	if !errorAs(fmt.Errorf("wrap: %w", te), &target) {
		t.Error("errorAs should find the wrapped transientErr")
	}
	target = nil
	if errorAs(errors.New("plain"), &target) {
		t.Error("errorAs should not match a plain error")
	}
}

// --- models.go: doDownload ---

func TestDoDownload_Success(t *testing.T) {
	body := []byte("model-bytes-here")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "model.onnx")
	if err := doDownload(dest, srv.URL); err != nil {
		t.Fatalf("doDownload: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read dest: %v", err)
	}
	if string(got) != string(body) {
		t.Errorf("dest contents = %q, want %q", got, body)
	}
}

func TestDoDownload_4xxNonTransient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	dir := t.TempDir()
	err := doDownload(filepath.Join(dir, "m.onnx"), srv.URL)
	if err == nil || !strings.Contains(err.Error(), "http 404") {
		t.Fatalf("expected http 404 error, got %v", err)
	}
	if isTransient(err) {
		t.Error("4xx must not be classified transient")
	}
}

func TestDoDownload_5xxTransient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	dir := t.TempDir()
	err := doDownload(filepath.Join(dir, "m.onnx"), srv.URL)
	if err == nil {
		t.Fatal("expected error for 502")
	}
	if !isTransient(err) {
		t.Errorf("5xx must be transient, got %v", err)
	}
}

func TestDoDownload_HTMLForNonCSVRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html></html>"))
	}))
	defer srv.Close()
	dir := t.TempDir()
	err := doDownload(filepath.Join(dir, "model.onnx"), srv.URL)
	if err == nil || !strings.Contains(err.Error(), "HTML") {
		t.Fatalf("expected HTML rejection, got %v", err)
	}
}

func TestDoDownload_HTMLAllowedForCSV(t *testing.T) {
	// A .csv dest with text/html content-type is allowed (some buckets serve
	// CSVs as text/html); the body is written verbatim.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("index,mid,display_name\n0,/m/1,Speech\n"))
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "labels.csv")
	if err := doDownload(dest, srv.URL); err != nil {
		t.Fatalf("csv with html content-type should be allowed: %v", err)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Errorf("csv not written: %v", err)
	}
}

func TestDoDownload_RequestErrorIsTransient(t *testing.T) {
	dir := t.TempDir()
	err := doDownload(filepath.Join(dir, "m.onnx"), "http://127.0.0.1:0/x")
	if err == nil {
		t.Fatal("expected request error")
	}
	if !isTransient(err) {
		t.Errorf("dial failure should be transient, got %v", err)
	}
}

// --- models.go: downloadIfMissing ---

func TestDownloadIfMissing_SkipsWhenLargeEnough(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "model.onnx")
	if err := os.WriteFile(dest, make([]byte, 2048), 0o644); err != nil {
		t.Fatal(err)
	}
	// minSize 1024 -> existing 2048 file is kept; bogus URL never hit.
	if err := downloadIfMissing(dest, "http://127.0.0.1:0/never", 1024); err != nil {
		t.Fatalf("expected skip, got %v", err)
	}
}

func TestDownloadIfMissing_DownloadsWhenMissing(t *testing.T) {
	body := make([]byte, 4096)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "model.onnx")
	if err := downloadIfMissing(dest, srv.URL, 1024); err != nil {
		t.Fatalf("downloadIfMissing: %v", err)
	}
	info, err := os.Stat(dest)
	if err != nil || info.Size() != int64(len(body)) {
		t.Fatalf("dest not downloaded correctly: %v size=%d", err, info.Size())
	}
}

func TestDownloadIfMissing_NonTransientStops(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "model.onnx")
	err := downloadIfMissing(dest, srv.URL, 1024)
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("expected 403 to stop retries immediately, got %v", err)
	}
}

func TestDownloadIfMissing_ReDownloadsTooSmallFile(t *testing.T) {
	body := make([]byte, 4096)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "model.onnx")
	// Pre-existing tiny file (below minSize) triggers a re-download.
	if err := os.WriteFile(dest, []byte("tiny"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := downloadIfMissing(dest, srv.URL, 1024); err != nil {
		t.Fatalf("downloadIfMissing re-download: %v", err)
	}
	info, _ := os.Stat(dest)
	if info.Size() != int64(len(body)) {
		t.Errorf("expected re-download to size %d, got %d", len(body), info.Size())
	}
}

// --- models.go: EnsureAssets ---

func TestEnsureAssets_DownloadsBoth(t *testing.T) {
	modelBody := make([]byte, minModelSize+10)
	labelsBody := []byte("index,mid,display_name\n0,/m/1,Speech\n1,/m/2,Music\n")
	modelSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(modelBody)
	}))
	defer modelSrv.Close()
	labelsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Big enough to clear the 1024 labels min size.
		w.Header().Set("Content-Type", "text/csv")
		_, _ = w.Write(append(labelsBody, make([]byte, 1100)...))
	}))
	defer labelsSrv.Close()

	dir := t.TempDir()
	modelPath, labelsPath, err := EnsureAssets(dir, "efficientat_mn10_as.onnx", modelSrv.URL, labelsSrv.URL)
	if err != nil {
		t.Fatalf("EnsureAssets: %v", err)
	}
	if filepath.Base(modelPath) != "efficientat_mn10_as.onnx" {
		t.Errorf("modelPath base = %q", filepath.Base(modelPath))
	}
	if filepath.Base(labelsPath) != labelsFile {
		t.Errorf("labelsPath base = %q, want %q", filepath.Base(labelsPath), labelsFile)
	}
	for _, p := range []string{modelPath, labelsPath} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("asset not present: %s (%v)", p, err)
		}
	}
}

func TestEnsureAssets_ModelDownloadError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	dir := t.TempDir()
	_, _, err := EnsureAssets(dir, "m.onnx", srv.URL, srv.URL)
	if err == nil || !strings.Contains(err.Error(), "download model") {
		t.Fatalf("expected model download error, got %v", err)
	}
}

// --- models.go: LoadLabels ---

func writeLabelsCSV(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "labels.csv")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadLabels_WithHeader(t *testing.T) {
	path := writeLabelsCSV(t, "index,mid,display_name\n0,/m/09x0r,Speech\n1,/m/05zppz,\"Male speech, man speaking\"\n")
	labels, err := LoadLabels(path)
	if err != nil {
		t.Fatalf("LoadLabels: %v", err)
	}
	if len(labels) != 2 {
		t.Fatalf("expected 2 labels, got %d (%v)", len(labels), labels)
	}
	if labels[0] != "Speech" {
		t.Errorf("labels[0] = %q, want Speech", labels[0])
	}
	if labels[1] != "Male speech, man speaking" {
		t.Errorf("labels[1] = %q", labels[1])
	}
}

func TestLoadLabels_NoHeader(t *testing.T) {
	path := writeLabelsCSV(t, "0,/m/09x0r,Speech\n1,/m/0k4j,Music\n")
	labels, err := LoadLabels(path)
	if err != nil {
		t.Fatalf("LoadLabels: %v", err)
	}
	if len(labels) != 2 || labels[1] != "Music" {
		t.Errorf("labels = %v", labels)
	}
}

func TestLoadLabels_SkipsShortRows(t *testing.T) {
	// Row with <3 columns is skipped; FieldsPerRecord=-1 allows ragged rows.
	path := writeLabelsCSV(t, "idx,mid,display_name\n0,/m/1,Speech\nbroken,row\n2,/m/3,Bark\n")
	labels, err := LoadLabels(path)
	if err != nil {
		t.Fatalf("LoadLabels: %v", err)
	}
	if len(labels) != 2 {
		t.Fatalf("expected 2 valid labels, got %d (%v)", len(labels), labels)
	}
	if labels[0] != "Speech" || labels[1] != "Bark" {
		t.Errorf("labels = %v", labels)
	}
}

func TestLoadLabels_EmptyFileErrors(t *testing.T) {
	path := writeLabelsCSV(t, "")
	if _, err := LoadLabels(path); err == nil {
		t.Fatal("expected error for empty labels file")
	}
}

func TestLoadLabels_OnlyHeaderErrors(t *testing.T) {
	path := writeLabelsCSV(t, "index,mid,display_name\n")
	if _, err := LoadLabels(path); err == nil {
		t.Fatal("expected error when only a header is present")
	}
}

func TestLoadLabels_MissingFileErrors(t *testing.T) {
	if _, err := LoadLabels("/nonexistent/path/labels.csv"); err == nil {
		t.Fatal("expected error for missing file")
	}
}

// --- worker.go: extractAudio (uses real ffmpeg if present) ---

func TestExtractAudio_NegativeSampleRateFallsBackAndErrorsOnBadInput(t *testing.T) {
	// A nonexistent input source makes ffmpeg fail; this exercises the error
	// branch and the sampleRate<=0 fallback without needing a valid media file.
	dir := t.TempDir()
	dst := filepath.Join(dir, "out.f32le")
	err := extractAudio(context.Background(), "ffmpeg", filepath.Join(dir, "missing.mp4"), dst, -1)
	if err == nil {
		t.Fatal("expected ffmpeg error for missing input")
	}
}

func TestExtractAudio_Success(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "src.wav")
	dst := filepath.Join(dir, "out.f32le")
	// Generate a 1-second silent mono WAV via ffmpeg's lavfi anullsrc.
	gen := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "anullsrc=r=32000:cl=mono", "-t", "1", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("could not generate test wav: %v (%s)", err, out)
	}
	if err := extractAudio(context.Background(), "ffmpeg", src, dst, 32000); err != nil {
		t.Fatalf("extractAudio: %v", err)
	}
	info, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("output not created: %v", err)
	}
	// 1 second @ 32kHz mono float32 = 32000*4 bytes (allow slack).
	if info.Size() == 0 || info.Size()%4 != 0 {
		t.Errorf("unexpected pcm size %d", info.Size())
	}
}

// --- registry.go: LookupSpec known-id branch (fills the remaining branch) ---

func TestLookupSpec_KnownIDHit(t *testing.T) {
	spec, ok := LookupSpec("ced_base")
	if !ok {
		t.Fatal("expected hit for known id")
	}
	if spec.ID != "ced_base" {
		t.Errorf("spec.ID = %q, want ced_base", spec.ID)
	}
}

// sanity: ensure float bit-identity helper used elsewhere is consistent.
func TestDecodePCMBytes_RoundTrip(t *testing.T) {
	vals := []float32{0.0, 0.5, -0.25, float32(math.Pi)}
	raw := make([]byte, len(vals)*4)
	for i, v := range vals {
		bits := math.Float32bits(v)
		raw[i*4] = byte(bits)
		raw[i*4+1] = byte(bits >> 8)
		raw[i*4+2] = byte(bits >> 16)
		raw[i*4+3] = byte(bits >> 24)
	}
	dst := make([]float32, len(vals))
	decodePCMBytes(raw, dst)
	for i := range vals {
		if dst[i] != vals[i] {
			t.Errorf("dst[%d] = %v, want %v", i, dst[i], vals[i])
		}
	}
}
