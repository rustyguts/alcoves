package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port        int
	DatabaseURL string
	Mode        string // "all", "api", "worker"
	Environment string // "development" or "production"

	SessionSecret string // At least 32 bytes for AES-256

	StoragePath       string
	AvatarStoragePath string
	CacheStoragePath  string

	StorageDriver string // "local" or "s3"

	// S3 config (future)
	S3Bucket          string
	S3Region          string
	S3Endpoint        string
	S3AccessKeyID     string
	S3SecretAccessKey string
	S3ForcePathStyle  bool
	S3FilesPrefix     string
	S3AvatarsPrefix   string
	S3CachePrefix     string

	// Redis/Queue
	QueueRedisHost     string
	QueueRedisPort     int
	QueueRedisPassword string

	// OAuth
	OAuthGoogleClientID     string
	OAuthGoogleClientSecret string
	GoogleAuthEnabled       bool

	// Base URL for OAuth callbacks
	BaseURL string

	// Face detection / recognition tuning
	FaceDetectionMinScore         float64
	FaceRecognitionMaxDistance    float64
	FaceRecognitionNeighborLookup int
	FaceRecognitionMinFaces       int
	ModelsPath                    string

	// Object detection tuning
	ObjectDetectionMinScore  float64
	ObjectDetectionMaxDets   int
	ObjectDetectionNMSThresh float64

	// Transcription (whisper.cpp)
	WhisperBinaryPath   string
	WhisperModel        string
	WhisperVADModel     string
	WhisperModelsDir    string
	WhisperModelBaseURL string
	WhisperLanguage     string
	FFmpegBinaryPath    string

	// Audio event detection (AudioSet 527 via ONNX Runtime). The active
	// model is admin-selectable from a small registry — see
	// backend/internal/services/audiodetection/registry.go. Each entry's
	// ModelFile is appended to AudioDetectModelBaseURL to construct the
	// download URL.
	AudioDetectModelBaseURL string
	AudioDetectLabelsURL    string
	AudioDetectWindowSec    float64
	AudioDetectThreshold    float64
	AudioDetectTopK         int
}

