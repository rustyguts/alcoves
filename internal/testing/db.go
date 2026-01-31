package testing

import (
	"testing"

	"github.com/rustyguts/alcoves/internal/db"
	"github.com/rustyguts/alcoves/internal/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func SetupTestDatabase(t *testing.T) {
	testDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to connect to test database: %v", err)
	}

	db.Connection = testDB

	err = testDB.AutoMigrate(&models.User{}, &models.Library{}, &models.File{}, &models.Session{}, &models.Folder{})
	if err != nil {
		t.Fatalf("Failed to migrate test database: %v", err)
	}
}
