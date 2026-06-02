package config

import (
	"os"
	"testing"
)

func TestGetEnv(t *testing.T) {
	// Test with existing env var
	os.Setenv("TEST_VAR", "test-value")
	defer os.Unsetenv("TEST_VAR")

	result := getEnv("TEST_VAR", "fallback")
	if result != "test-value" {
		t.Errorf("Expected 'test-value', got '%s'", result)
	}

	// Test with fallback
	result = getEnv("NON_EXISTENT_VAR", "fallback")
	if result != "fallback" {
		t.Errorf("Expected 'fallback', got '%s'", result)
	}

	// Test with empty string env var (should use fallback)
	os.Setenv("EMPTY_VAR", "")
	defer os.Unsetenv("EMPTY_VAR")
	result = getEnv("EMPTY_VAR", "fallback")
	if result != "fallback" {
		t.Errorf("Expected 'fallback' for empty env var, got '%s'", result)
	}
}

func TestLoadConfigRequiresSessionSecret(t *testing.T) {
	// Save current env vars
	originalSecret := os.Getenv("ALCOVES_SESSION_SECRET")
	defer func() {
		if originalSecret != "" {
			os.Setenv("ALCOVES_SESSION_SECRET", originalSecret)
		}
	}()

	// Unset session secret
	os.Unsetenv("ALCOVES_SESSION_SECRET")

	_, err := Load()
	if err == nil {
		t.Error("Expected error when ALCOVES_SESSION_SECRET is not set")
	}
}

func TestLoadConfigSuccess(t *testing.T) {
	// Set required env vars
	os.Setenv("ALCOVES_SESSION_SECRET", "this-is-a-test-secret-at-least-32-chars-long")
	defer os.Unsetenv("ALCOVES_SESSION_SECRET")

	// Set optional env vars
	os.Setenv("PORT", "8080")
	os.Setenv("ALCOVES_ENV", "production")
	os.Setenv("ALCOVES_MODE", "api")
	os.Setenv("ALCOVES_DATABASE_URL", "postgres://test:test@localhost/test")
	os.Setenv("ALCOVES_STORAGE_PATH", "/tmp/test-storage")
	os.Setenv("ALCOVES_STORAGE_DRIVER", "s3")
	os.Setenv("ALCOVES_S3_BUCKET", "test-bucket")
	os.Setenv("ALCOVES_S3_REGION", "us-west-2")
	os.Setenv("ALCOVES_S3_FORCE_PATH_STYLE", "true")
	os.Setenv("ALCOVES_QUEUE_HOST", "redis-host")
	os.Setenv("ALCOVES_QUEUE_PORT", "6379")
	os.Setenv("ALCOVES_OAUTH_GOOGLE_CLIENT_ID", "test-client-id")
	os.Setenv("ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET", "test-client-secret")
	os.Setenv("ALCOVES_BASE_URL", "https://example.com")

	defer func() {
		os.Unsetenv("PORT")
		os.Unsetenv("ALCOVES_ENV")
		os.Unsetenv("ALCOVES_MODE")
		os.Unsetenv("ALCOVES_DATABASE_URL")
		os.Unsetenv("ALCOVES_STORAGE_PATH")
		os.Unsetenv("ALCOVES_STORAGE_DRIVER")
		os.Unsetenv("ALCOVES_S3_BUCKET")
		os.Unsetenv("ALCOVES_S3_REGION")
		os.Unsetenv("ALCOVES_S3_FORCE_PATH_STYLE")
		os.Unsetenv("ALCOVES_QUEUE_HOST")
		os.Unsetenv("ALCOVES_QUEUE_PORT")
		os.Unsetenv("ALCOVES_OAUTH_GOOGLE_CLIENT_ID")
		os.Unsetenv("ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET")
		os.Unsetenv("ALCOVES_BASE_URL")
	}()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if cfg.Port != 8080 {
		t.Errorf("Expected Port 8080, got %d", cfg.Port)
	}
	if cfg.Environment != "production" {
		t.Errorf("Expected Environment 'production', got '%s'", cfg.Environment)
	}
	if cfg.Mode != "api" {
		t.Errorf("Expected Mode 'api', got '%s'", cfg.Mode)
	}
	if cfg.DatabaseURL != "postgres://test:test@localhost/test" {
		t.Errorf("Expected custom DatabaseURL, got '%s'", cfg.DatabaseURL)
	}
	if cfg.StorageDriver != "s3" {
		t.Errorf("Expected StorageDriver 's3', got '%s'", cfg.StorageDriver)
	}
	if cfg.S3Bucket != "test-bucket" {
		t.Errorf("Expected S3Bucket 'test-bucket', got '%s'", cfg.S3Bucket)
	}
	if cfg.S3Region != "us-west-2" {
		t.Errorf("Expected S3Region 'us-west-2', got '%s'", cfg.S3Region)
	}
	if !cfg.S3ForcePathStyle {
		t.Error("Expected S3ForcePathStyle to be true")
	}
	if cfg.QueueRedisHost != "redis-host" {
		t.Errorf("Expected QueueRedisHost 'redis-host', got '%s'", cfg.QueueRedisHost)
	}
	if cfg.QueueRedisPort != 6379 {
		t.Errorf("Expected QueueRedisPort 6379, got %d", cfg.QueueRedisPort)
	}
	if cfg.OAuthGoogleClientID != "test-client-id" {
		t.Errorf("Expected OAuthGoogleClientID 'test-client-id', got '%s'", cfg.OAuthGoogleClientID)
	}
	if cfg.OAuthGoogleClientSecret != "test-client-secret" {
		t.Errorf("Expected OAuthGoogleClientSecret 'test-client-secret', got '%s'", cfg.OAuthGoogleClientSecret)
	}
	if !cfg.GoogleAuthEnabled {
		t.Error("Expected GoogleAuthEnabled to be true when client ID is set")
	}
	if cfg.BaseURL != "https://example.com" {
		t.Errorf("Expected BaseURL 'https://example.com', got '%s'", cfg.BaseURL)
	}
}

