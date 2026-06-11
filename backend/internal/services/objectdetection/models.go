package objectdetection

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/alcoves/alcoves-backend/internal/services/modelfetch"
	"github.com/alcoves/alcoves-backend/internal/services/onnxinit"
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
	return modelfetch.FetchToFile(context.Background(), objectModelURL, dest, modelfetch.Options{
		MinSize:     minModelSize,
		RejectHTML:  true,
		LogProgress: true,
	})
}

// LoadDetectionSession creates an ONNX Runtime session for the YOLO26x model.
// YOLO26x has input "pixel_values" and two outputs: "logits" [1,300,80] and "pred_boxes" [1,300,4].
// Downloads the model on first use if not already present.
func LoadDetectionSession(modelsPath string) (*ort.DynamicAdvancedSession, error) {
	if err := EnsureModelsDownloaded(modelsPath); err != nil {
		return nil, fmt.Errorf("failed to ensure object detection model: %w", err)
	}

	if err := onnxinit.Ensure(); err != nil {
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
