package config

import (
	"log"
	"os"
)

var DATA_STORAGE_PATH = "/data/uploads/"

func EnsureDirectories() {
	if _, err := os.Stat(DATA_STORAGE_PATH); os.IsNotExist(err) {
		err := os.MkdirAll(DATA_STORAGE_PATH, os.ModePerm)
		if err != nil {
			log.Fatalf("Failed to create directory: %v", err)
		}
	}
}
