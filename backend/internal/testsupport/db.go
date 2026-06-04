// Package testsupport provides shared helpers for the Go test suites.
//
// It is imported only from *_test.go files, so it is compiled into the test
// binaries and never into the production server binary.
package testsupport

import (
	"fmt"
	"sync"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// BaseDSN is the connection string for the shared test PostgreSQL instance.
// CI provisions a single `alcoves_test` database (see .github/workflows/ci.yml);
// per-package isolation is achieved with PostgreSQL schemas rather than separate
// databases so the suite needs no extra provisioning and still runs correctly
// under `go test ./...` without -p 1.
const BaseDSN = "postgres://postgres:postgres@localhost:5455/alcoves_test"

var ensuredSchemas sync.Map // schema name -> struct{}

// OpenSchema opens a *gorm.DB against the shared test database scoped to a
// dedicated PostgreSQL schema (via search_path). Each test package passes a
// unique schema name so that packages running concurrently under `go test ./...`
// never TRUNCATE/migrate each other's tables — the historical cause of
// FK-violation and deadlock flakiness that previously forced -p 1.
//
// The connection pool is capped and closed at test end so a package's many
// per-test connections never exhaust Postgres' max_connections. If the database
// is unreachable the test is skipped, so the suite still builds + runs without
// a local DB.
func OpenSchema(t *testing.T, schema string) *gorm.DB {
	t.Helper()

	// search_path is the schema ALONE (no ,public). A public fallback would let
	// a query resolve to a leftover public.<table> after a test DROPs its own
	// schema-local table — silently breaking the "expected a DB error" tests and
	// undermining isolation. Everything a package needs (its tables, and the
	// pgvector extension for facedetection) is created inside its own schema;
	// built-ins like gen_random_uuid() live in pg_catalog, which is always
	// implicitly in the search path.
	//
	// The schema is created on a bootstrap connection (default search_path)
	// before the pooled connections — whose search_path points at the schema —
	// run any migrations, so tables never accidentally land in public.
	if _, done := ensuredSchemas.Load(schema); !done {
		boot, err := gorm.Open(postgres.Open(BaseDSN), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if err != nil {
			t.Skipf("Skipping test: database not available: %v", err)
		}
		if err := boot.Exec("CREATE SCHEMA IF NOT EXISTS " + schema).Error; err != nil {
			t.Skipf("Skipping test: cannot create schema %q: %v", schema, err)
		}
		if bootSQL, e := boot.DB(); e == nil {
			_ = bootSQL.Close()
		}
		ensuredSchemas.Store(schema, struct{}{})
	}

	dsn := fmt.Sprintf("%s?search_path=%s", BaseDSN, schema)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })

	return db
}
