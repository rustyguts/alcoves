package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/database"
	"github.com/alcoves/alcoves-backend/internal/handlers"
	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/version"
	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/services/access"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/filehash"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/settings"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"

	"github.com/redis/go-redis/v9"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Database migrations — apply all pending SQL migrations (embedded in binary).
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("Failed to get underlying *sql.DB: %v", err)
	}
	if err := database.RunMigrations(sqlDB); err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}

	// Services
	authSvc, err := authservice.NewService(db, cfg.SessionSecret)
	if err != nil {
		log.Fatalf("Failed to initialize auth service: %v", err)
	}

	accessSvc := access.NewService(db)
	fileSvc := files.NewService(db)

	settingsSvc, err := settings.NewService(db)
	if err != nil {
		log.Fatalf("Failed to initialize settings service: %v", err)
	}

	storageDriver := storage.NewLocalDriver(cfg.StoragePath, cfg.AvatarStoragePath, cfg.CacheStoragePath)
	storageSvc := storage.NewService(storageDriver)
	if err := storageSvc.EnsureReady(); err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}

	// Asynq client (Redis-backed job queue)
	asynqRedisOpt := asynq.RedisClientOpt{
		Addr:     fmt.Sprintf("%s:%d", cfg.QueueRedisHost, cfg.QueueRedisPort),
		Password: cfg.QueueRedisPassword,
	}
	asynqClient := asynq.NewClient(asynqRedisOpt)
	defer asynqClient.Close()
	asynqInspector := asynq.NewInspector(asynqRedisOpt)
	defer asynqInspector.Close()

	// Activity service — drives the notification feed. Hub is constructed
	// only on API processes (workers publish but don't accept WS
	// connections); the bus is the cross-process Redis Pub/Sub bridge.
	notificationsRedis := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", cfg.QueueRedisHost, cfg.QueueRedisPort),
		Password: cfg.QueueRedisPassword,
	})
	defer notificationsRedis.Close()
	activityBus := activity.NewBus(notificationsRedis)
	var activityHub *activity.Hub
	if cfg.Mode != "worker" {
		activityHub = activity.NewHub()
	}
	activitySvc := activity.NewService(db, activityHub, activityBus)

	// Face detection service
	faceConfig := facedetection.NewFaceConfig(
		cfg.FaceDetectionMinScore,
		cfg.FaceRecognitionMaxDistance,
		cfg.FaceRecognitionNeighborLookup,
		cfg.FaceRecognitionMinFaces,
		cfg.ModelsPath,
	)
	faceSvc := facedetection.NewService(db, storageSvc, asynqClient, faceConfig)
	if cfg.Mode == "all" || cfg.Mode == "worker" {
		if err := faceSvc.EnsureModels(); err != nil {
			log.Printf("Face model download failed (face jobs may fail until models exist): %v", err)
		}
	}

	// Object detection service
	objConfig := objectdetection.NewObjectConfig(
		cfg.ObjectDetectionMinScore,
		cfg.ObjectDetectionNMSThresh,
		cfg.ObjectDetectionMaxDets,
		cfg.ModelsPath,
	)
	objSvc := objectdetection.NewService(db, storageSvc, asynqClient, objConfig)

	// Download ONNX models at startup (non-blocking — runs in background).
	// Models are also lazily downloaded on first worker use, but pre-fetching
	// avoids blocking task processing. Only needed on worker/all nodes.
	if cfg.Mode == "all" || cfg.Mode == "worker" {
		go func() {
			if err := faceSvc.EnsureModels(); err != nil {
				log.Printf("Warning: failed to pre-download face detection models: %v", err)
			}
			if err := objSvc.EnsureModels(); err != nil {
				log.Printf("Warning: failed to pre-download object detection model: %v", err)
			}
		}()
	}

	// Video proxy service
	videoSvc := videoproxy.NewService(db, storageSvc, asynqClient, activitySvc)

	// Transcribe service (ffmpeg + whisper.cpp). settingsSvc lets the
	// worker honor admin-edited whisper_model + whisper_language at task
	// start without a worker restart.
	transcribeSvc := transcribe.NewService(db, storageSvc, asynqClient, cfg, activitySvc, settingsSvc)

	// Audio event detection service (AudioSet 527-class via ONNX Runtime).
	// Active model is admin-selectable from audiodetection.Registry;
	// settingsSvc carries the choice into per-task lookups.
	audioDetectSvc := audiodetection.NewService(db, storageSvc, asynqClient, cfg, settingsSvc)

	// Waveform service (ffmpeg PCM extraction + peak windowing).
	waveformSvc := waveform.NewService(db, storageSvc, asynqClient, cfg, activitySvc)

	// Moment export service (clip encoder for /moments/:id/export).
	momentExportSvc := momentexport.NewService(db, storageSvc, asynqClient)

	// File hash service
	hashSvc := filehash.NewService(db, storageSvc, asynqClient)

	// Image proxy service — cache lookup, Redis pub/sub signaling, queued processing.
	imgSvc := imageproxy.NewService(storageSvc, asynqClient, asynqRedisOpt, imageproxy.NewVipsProcessor())

	// Start asynq worker if mode is "all" or "worker"
	var asynqServer *asynq.Server
	if cfg.Mode == "all" || cfg.Mode == "worker" {
		asynqServer = asynq.NewServer(asynqRedisOpt, asynq.Config{
			Concurrency: 8,
			// imageproxy gets highest priority so API handlers aren't kept waiting;
			// default queue handles face/object detection and video transcoding.
			Queues: map[string]int{
				imageproxy.ImageProxyQueue: 10,
				"default":                  1,
			},
		})

		mux := asynq.NewServeMux()
		mux.HandleFunc(imageproxy.TaskTypeImageProxy, imgSvc.NewTaskHandler().ProcessTask)
		mux.HandleFunc(facedetection.TaskTypeFaceDetect, faceSvc.NewTaskHandler().ProcessTask)
		mux.HandleFunc(objectdetection.TaskTypeObjectDetect, objSvc.NewTaskHandler().ProcessTask)
		videoTaskHandler := videoSvc.NewTaskHandler()
		mux.HandleFunc(videoproxy.TaskTypeVideoProxy, videoTaskHandler.ProcessTask)
		mux.HandleFunc(videoproxy.TaskTypeVideoThumb, videoTaskHandler.ProcessThumbnailTask)
		mux.HandleFunc(filehash.TaskTypeFileHash, hashSvc.NewTaskHandler().ProcessTask)
		mux.HandleFunc(momentexport.TaskTypeMomentExport, momentExportSvc.NewTaskHandler().ProcessTask)
		mux.HandleFunc(transcribe.TaskTypeTranscribe, transcribeSvc.NewTaskHandler().ProcessTask)
		mux.HandleFunc(audiodetection.TaskTypeAudioDetect, audioDetectSvc.NewTaskHandler().ProcessTask)
		mux.HandleFunc(waveform.TaskTypeWaveform, waveformSvc.NewTaskHandler().ProcessTask)

		go func() {
			log.Println("Starting asynq worker...")
			if err := asynqServer.Run(mux); err != nil {
				log.Printf("Asynq worker error: %v", err)
			}
		}()
	}

	// Echo setup
	e := echo.New()
	e.HideBanner = true
	e.Validator = handlers.NewValidator()

	// Build the CORS origin allowlist from BaseURL + any extra configured origins.
	// AllowCredentials=true requires an explicit origin allowlist; reflecting
	// every request origin would be a full session-hijack vector.
	corsAllowedOrigins := buildCORSOrigins(cfg.BaseURL, cfg.ExtraCORSOrigins, cfg.Environment)
	log.Printf("CORS allowed origins: %s", strings.Join(corsAllowedOrigins, ", "))

	// Global middleware
	e.Use(echomw.Logger())
	e.Use(echomw.Recover())
	e.Use(echomw.CORSWithConfig(echomw.CORSConfig{
		AllowOriginFunc: func(origin string) (bool, error) {
			for _, allowed := range corsAllowedOrigins {
				if origin == allowed {
					return true, nil
				}
			}
			return false, nil
		},
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions, http.MethodHead},
		AllowHeaders: []string{
			echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization,
			"Range", "If-Range",
			// tus protocol headers
			"Tus-Resumable", "Upload-Length", "Upload-Offset", "Upload-Metadata",
		},
		ExposeHeaders: []string{
			// streaming/byte-range support
			"Content-Length", "Content-Range", "Accept-Ranges",
			// tus protocol response headers the client needs to read
			"Tus-Resumable", "Tus-Version", "Tus-Extension",
			"Upload-Offset", "Upload-Length", "Location",
		},
		AllowCredentials: true,
	}))

	// Auth middleware (applies to all /api/* except public routes)
	e.Use(middleware.AuthMiddleware(authSvc))

	// Library access middleware (applies to /api/libraries/:id/*)
	e.Use(middleware.LibraryAccessMiddleware(accessSvc))

	// Routes
	api := e.Group("/api")

	// Health check — always registered regardless of mode
	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok", "mode": cfg.Mode})
	})

	// Version — public, no auth. Surfaces the git commit the binary was
	// built from so the frontend can render a "view source at this commit"
	// link in the admin panel.
	api.GET("/version", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]any{
			"version":   version.App(),
			"commit":    version.Commit(),
			"buildTime": version.BuildTime(),
			"dirty":     version.Dirty(),
			"mode":      cfg.Mode,
		})
	})

	// API routes — skipped in worker-only mode
	if cfg.Mode != "worker" {
		// Auth routes (public - skipped by auth middleware)
		authHandler := handlers.NewAuthHandler(db, authSvc, settingsSvc, cfg.GoogleAuthEnabled, activitySvc)
		authHandler.RegisterRoutes(api.Group("/auth"))
		authHandler.RegisterSessionRoute(api)

		// Library routes
		libraryHandler := handlers.NewLibraryHandler(db, accessSvc, faceSvc, objSvc)
		libraryHandler.RegisterRoutes(api.Group("/libraries"))

		// File routes (under /api/libraries)
		fileHandler := handlers.NewFileHandler(db, fileSvc, storageSvc, faceSvc, objSvc, videoSvc, transcribeSvc, audioDetectSvc, waveformSvc, activitySvc)
		fileHandler.RegisterRoutes(api.Group("/libraries"))

		// Folder routes (under /api/libraries)
		folderHandler := handlers.NewFolderHandler(db, activitySvc)
		folderHandler.RegisterRoutes(api.Group("/libraries"))

		// Tag routes (under /api/libraries)
		tagHandler := handlers.NewTagHandler(db, activitySvc)
		tagHandler.RegisterRoutes(api.Group("/libraries"))

		highlightFilterHandler := handlers.NewHighlightFilterHandler(db)
		highlightFilterHandler.RegisterRoutes(api.Group("/libraries"))

		// Moment routes (under /api/libraries)
		momentHandler := handlers.NewMomentHandler(db, storageSvc, momentExportSvc, cfg.BaseURL, activitySvc)
		momentHandler.RegisterRoutes(api.Group("/libraries"))

		// Member routes (under /api/libraries)
		memberHandler := handlers.NewMemberHandler(db, accessSvc, activitySvc)
		memberHandler.RegisterRoutes(api.Group("/libraries"))

		// Invite routes
		inviteHandler := handlers.NewInviteHandler(db, activitySvc)
		inviteHandler.RegisterRoutes(api.Group("/invites"))

		// Notifications: global feed + bell + dismissals + websocket
		notificationsHandler := handlers.NewNotificationsHandler(db, accessSvc, activitySvc)
		notificationsHandler.RegisterGlobalRoutes(api)
		notificationsHandler.RegisterLibraryRoutes(api.Group("/libraries"))

		// Wire the bus → hub fan-out. Workers and other API replicas
		// publish on Redis Pub/Sub; this loop receives + dispatches.
		activityBus.SetMemberLookup(notificationsHandler.MemberLookup)
		go func() {
			if err := activityBus.Run(context.Background(), activityHub); err != nil && err != context.Canceled {
				log.Printf("activity bus stopped: %v", err)
			}
		}()

		// Search
		searchHandler := handlers.NewSearchHandler(db)
		searchHandler.RegisterRoutes(api)

		// Admin routes — all under one owner-gated group.
		adminHandler := handlers.NewAdminHandler(db, hashSvc, settingsSvc)
		adminGroup := api.Group("/admin")
		adminHandler.RegisterRoutes(adminGroup)

		// Public meta — exposes registration mode for the register/invite UIs.
		api.GET("/_meta/registration-mode", func(c echo.Context) error {
			return c.JSON(http.StatusOK, map[string]string{
				"mode": settingsSvc.Get().RegistrationMode,
			})
		})

		// Admin job queue routes — share the same /admin group and are also
		// owner-gated via the middleware passed from AdminHandler.
		adminJobsHandler := handlers.NewAdminJobsHandler(asynqInspector, adminHandler.RequireOwnerMiddleware())
		adminJobsHandler.RegisterRoutes(adminGroup)

		// People routes (under /api/libraries)
		peopleHandler := handlers.NewPeopleHandler(db, storageSvc, faceSvc)
		peopleHandler.RegisterRoutes(api.Group("/libraries"))

		// Object detection routes (under /api/libraries)
		objectsHandler := handlers.NewObjectsHandler(db, objSvc)
		objectsHandler.RegisterRoutes(api.Group("/libraries"))

		// Download routes (under /api/libraries)
		downloadHandler := handlers.NewDownloadHandler(db, storageSvc)
		downloadHandler.RegisterRoutes(api.Group("/libraries"))

		// Tus resumable upload routes (under /api/tus)
		tusHandler := handlers.NewTusHandler(db, storageSvc, cfg.StoragePath, faceSvc, objSvc, videoSvc, waveformSvc, transcribeSvc, audioDetectSvc, activitySvc)
		tusHandler.RegisterRoutes(api)

		// Avatar routes (under /api/auth)
		avatarHandler := handlers.NewAvatarHandler(db, storageSvc)
		avatarHandler.RegisterRoutes(api.Group("/auth"))

		// OAuth routes (under /api/auth)
		oauthHandler := handlers.NewOAuthHandler(db, authSvc, cfg.OAuthGoogleClientID, cfg.OAuthGoogleClientSecret, cfg.BaseURL)
		oauthHandler.RegisterRoutes(api.Group("/auth"))

		// Public file proxy (skipped by auth middleware)
		fileProxyHandler := handlers.NewFileProxyHandler(db, storageSvc, imgSvc)
		fileProxyHandler.RegisterRoutes(api.Group("/files"))

		// Public moment share endpoints (metadata + video + thumbnail).
		// HTML landing page is rendered by Nuxt; this only exposes API.
		shareHandler := handlers.NewShareHandler(db, storageSvc, cfg.BaseURL)
		shareHandler.RegisterRoutes(api.Group("/share"))
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go func() {
		addr := fmt.Sprintf(":%d", cfg.Port)
		log.Printf("Starting server on %s", addr)
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down server...")

	// Shutdown asynq worker
	if asynqServer != nil {
		asynqServer.Shutdown()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server shutdown error: %v", err)
	}
	log.Println("Server stopped")
}

// buildCORSOrigins constructs the explicit origin allowlist used by the CORS
// middleware. It always includes the origin derived from baseURL, plus any
// entries from extraOrigins, plus localhost variants when env == "development".
// Entries that cannot be parsed or are empty are silently skipped.
func buildCORSOrigins(baseURL string, extraOrigins []string, env string) []string {
	seen := map[string]struct{}{}
	out := []string{}

	add := func(origin string) {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			return
		}
		if _, ok := seen[origin]; ok {
			return
		}
		seen[origin] = struct{}{}
		out = append(out, origin)
	}

	// Primary origin from BaseURL.
	if baseURL != "" {
		if parsed, err := url.Parse(baseURL); err == nil && parsed.Host != "" {
			add(parsed.Scheme + "://" + parsed.Host)
		}
	}

	// Extra origins from config (ALCOVES_EXTRA_CORS_ORIGINS).
	for _, o := range extraOrigins {
		add(o)
	}

	// In development mode, also allow common localhost origins so the Nuxt
	// dev server (:3000 / :5173) can reach the API without reconfiguring
	// ALCOVES_BASE_URL.
	if env == "development" {
		add("http://localhost:3000")
		add("http://localhost:5173")
	}

	return out
}
