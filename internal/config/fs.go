package config

import (
	"log"
	"os"
)

var DATA_STORAGE_PATH = "/data"
var ASSETS_PATH = "/data/assets"

func EnsureDirectories() {
	if _, err := os.Stat(DATA_STORAGE_PATH); os.IsNotExist(err) {
		err := os.MkdirAll(DATA_STORAGE_PATH, os.ModePerm)
		if err != nil {
			log.Fatalf("Failed to create directory: %v", err)
		}
	}
	if _, err := os.Stat(ASSETS_PATH); os.IsNotExist(err) {
		err := os.MkdirAll(ASSETS_PATH, os.ModePerm)
		if err != nil {
			log.Fatalf("Failed to create directory: %v", err)
		}
	}
}
