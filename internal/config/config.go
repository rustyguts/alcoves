package config

import (
	"log"
	"os"
	"path/filepath"
)

type Config struct {
	DatabaseURL             string
	GoogleAuthEnabled       bool
	GoogleOauthClientID     string
	GoogleOauthClientSecret string
	ServiceName             string
	ServiceVersion          string
	Environment             string
	CollectorURL            string
	SamplingRatio           float64
}

const (
	SessionCookieName = "session"
)

var DATA_STORAGE_PATH = filepath.Join(".", "data")
var ASSETS_PATH = filepath.Join(DATA_STORAGE_PATH, "assets")
var ASSETS_CACHE_PATH = filepath.Join(DATA_STORAGE_PATH, "cache")

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func InitializeConfig() *Config {
	DatabaseURL := os.Getenv("DATABASE_URL")
	if DatabaseURL == "" {
		log.Println("DATABASE_URL environment variable is not set")
	}

	GoogleOauthClientID := os.Getenv("GOOGLE_OAUTH_CLIENT_ID")
	if GoogleOauthClientID == "" {
		log.Println("GOOGLE_OAUTH_CLIENT_ID environment variable is not set")
	}

	GoogleOauthClientSecret := os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET")
	if GoogleOauthClientSecret == "" {
		log.Println("GOOGLE_OAUTH_CLIENT_SECRET environment variable is not set")
	}

	GoogleAuthEnabled := GoogleOauthClientID != "" && GoogleOauthClientSecret != ""

	dirs := []string{
		ASSETS_PATH,
		ASSETS_CACHE_PATH,
	}

	for _, dir := range dirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			err := os.MkdirAll(dir, os.ModePerm)
			if err != nil {
				log.Fatalf("Failed to create directory %s: %v", dir, err)
			}
		}
	}

	return &Config{
		DatabaseURL:             DatabaseURL,
		GoogleAuthEnabled:       GoogleAuthEnabled,
		GoogleOauthClientID:     GoogleOauthClientID,
		GoogleOauthClientSecret: GoogleOauthClientSecret,
		ServiceName:             getEnvOrDefault("OTEL_SERVICE_NAME", "alcoves"),
		ServiceVersion:          getEnvOrDefault("OTEL_SERVICE_VERSION", "0.0.1"),
		Environment:             getEnvOrDefault("ENVIRONMENT", "development"),
		CollectorURL:            getEnvOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4317"),
		SamplingRatio:           1.0, // Always sample for now
	}
}
