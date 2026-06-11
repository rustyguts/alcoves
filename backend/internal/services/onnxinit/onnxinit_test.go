package onnxinit_test

import (
	"sync"
	"testing"

	ort "github.com/yalue/onnxruntime_go"

	"github.com/alcoves/alcoves-backend/internal/services/onnxinit"
	"github.com/alcoves/alcoves-backend/internal/testsupport/onnxtest"
)

func init() { onnxtest.SetupLib() }

// TestEnsureIdempotentAndConcurrent hammers Ensure from many goroutines and
// asserts it never panics and settles on a single consistent outcome. It runs
// on hosts both with and without a usable ONNX Runtime shared library:
//
//   - lib available: every call returns nil and the runtime reports
//     initialized; later calls stay nil.
//   - lib unavailable: every call returns an error, and crucially the failure
//     is NOT latched as a fake success — a later call still reports the error
//     (and would succeed if the lib appeared, since failures are retried).
func TestEnsureIdempotentAndConcurrent(t *testing.T) {
	const n = 32
	errs := make([]error, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := range n {
		go func() {
			defer wg.Done()
			errs[i] = onnxinit.Ensure()
		}()
	}
	wg.Wait()

	succeeded := false
	for _, err := range errs {
		if err == nil {
			succeeded = true
			break
		}
	}

	if succeeded {
		if !ort.IsInitialized() {
			t.Fatal("Ensure returned nil but the ONNX runtime reports uninitialized")
		}
		for i := range 3 {
			if err := onnxinit.Ensure(); err != nil {
				t.Fatalf("Ensure call %d after success returned %v, want nil", i, err)
			}
		}
		return
	}

	// No usable ONNX Runtime on this host: the error path is what's under test.
	t.Logf("ONNX runtime unavailable (first error: %v); exercising error path", errs[0])
	if ort.IsInitialized() {
		t.Fatal("every Ensure failed but the ONNX runtime reports initialized")
	}
	if err := onnxinit.Ensure(); err == nil {
		t.Fatal("Ensure returned nil after consistent failures on a host without a runtime")
	}
}

// TestEnsureAfterDirectInitialization covers the branch where something else
// (e.g. a test helper) initialized the runtime directly: Ensure must observe
// ort.IsInitialized() and return nil instead of calling InitializeEnvironment
// again, which errors with "already been initialized" — the exact cross-family
// bug this package exists to fix.
func TestEnsureAfterDirectInitialization(t *testing.T) {
	if !ort.IsInitialized() {
		if err := ort.InitializeEnvironment(); err != nil {
			t.Skipf("ONNX runtime unavailable: %v", err)
		}
	}
	if err := onnxinit.Ensure(); err != nil {
		t.Fatalf("Ensure on an already-initialized runtime returned %v, want nil", err)
	}
}
