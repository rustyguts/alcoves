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

	StoragePath      string
	AvatarStoragePath string
	CacheStoragePath  string

	StorageDriver string // "local" or "s3"

	// S3 config (future)
	S3Bucket         string
	S3Region         string
	S3Endpoint       string
	S3AccessKeyID    string
	S3SecretAccessKey string
	S3ForcePathStyle bool
	S3FilesPrefix    string
	S3AvatarsPrefix  string
	S3CachePrefix    string

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
}

func Load() (*Config, error) {
	port, _ := strconv.Atoi(getEnv("PORT", "3000"))
	queuePort, _ := strconv.Atoi(getEnv("ALCOVES_QUEUE_PORT", "6389"))

	dataDir := getEnv("ALCOVES_STORAGE_PATH", "./data")
	storagePath := filepath.Join(dataDir, "files")
	avatarPath := getEnv("ALCOVES_AVATAR_STORAGE_PATH", filepath.Join(dataDir, "avatars"))
	cachePath := getEnv("ALCOVES_CACHE_STORAGE_PATH", filepath.Join(dataDir, ".cache"))

	sessionSecret := getEnv("ALCOVES_SESSION_SECRET", "")
	if sessionSecret == "" {
		return nil, fmt.Errorf("ALCOVES_SESSION_SECRET is required (at least 32 characters)")
	}

	googleClientID := getEnv("NUXT_OAUTH_GOOGLE_CLIENT_ID", "")

	cfg := &Config{
		Port:        port,
		DatabaseURL: getEnv("ALCOVES_DATABASE_URL", "postgres://postgres:postgres@localhost:5455/alcoves"),
		Mode:        getEnv("ALCOVES_MODE", "all"),
		Environment: getEnv("ALCOVES_ENV", "development"),

		SessionSecret: sessionSecret,

		StoragePath:      storagePath,
		AvatarStoragePath: avatarPath,
		CacheStoragePath:  cachePath,
		StorageDriver:    getEnv("ALCOVES_STORAGE_DRIVER", "local"),

		S3Bucket:         getEnv("ALCOVES_S3_BUCKET", ""),
		S3Region:         getEnv("ALCOVES_S3_REGION", ""),
		S3Endpoint:       getEnv("ALCOVES_S3_ENDPOINT", ""),
		S3AccessKeyID:    getEnv("ALCOVES_S3_ACCESS_KEY_ID", ""),
		S3SecretAccessKey: getEnv("ALCOVES_S3_SECRET_ACCESS_KEY", ""),
		S3ForcePathStyle: getEnv("ALCOVES_S3_FORCE_PATH_STYLE", "") == "true",
		S3FilesPrefix:    getEnv("ALCOVES_S3_FILES_PREFIX", ""),
		S3AvatarsPrefix:  getEnv("ALCOVES_S3_AVATARS_PREFIX", ""),
		S3CachePrefix:    getEnv("ALCOVES_S3_CACHE_PREFIX", ""),

		QueueRedisHost:     getEnv("ALCOVES_QUEUE_HOST", "localhost"),
		QueueRedisPort:     queuePort,
		QueueRedisPassword: getEnv("ALCOVES_QUEUE_PASSWORD", ""),

		OAuthGoogleClientID:     googleClientID,
		OAuthGoogleClientSecret: getEnv("NUXT_OAUTH_GOOGLE_CLIENT_SECRET", ""),
		GoogleAuthEnabled:       googleClientID != "",

		BaseURL: getEnv("ALCOVES_BASE_URL", "http://localhost:3000"),
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
