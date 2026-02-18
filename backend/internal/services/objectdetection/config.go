package objectdetection

// ObjectConfig holds tuning parameters for object detection.
type ObjectConfig struct {
	// Minimum confidence score for keeping a detection (0.0–1.0)
	MinScore float64
	// Maximum number of detections to keep per image
	MaxDetections int
	// NMS IoU threshold
	NMSThreshold float64
	// Path to ONNX model files
	ModelsPath string
}

// NewObjectConfig creates an ObjectConfig with the given parameters.
func NewObjectConfig(minScore, nmsThreshold float64, maxDetections int, modelsPath string) *ObjectConfig {
	return &ObjectConfig{
		MinScore:      minScore,
		MaxDetections: maxDetections,
		NMSThreshold:  nmsThreshold,
		ModelsPath:    modelsPath,
	}
}
