package db

import (
	"log"
	"os"

	"github.com/rustyguts/alcoves/internal/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// https://github.com/gofiber/recipes/blob/master/gorm-postgres/database/database.go

var DBConn *gorm.DB

func InitDB() {
	var err error
	db_path := os.Getenv("ALCOVES_DB_ENV")

	if db_path == "" {
		log.Println("ALCOVES_DB_ENV is not set, defaulting to /data/alcoves.db")
		db_path = "/data/alcoves.db"
	}

	DBConn, err = gorm.Open(sqlite.Open(db_path), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
}

func Migrate() {
	DBConn.AutoMigrate(&models.User{})
	DBConn.AutoMigrate(&models.Asset{})
}
