package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"github.com/pressly/goose/v3"

	"github.com/alcoves/alcoves-backend/migrations"
)

// RunMigrations applies all pending SQL migrations embedded in the binary.
func RunMigrations(db *sql.DB) error {
	provider, err := goose.NewProvider(
		goose.DialectPostgres,
		db,
		migrations.FS,
	)
	if err != nil {
		return fmt.Errorf("failed to create migration provider: %w", err)
	}

	results, err := provider.Up(context.Background())
	if err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	for _, r := range results {
		log.Printf("migration %s applied in %s", r.Source.Path, r.Duration)
	}

	version, err := provider.GetDBVersion(context.Background())
	if err != nil {
		return fmt.Errorf("failed to get migration version: %w", err)
	}

	log.Printf("Database migration complete (version=%d)", version)
	return nil
}