func TestParseCommaList(t *testing.T) {
	cases := []struct {
		input string
		want  []string
	}{
		{"", nil},
		{"  ", nil},
		{"https://app.example.com", []string{"https://app.example.com"}},
		{"https://a.example.com,https://b.example.com", []string{"https://a.example.com", "https://b.example.com"}},
		{" https://a.example.com , https://b.example.com ", []string{"https://a.example.com", "https://b.example.com"}},
		{",,,", nil},
	}
	for _, tc := range cases {
		got := parseCommaList(tc.input)
		if len(got) != len(tc.want) {
			t.Errorf("parseCommaList(%q) = %v, want %v", tc.input, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("parseCommaList(%q)[%d] = %q, want %q", tc.input, i, got[i], tc.want[i])
			}
		}
	}
}

func TestLoad_ExtraCORSOrigins(t *testing.T) {
	os.Setenv("ALCOVES_SESSION_SECRET", "this-is-a-test-secret-at-least-32-chars-long")
	defer os.Unsetenv("ALCOVES_SESSION_SECRET")

	os.Setenv("ALCOVES_EXTRA_CORS_ORIGINS", "https://cdn.example.com, https://app2.example.com")
	defer os.Unsetenv("ALCOVES_EXTRA_CORS_ORIGINS")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.ExtraCORSOrigins) != 2 {
		t.Fatalf("expected 2 ExtraCORSOrigins, got %d: %v", len(cfg.ExtraCORSOrigins), cfg.ExtraCORSOrigins)
	}
	if cfg.ExtraCORSOrigins[0] != "https://cdn.example.com" {
		t.Errorf("ExtraCORSOrigins[0] = %q", cfg.ExtraCORSOrigins[0])
	}
	if cfg.ExtraCORSOrigins[1] != "https://app2.example.com" {
		t.Errorf("ExtraCORSOrigins[1] = %q", cfg.ExtraCORSOrigins[1])
	}
}

func TestLoad_ExtraCORSOriginsEmpty(t *testing.T) {
	os.Setenv("ALCOVES_SESSION_SECRET", "this-is-a-test-secret-at-least-32-chars-long")
	defer os.Unsetenv("ALCOVES_SESSION_SECRET")
	os.Unsetenv("ALCOVES_EXTRA_CORS_ORIGINS")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ExtraCORSOrigins != nil {
		t.Errorf("expected nil ExtraCORSOrigins, got %v", cfg.ExtraCORSOrigins)
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	// Set only required env var
	os.Setenv("ALCOVES_SESSION_SECRET", "this-is-a-test-secret-at-least-32-chars-long")
	defer os.Unsetenv("ALCOVES_SESSION_SECRET")

	// Clear any optional env vars
	os.Unsetenv("PORT")
	os.Unsetenv("ALCOVES_ENV")
	os.Unsetenv("ALCOVES_MODE")
	os.Unsetenv("ALCOVES_OAUTH_GOOGLE_CLIENT_ID")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check defaults
	if cfg.Port != 3000 {
		t.Errorf("Expected default Port 3000, got %d", cfg.Port)
	}
	if cfg.Environment != "development" {
		t.Errorf("Expected default Environment 'development', got '%s'", cfg.Environment)
	}
	if cfg.Mode != "all" {
		t.Errorf("Expected default Mode 'all', got '%s'", cfg.Mode)
	}
	if cfg.StorageDriver != "local" {
		t.Errorf("Expected default StorageDriver 'local', got '%s'", cfg.StorageDriver)
	}
	if cfg.GoogleAuthEnabled {
		t.Error("Expected GoogleAuthEnabled to be false when client ID is not set")
	}
	if cfg.BaseURL != "http://localhost:5173" {
		t.Errorf("Expected default BaseURL 'http://localhost:5173', got '%s'", cfg.BaseURL)
	}
}
