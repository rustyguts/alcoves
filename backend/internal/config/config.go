package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port        int
	DatabaseURL string
	Mode        string // "all", "api", "worker"
	Environment string // "development" or "production"

	// SeedEnabled turns on the dev/test database seeder (ALCOVES_SEED=true).
	// It only acts on an empty database, so real first-time setups — which
	// never set this flag — are untouched. Enabled in docker-compose for local
	// dev; left off everywhere else. See internal/seed.
	SeedEnabled bool

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

	// Base URL for OAuth callbacks and CORS origin derivation.
	BaseURL string

	// MCP server. MCPToken is the personal access token the stdio MCP process
	// authenticates as. MCPHTTPEnabled gates the /api/mcp HTTP transport.
	// MCPSigningSecret keys the signed curl upload/download URLs (falls back to
	// SessionSecret when unset).
	MCPHTTPEnabled   bool
	MCPSigningSecret string
	MCPToken         string

	// MCP OAuth 2.1 authorization server. When MCPOAuthEnabled is set, Alcoves
	// acts as an OAuth 2.1 Authorization Server + Resource Server for /api/mcp,
	// letting Claude's custom-connector dialog (and any spec-compliant remote
	// MCP client) authenticate via a browser consent flow instead of a pasted
	// PAT. The issuer is BaseURL; all endpoint URLs are derived from it.
	// Requires MCPHTTPEnabled. Off by default. See docs/internal/mcp-oauth21-plan.md.
	MCPOAuthEnabled              bool
	MCPOAuthAccessTTL            time.Duration
	MCPOAuthRefreshTTL           time.Duration
	MCPOAuthCodeTTL              time.Duration
	MCPOAuthDCREnabled           bool
	MCPOAuthAllowedRedirectHosts []string

	// ExtraCORSOrigins is an optional list of additional origins to allow in
	// the CORS policy. Parsed from ALCOVES_EXTRA_CORS_ORIGINS (comma-separated).
	// Use this when the Nuxt frontend is served from a different subdomain.
	ExtraCORSOrigins []string

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

	// ImageProxyPrewarmEnabled gates the hourly background job that generates
	// every image-proxy cache variant for each image (default on). Set
	// ALCOVES_IMAGE_PROXY_PREWARM_ENABLED=false to disable on constrained hosts
	// where on-demand transforms are preferred over eager cache warming.
	ImageProxyPrewarmEnabled bool

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

	// Sentry observability (optional — disabled when DSN is empty).
	SentryDSN              string
	SentryTracesSampleRate float64
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

	// Signed URLs reuse the session secret unless a dedicated key is provided.
	mcpSigningSecret := getEnv("ALCOVES_MCP_SIGNING_SECRET", "")
	if mcpSigningSecret == "" {
		mcpSigningSecret = sessionSecret
	}

	cfg := &Config{
		Port:        port,
		DatabaseURL: getEnv("ALCOVES_DATABASE_URL", "postgres://postgres:postgres@localhost:5455/alcoves"),
		Mode:        getEnv("ALCOVES_MODE", "all"),
		Environment: getEnv("ALCOVES_ENV", "development"),

		SeedEnabled: getEnv("ALCOVES_SEED", "") == "true",

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

		BaseURL:          getEnv("ALCOVES_BASE_URL", "http://localhost:3000"),
		ExtraCORSOrigins: parseCommaList(getEnv("ALCOVES_EXTRA_CORS_ORIGINS", "")),

		MCPHTTPEnabled:   getEnv("ALCOVES_MCP_HTTP_ENABLED", "") == "true",
		MCPSigningSecret: mcpSigningSecret,
		MCPToken:         getEnv("ALCOVES_MCP_TOKEN", ""),

		MCPOAuthEnabled:              getEnv("ALCOVES_MCP_OAUTH_ENABLED", "") == "true",
		MCPOAuthAccessTTL:            parseDurationEnv("ALCOVES_MCP_OAUTH_ACCESS_TTL", time.Hour),
		MCPOAuthRefreshTTL:           parseDurationEnv("ALCOVES_MCP_OAUTH_REFRESH_TTL", 30*24*time.Hour),
		MCPOAuthCodeTTL:              parseDurationEnv("ALCOVES_MCP_OAUTH_CODE_TTL", 5*time.Minute),
		MCPOAuthDCREnabled:           getEnv("ALCOVES_MCP_OAUTH_DCR_ENABLED", "true") != "false",
		MCPOAuthAllowedRedirectHosts: parseCommaList(getEnv("ALCOVES_MCP_OAUTH_ALLOWED_REDIRECT_HOSTS", "")),

		FaceDetectionMinScore:         faceMinScore,
		FaceRecognitionMaxDistance:    faceMaxDist,
		FaceRecognitionNeighborLookup: faceNeighborLookup,
		FaceRecognitionMinFaces:       faceMinFaces,
		ModelsPath:                    getEnv("ALCOVES_MODELS_PATH", filepath.Join(dataDir, ".models")),

		ObjectDetectionMinScore:  objMinScore,
		ObjectDetectionMaxDets:   objMaxDets,
		ObjectDetectionNMSThresh: objNMSThresh,

		// Default on; only an explicit "false" disables pre-warming.
		ImageProxyPrewarmEnabled: getEnv("ALCOVES_IMAGE_PROXY_PREWARM_ENABLED", "true") != "false",

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

		SentryDSN:              getEnv("ALCOVES_SENTRY_DSN", ""),
		SentryTracesSampleRate: parseFloatEnv("ALCOVES_SENTRY_TRACES_SAMPLE_RATE", 0.2),
	}

	// The MCP OAuth authorization server publishes discovery documents whose
	// issuer + endpoint URLs are all derived from BaseURL, and it has nothing to
	// protect without the MCP HTTP transport. Fail fast on a misconfiguration
	// rather than serving a self-inconsistent, half-broken OAuth surface.
	if cfg.MCPOAuthEnabled {
		if !cfg.MCPHTTPEnabled {
			return nil, fmt.Errorf("ALCOVES_MCP_OAUTH_ENABLED requires ALCOVES_MCP_HTTP_ENABLED=true (the OAuth resource server protects the MCP HTTP transport)")
		}
		if err := validateOAuthIssuer(cfg.BaseURL, cfg.Environment); err != nil {
			return nil, err
		}
	}

	return cfg, nil
}

