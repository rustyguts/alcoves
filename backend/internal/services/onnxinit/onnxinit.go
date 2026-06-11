// Package onnxinit owns the single process-wide initialization of the ONNX
// Runtime environment (onnxruntime_go).
//
// The environment is process-global, and ort.InitializeEnvironment returns an
// error when it has already been initialized. Each ML family (facedetection,
// objectdetection, audiodetection) used to guard the call with its own
// package-level sync.Once, so in a process running more than one family
// (ALCOVES_MODE=all or worker) only the first family to initialize worked —
// the other two got "already initialized" and cached that error until
// restart. Every ONNX-backed service must call Ensure instead.
package onnxinit

import (
	"log"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var (
	mu          sync.Mutex
	initialized bool
)

// Ensure initializes the ONNX Runtime environment at most once per process.
// It is safe to call concurrently and from any package. If the environment is
// already initialized (by a previous Ensure, or directly by e.g. a test
// helper) it returns nil. A failed initialization is not cached: the next
// call retries, so a transient failure does not permanently disable inference
// until restart.
func Ensure() error {
	mu.Lock()
	defer mu.Unlock()
	if initialized {
		return nil
	}
	if ort.IsInitialized() {
		initialized = true
		return nil
	}
	if err := ort.InitializeEnvironment(); err != nil {
		log.Printf("Failed to initialize ONNX Runtime: %v", err)
		return err
	}
	initialized = true
	return nil
}
