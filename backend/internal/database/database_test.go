package database

import (
	"testing"
)

const testDSN = "postgres://postgres:postgres@localhost:5455/alcoves_test"

func TestConnect_Success(t *testing.T) {
	db, err := Connect(testDSN)
	if err != nil {
		t.Skipf("database not available: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("DB(): %v", err)
	}
	defer sqlDB.Close()
	if err := sqlDB.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

func TestConnect_Error(t *testing.T) {
	// Point at a port with nothing listening so the driver fails to connect.
	_, err := Connect("postgres://postgres:postgres@localhost:1/nope?connect_timeout=1&sslmode=disable")
	if err == nil {
		t.Fatal("expected connection error")
	}
}

func TestRunMigrations(t *testing.T) {
	// Run goose migrations against a throwaway database created at runtime so
	// this works anywhere the test postgres is reachable (incl. CI, which only
	// provisions `alcoves_test`). Using a dedicated DB keeps the migration's
	// real schema from colliding with the AutoMigrate'd partial schemas other
	// packages create on the shared test DB.
	const migDB = "alcoves_migtest"

	admin, err := Connect("postgres://postgres:postgres@localhost:5455/postgres")
	if err != nil {
		t.Skipf("database not available: %v", err)
	}
	adminSQL, err := admin.DB()
	if err != nil {
		t.Fatalf("admin DB(): %v", err)
	}
	defer adminSQL.Close()

	// Raw Exec (not wrapped in a transaction) — CREATE/DROP DATABASE cannot run
	// inside a transaction block.
	adminSQL.Exec("DROP DATABASE IF EXISTS " + migDB)
	if _, err := adminSQL.Exec("CREATE DATABASE " + migDB); err != nil {
		t.Skipf("cannot create throwaway migration db: %v", err)
	}
	defer adminSQL.Exec("DROP DATABASE IF EXISTS " + migDB)

	db, err := Connect("postgres://postgres:postgres@localhost:5455/" + migDB)
	if err != nil {
		t.Fatalf("connect migdb: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("DB(): %v", err)
	}

	if err := RunMigrations(sqlDB); err != nil {
		sqlDB.Close()
		t.Fatalf("RunMigrations: %v", err)
	}
	// Idempotent: a second run applies nothing new and still succeeds.
	if err := RunMigrations(sqlDB); err != nil {
		sqlDB.Close()
		t.Fatalf("RunMigrations (second run): %v", err)
	}
	// Close the connection before the deferred DROP DATABASE so it isn't blocked
	// by an open session.
	sqlDB.Close()
}
