package db

import (
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2/middleware/session"
	"github.com/gofiber/storage/sqlite3"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// https://github.com/gofiber/recipes/blob/master/gorm-postgres/database/database.go

var DBConn *gorm.DB
var SessionStore *session.Store

func InitDB() {
	var err error
	db_path := os.Getenv("ALCOVES_DB_PATH")

	if db_path == "" {
		log.Println("ALCOVES_DB_PATH is not set, defaulting to /data/alcoves.db")
		db_path = "/data/alcoves.db"
	}

	DBConn, err = gorm.Open(sqlite.Open(db_path), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	SessionStore = session.New(session.Config{
		Storage: sqlite3.New(sqlite3.Config{
			Database:        "/data/alcoves.db",
			Table:           "sessions",
			Reset:           false,
			GCInterval:      10 * time.Second,
			MaxOpenConns:    100,
			MaxIdleConns:    100,
			ConnMaxLifetime: 1 * time.Second,
		}),
	})
}
