package objectdetection

import (
	"log"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var (
	ortInitOnce sync.Once
	ortInitErr  error
)

// initONNXRuntime initializes the ONNX Runtime library once.
// This is safe to call multiple times and from multiple goroutines.
// If facedetection already initialized it, this is a no-op internally.
func initONNXRuntime() error {
	ortInitOnce.Do(func() {
		ortInitErr = ort.InitializeEnvironment()
		if ortInitErr != nil {
			log.Printf("Failed to initialize ONNX Runtime: %v", ortInitErr)
		}
	})
	return ortInitErr
}
