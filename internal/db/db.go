package db

import (
	"log/slog"
	"os"
	"strings"

	"github.com/rustyguts/alcoves/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var Connection *gorm.DB

func getDatabaseURL() string {
	envURL := os.Getenv("ALCOVES_DATABASE_URL")
	if envURL == "" {
		slog.Error("ALCOVES_DATABASE_URL is not set in environment")
		panic("ALCOVES_DATABASE_URL environment variable is required but not set")
	}
	slog.Info("using ALCOVES_DATABASE_URL from environment")
	return envURL
}

func migrate(db *gorm.DB) error {
	modelsToMigrate := []interface{}{
		&models.User{},
		&models.Library{},
		&models.File{},
		&models.Session{},
	}

	for _, model := range modelsToMigrate {
		if err := db.AutoMigrate(model); err != nil {
			slog.Error("failed to migrate model", "model", model, "error", err)
			return err
		}
	}
	return nil
}

func Initialize() (*gorm.DB, error) {
	if Connection != nil {
		slog.Info("using existing database connection")
		return Connection, nil
	}

	databaseURL := getDatabaseURL()

	var db *gorm.DB
	var err error

	// Detect database type from connection string
	if strings.HasPrefix(databaseURL, "sqlite:") {
		// SQLite connection string format: sqlite:path/to/db.db or sqlite::memory:
		dbPath := strings.TrimPrefix(databaseURL, "sqlite:")
		db, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
		slog.Info("using SQLite database", "path", dbPath)
	} else {
		// Assume PostgreSQL
		db, err = gorm.Open(postgres.Open(databaseURL), &gorm.Config{})
		slog.Info("using PostgreSQL database")
	}

	if err != nil {
		return nil, err
	}

	if err := migrate(db); err != nil {
		return nil, err
	}

	Connection = db

	// TODO :: Seed the database

	return Connection, nil
}
