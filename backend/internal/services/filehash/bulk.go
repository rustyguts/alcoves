package filehash

import (
	"fmt"
	"log"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"
)

// EnqueueUnhashedFiles queries for all files without a hash and enqueues
// a file:hash task for each one.
func EnqueueUnhashedFiles(client *asynq.Client, db *gorm.DB) (int, error) {
	type fileRow struct {
		ID        string `gorm:"column:id"`
		LibraryID string `gorm:"column:library_id"`
	}

	var files []fileRow
	err := db.Raw(`
		SELECT id, library_id FROM files
		WHERE hash IS NULL AND trashed_at IS NULL
		ORDER BY created_at ASC
	`).Scan(&files).Error
	if err != nil {
		return 0, fmt.Errorf("failed to query unhashed files: %w", err)
	}

	enqueued := 0
	for _, f := range files {
		task, err := NewFileHashTask(f.LibraryID, f.ID)
		if err != nil {
			log.Printf("failed to create hash task for file %s: %v", f.ID, err)
			continue
		}
		if _, err := client.Enqueue(task, asynq.Retention(completedTaskRetention)); err != nil {
			log.Printf("failed to enqueue hash task for file %s: %v", f.ID, err)
			continue
		}
		enqueued++
	}

	return enqueued, nil
}
