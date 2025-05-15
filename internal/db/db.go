package db

import (
	"log"
	"os"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var DBConn *gorm.DB
var SessionStore sessions.Store

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

	// Create a cookie-based store for session management
	// In a production environment, you should use a more secure store
	store := cookie.NewStore([]byte("secret"))
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   int(12 * time.Hour / time.Second), // 12 hours
		HttpOnly: true,
	})
	SessionStore = store
}
