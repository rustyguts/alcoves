package config

import (
	"log"
	"os"
	"path/filepath"
)

var DATA_STORAGE_PATH = filepath.Join(".", "data")
var ASSETS_PATH = filepath.Join(DATA_STORAGE_PATH, "assets")
var ASSETS_CACHE_PATH = filepath.Join(DATA_STORAGE_PATH, "cache")

func EnsureDirectories() {
	dirs := []string{
		ASSETS_PATH,
		ASSETS_CACHE_PATH,
	}

	for _, dir := range dirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			err := os.MkdirAll(dir, os.ModePerm)
			if err != nil {
				log.Fatalf("Failed to create directory %s: %v", dir, err)
			}
		}
	}
}
