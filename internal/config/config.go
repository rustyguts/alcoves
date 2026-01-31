package config

import (
	"log/slog"
	"os"
	"path/filepath"
)

type Config struct {
	DatabaseURL             string
	GoogleAuthEnabled       bool
	GoogleOauthClientID     string
	GoogleOauthClientSecret string
	ServiceName             string
	Environment             string
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
	databaseURL := os.Getenv("ALCOVES_DATABASE_URL")
	if databaseURL == "" {
		slog.Warn("ALCOVES_DATABASE_URL environment variable is not set")
	}

	GoogleOauthClientID := os.Getenv("GOOGLE_OAUTH_CLIENT_ID")
	if GoogleOauthClientID == "" {
		slog.Warn("GOOGLE_OAUTH_CLIENT_ID environment variable is not set")
	}

	GoogleOauthClientSecret := os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET")
	if GoogleOauthClientSecret == "" {
		slog.Warn("GOOGLE_OAUTH_CLIENT_SECRET environment variable is not set")
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
				slog.Error("Failed to create directory", "dir", dir, "error", err)
				os.Exit(1)
			}
		}
	}

	return &Config{
		DatabaseURL:             databaseURL,
		GoogleAuthEnabled:       GoogleAuthEnabled,
		GoogleOauthClientID:     GoogleOauthClientID,
		GoogleOauthClientSecret: GoogleOauthClientSecret,
		ServiceName:             getEnvOrDefault("OTEL_SERVICE_NAME", "alcoves"),
		Environment:             getEnvOrDefault("ENVIRONMENT", "development"),
	}
}