// validateOAuthIssuer checks that BaseURL is a usable OAuth 2.1 issuer: an
// absolute URL with a host, no query/fragment, and https in production (it is
// advertised to remote clients and must match the origin they discover).
func validateOAuthIssuer(baseURL, environment string) error {
	u, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("ALCOVES_BASE_URL must be a valid URL when ALCOVES_MCP_OAUTH_ENABLED=true: %w", err)
	}
	if !u.IsAbs() || u.Host == "" {
		return fmt.Errorf("ALCOVES_BASE_URL must be an absolute URL with a host when OAuth is enabled (it is the OAuth issuer), got %q", baseURL)
	}
	if u.Fragment != "" || u.RawQuery != "" {
		return fmt.Errorf("ALCOVES_BASE_URL must not contain a query or fragment when OAuth is enabled, got %q", baseURL)
	}
	if environment == "production" && u.Scheme != "https" {
		return fmt.Errorf("ALCOVES_BASE_URL must use https in production (it is the public OAuth issuer), got %q", baseURL)
	}
	return nil
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

// parseDurationEnv parses a Go duration string (e.g. "1h", "30m", "720h") from
// the environment, falling back when unset, unparseable, or non-positive. A
// zero/negative TTL would mint born-expired codes and tokens, so it is rejected
// in favor of the (always positive) default.
func parseDurationEnv(key string, fallback time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return fallback
}

// parseCommaList splits a comma-separated string into a slice of trimmed,
// non-empty strings. Returns nil if the input is empty.
func parseCommaList(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
