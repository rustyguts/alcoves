package facedetection

// FaceConfig holds tuning parameters for face detection and recognition.
// Computed thresholds are derived from the base config values.
type FaceConfig struct {
	// Detection minimum confidence score (0.05–0.99)
	MinScore float64
	// Maximum cosine distance for a face match (0.2–0.8)
	MaxDistance float64
	// Number of nearest-neighbor candidates during assignment
	NeighborLookup int
	// Minimum faces before creating a new person cluster
	MinFaces int
	// Path to ONNX model files
	ModelsPath string

	// Computed thresholds
	MatchCandidateDistance float64 // MaxDistance * 1.5 — looser threshold for candidate search
	AutoMergeDistance      float64 // MaxDistance * 0.85 — stricter threshold for auto-merge
	AutoMergeMinEvidence   int     // MinFaces — evidence count for auto-merge
}

// NewFaceConfig creates a FaceConfig with computed thresholds from base values.
func NewFaceConfig(minScore, maxDistance float64, neighborLookup, minFaces int, modelsPath string) *FaceConfig {
	return &FaceConfig{
		MinScore:       minScore,
		MaxDistance:     maxDistance,
		NeighborLookup: neighborLookup,
		MinFaces:       minFaces,
		ModelsPath:     modelsPath,

		MatchCandidateDistance: maxDistance * 1.5,
		AutoMergeDistance:      maxDistance * 0.85,
		AutoMergeMinEvidence:   minFaces,
	}
}
