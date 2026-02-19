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
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
