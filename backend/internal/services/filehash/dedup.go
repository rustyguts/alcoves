package filehash

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// FindDuplicates returns IDs of non-trashed files in the same library that share
// the given hash, excluding fileID itself. Returns an empty slice when hash is
// empty or no siblings exist. Derived files (proxies, thumbnails) are skipped
// via the source_file_id filter.
func FindDuplicates(db *gorm.DB, libraryID, fileID uuid.UUID, hash string) ([]uuid.UUID, error) {
	if hash == "" {
		return nil, nil
	}
	var ids []uuid.UUID
	err := db.Model(&models.File{}).
		Where("library_id = ? AND hash = ? AND id <> ? AND trashed_at IS NULL AND source_file_id IS NULL",
			libraryID, hash, fileID).
		Pluck("id", &ids).Error
	if err != nil {
		return nil, err
	}
	return ids, nil
}

// HasDuplicatesByID returns the set of file IDs (from the input) that have at
// least one duplicate sibling in the same library. Used for list endpoints to
// avoid N+1 queries.
func HasDuplicatesByID(db *gorm.DB, libraryID uuid.UUID, fileIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	result := map[uuid.UUID]bool{}
	if len(fileIDs) == 0 {
		return result, nil
	}

	type row struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	var rows []row
	// A file in `fileIDs` has duplicates iff there exists another non-trashed
	// source file in the same library with the same hash.
	err := db.Raw(`
		SELECT f.id
		FROM files f
		WHERE f.id IN ?
		  AND f.library_id = ?
		  AND f.hash IS NOT NULL
		  AND EXISTS (
		    SELECT 1 FROM files o
		    WHERE o.library_id = f.library_id
		      AND o.hash = f.hash
		      AND o.id <> f.id
		      AND o.trashed_at IS NULL
		      AND o.source_file_id IS NULL
		  )
	`, fileIDs, libraryID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.ID] = true
	}
	return result, nil
}
