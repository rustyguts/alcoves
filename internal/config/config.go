package config

import (
	"log"
	"os"
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

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func Load() *Config {
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

const (
	SessionCookieName = "session"
)

var GlobalConfig = Load()