func Load() (*Config, error) {
	port, _ := strconv.Atoi(getEnv("PORT", "3000"))
	queuePort, _ := strconv.Atoi(getEnv("ALCOVES_QUEUE_PORT", "6389"))

	faceMinScore, _ := strconv.ParseFloat(getEnv("ALCOVES_FACE_DETECTION_MIN_SCORE", "0.5"), 64)
	faceMaxDist, _ := strconv.ParseFloat(getEnv("ALCOVES_FACE_RECOGNITION_MAX_DISTANCE", "0.6"), 64)
	faceNeighborLookup, _ := strconv.Atoi(getEnv("ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP", "80"))
	faceMinFaces, _ := strconv.Atoi(getEnv("ALCOVES_FACE_RECOGNITION_MIN_FACES", "2"))

	objMinScore, _ := strconv.ParseFloat(getEnv("ALCOVES_OBJECT_DETECTION_MIN_SCORE", "0.25"), 64)
	objMaxDets, _ := strconv.Atoi(getEnv("ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS", "100"))
	objNMSThresh, _ := strconv.ParseFloat(getEnv("ALCOVES_OBJECT_DETECTION_NMS_THRESHOLD", "0.45"), 64)

	dataDir := getEnv("ALCOVES_STORAGE_PATH", "./data")
	storagePath := filepath.Join(dataDir, "files")
	avatarPath := getEnv("ALCOVES_AVATAR_STORAGE_PATH", filepath.Join(dataDir, "avatars"))
	cachePath := getEnv("ALCOVES_CACHE_STORAGE_PATH", filepath.Join(dataDir, ".cache"))

	sessionSecret := getEnv("ALCOVES_SESSION_SECRET", "")
	if sessionSecret == "" {
		return nil, fmt.Errorf("ALCOVES_SESSION_SECRET is required (at least 32 characters)")
	}

	googleClientID := getEnv("ALCOVES_OAUTH_GOOGLE_CLIENT_ID", "")

	cfg := &Config{
		Port:        port,
		DatabaseURL: getEnv("ALCOVES_DATABASE_URL", "postgres://postgres:postgres@localhost:5455/alcoves"),
		Mode:        getEnv("ALCOVES_MODE", "all"),
		Environment: getEnv("ALCOVES_ENV", "development"),

		SessionSecret: sessionSecret,

		StoragePath:       storagePath,
		AvatarStoragePath: avatarPath,
		CacheStoragePath:  cachePath,
		StorageDriver:     getEnv("ALCOVES_STORAGE_DRIVER", "local"),

		S3Bucket:          getEnv("ALCOVES_S3_BUCKET", ""),
		S3Region:          getEnv("ALCOVES_S3_REGION", ""),
		S3Endpoint:        getEnv("ALCOVES_S3_ENDPOINT", ""),
		S3AccessKeyID:     getEnv("ALCOVES_S3_ACCESS_KEY_ID", ""),
		S3SecretAccessKey: getEnv("ALCOVES_S3_SECRET_ACCESS_KEY", ""),
		S3ForcePathStyle:  getEnv("ALCOVES_S3_FORCE_PATH_STYLE", "") == "true",
		S3FilesPrefix:     getEnv("ALCOVES_S3_FILES_PREFIX", ""),
		S3AvatarsPrefix:   getEnv("ALCOVES_S3_AVATARS_PREFIX", ""),
		S3CachePrefix:     getEnv("ALCOVES_S3_CACHE_PREFIX", ""),

		QueueRedisHost:     getEnv("ALCOVES_QUEUE_HOST", "localhost"),
		QueueRedisPort:     queuePort,
		QueueRedisPassword: getEnv("ALCOVES_QUEUE_PASSWORD", ""),

		OAuthGoogleClientID:     googleClientID,
		OAuthGoogleClientSecret: getEnv("ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET", ""),
		GoogleAuthEnabled:       googleClientID != "",

		BaseURL: getEnv("ALCOVES_BASE_URL", "http://localhost:5173"),

		FaceDetectionMinScore:         faceMinScore,
		FaceRecognitionMaxDistance:    faceMaxDist,
		FaceRecognitionNeighborLookup: faceNeighborLookup,
		FaceRecognitionMinFaces:       faceMinFaces,
		ModelsPath:                    getEnv("ALCOVES_MODELS_PATH", filepath.Join(dataDir, ".models")),

		ObjectDetectionMinScore:  objMinScore,
		ObjectDetectionMaxDets:   objMaxDets,
		ObjectDetectionNMSThresh: objNMSThresh,

		WhisperBinaryPath: getEnv("ALCOVES_WHISPER_BINARY", "whisper-cli"),
		WhisperModel:      getEnv("ALCOVES_WHISPER_MODEL", "large-v3"),
		// Silero VAD model used to drop non-speech regions before decoding.
		// Empty string disables VAD. The default is the Silero v6.2 ggml
		// build that ships at https://huggingface.co/ggml-org/whisper-vad,
		// mirrored at $ALCOVES_WHISPER_MODEL_BASE_URL. Without VAD, whisper
		// hallucinates repetition loops on long non-speech regions
		// (gameplay/music/silence) — see docs/models.md.
		WhisperVADModel:     getEnv("ALCOVES_WHISPER_VAD_MODEL", "silero-v6.2.0"),
		WhisperModelsDir:    getEnv("ALCOVES_WHISPER_MODELS_DIR", filepath.Join(dataDir, ".whisper")),
		WhisperModelBaseURL: getEnv("ALCOVES_WHISPER_MODEL_BASE_URL", "https://s3.rustyguts.net/models"),
		WhisperLanguage:     getEnv("ALCOVES_WHISPER_LANGUAGE", "auto"),
		FFmpegBinaryPath:    getEnv("ALCOVES_FFMPEG_BINARY", "ffmpeg"),

		AudioDetectModelBaseURL: getEnv("ALCOVES_AUDIO_DETECT_MODEL_BASE_URL", "https://s3.rustyguts.net/models"),
		AudioDetectLabelsURL:    getEnv("ALCOVES_AUDIO_DETECT_LABELS_URL", "https://s3.rustyguts.net/models/audioset_class_labels_indices.csv"),
		AudioDetectWindowSec:    parseFloatEnv("ALCOVES_AUDIO_DETECT_WINDOW_SEC", 10.0),
		AudioDetectThreshold:    parseFloatEnv("ALCOVES_AUDIO_DETECT_THRESHOLD", 0.2),
		AudioDetectTopK:         parseIntEnv("ALCOVES_AUDIO_DETECT_TOP_K", 5),
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseFloatEnv(key string, fallback float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(key), 64); err == nil {
		return v
	}
	return fallback
}

func parseIntEnv(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}
