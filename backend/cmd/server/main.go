package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"

	"github.com/alcoves/alcoves-backend/internal/config"
	"github.com/alcoves/alcoves-backend/internal/database"
	"github.com/alcoves/alcoves-backend/internal/handlers"
	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/services/access"
	authservice "github.com/alcoves/alcoves-backend/internal/services/auth"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/files"
	"github.com/alcoves/alcoves-backend/internal/services/imageproxy"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/spa"
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
	// avoids blocking task processing.
	go func() {
		if err := faceSvc.EnsureModels(); err != nil {
			log.Printf("Warning: failed to pre-download face detection models: %v", err)
		}
		if err := objSvc.EnsureModels(); err != nil {
			log.Printf("Warning: failed to pre-download object detection model: %v", err)
		}
	}()

	// Video proxy service
	videoSvc := videoproxy.NewService(db, storageSvc, asynqClient)

	// Start asynq worker if mode is "all" or "worker"
	var asynqServer *asynq.Server
	if cfg.Mode == "all" || cfg.Mode == "worker" {
		asynqServer = asynq.NewServer(asynqRedisOpt, asynq.Config{
			Concurrency: 2,
			Queues:      map[string]int{"default": 1},
		})

		mux := asynq.NewServeMux()
		mux.HandleFunc(facedetection.TaskTypeFaceDetect, faceSvc.NewTaskHandler().ProcessTask)
		mux.HandleFunc(objectdetection.TaskTypeObjectDetect, objSvc.NewTaskHandler().ProcessTask)
		videoTaskHandler := videoSvc.NewTaskHandler()
		mux.HandleFunc(videoproxy.TaskTypeVideoProxy, videoTaskHandler.ProcessTask)
		mux.HandleFunc(videoproxy.TaskTypeVideoThumb, videoTaskHandler.ProcessThumbnailTask)

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

	// Global middleware
	e.Use(echomw.Logger())
	e.Use(echomw.Recover())
	e.Use(echomw.CORSWithConfig(echomw.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions, http.MethodHead},
		AllowHeaders: []string{
			echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization,
			// tus protocol headers
			"Tus-Resumable", "Upload-Length", "Upload-Offset", "Upload-Metadata",
		},
		ExposeHeaders: []string{
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

	// Auth routes (public - skipped by auth middleware)
	authHandler := handlers.NewAuthHandler(db, authSvc, cfg.GoogleAuthEnabled)
	authHandler.RegisterRoutes(api.Group("/auth"))
	authHandler.RegisterSessionRoute(api)

	// Library routes
	libraryHandler := handlers.NewLibraryHandler(db, accessSvc, faceSvc, objSvc)
	libraryHandler.RegisterRoutes(api.Group("/libraries"))

	// File routes (under /api/libraries)
	fileHandler := handlers.NewFileHandler(db, fileSvc, storageSvc, faceSvc, objSvc, videoSvc)
	fileHandler.RegisterRoutes(api.Group("/libraries"))

	// Folder routes (under /api/libraries)
	folderHandler := handlers.NewFolderHandler(db)
	folderHandler.RegisterRoutes(api.Group("/libraries"))

	// Tag routes (under /api/libraries)
	tagHandler := handlers.NewTagHandler(db)
	tagHandler.RegisterRoutes(api.Group("/libraries"))

	// Member routes (under /api/libraries)
	memberHandler := handlers.NewMemberHandler(db, accessSvc)
	memberHandler.RegisterRoutes(api.Group("/libraries"))

	// Invite routes
	inviteHandler := handlers.NewInviteHandler(db)
	inviteHandler.RegisterRoutes(api.Group("/invites"))

	// Search
	searchHandler := handlers.NewSearchHandler(db)
	searchHandler.RegisterRoutes(api)

	// Admin routes
	adminHandler := handlers.NewAdminHandler(db)
	adminHandler.RegisterRoutes(api.Group("/admin"))

	// Admin job queue routes
	adminJobsHandler := handlers.NewAdminJobsHandler(asynqInspector)
	adminJobsHandler.RegisterRoutes(api.Group("/admin"))

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
	tusHandler := handlers.NewTusHandler(db, storageSvc, cfg.StoragePath, faceSvc, objSvc, videoSvc)
	tusHandler.RegisterRoutes(api)

	// Avatar routes (under /api/auth)
	avatarHandler := handlers.NewAvatarHandler(db, storageSvc)
	avatarHandler.RegisterRoutes(api.Group("/auth"))

	// OAuth routes (under /api/auth)
	oauthHandler := handlers.NewOAuthHandler(db, authSvc, cfg.OAuthGoogleClientID, cfg.OAuthGoogleClientSecret, cfg.BaseURL)
	oauthHandler.RegisterRoutes(api.Group("/auth"))

	// Public file proxy (skipped by auth middleware)
	imgProcessor := imageproxy.NewVipsProcessor()
	fileProxyHandler := handlers.NewFileProxyHandler(db, storageSvc, imgProcessor)
	fileProxyHandler.RegisterRoutes(api.Group("/files"))

	// Health check
	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// SPA frontend (no-op in dev mode, serves embedded dist/ in production)
	spa.RegisterRoutes(e)

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
