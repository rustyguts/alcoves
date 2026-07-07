package files

import (
	"fmt"
	"log"

	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// PurgeParams selects what to permanently delete. Exactly one of FileIDs /
// FolderIDs drives the mode; both empty means "purge all trashed items".
type PurgeParams struct {
	FileIDs   []string
	FolderIDs []string
}

// Purge permanently deletes trashed files/folders (and their derived proxy/
// thumbnail rows + blobs), within a transaction, then best-effort cleans face/
// object data. Returns the number of source files+folders deleted.
func (s *Service) Purge(libraryID string, p PurgeParams) (int, error) {
	if s.ingest == nil || s.ingest.Storage == nil {
		return 0, fmt.Errorf("files.Service not configured for purge")
	}

	var filesToPurge []models.File
	var folderIDsToPurge []string

	if len(p.FileIDs) > 0 {
		// Purge specific files — must be trashed
		if err := s.db.Where("id IN ? AND library_id = ? AND trashed_at IS NOT NULL", p.FileIDs, libraryID).Find(&filesToPurge).Error; err != nil {
			return 0, fmt.Errorf("failed to load files for purge: %w", err)
		}
	} else if len(p.FolderIDs) > 0 {
		// Purge specific trashed folders and their descendants
		allFolderSet := make(map[string]struct{})
		for _, fid := range p.FolderIDs {
			allFolderSet[fid] = struct{}{}
			for _, descendantID := range DescendantFolderIDs(s.db, libraryID, fid) {
				allFolderSet[descendantID] = struct{}{}
			}
		}
		for id := range allFolderSet {
			folderIDsToPurge = append(folderIDsToPurge, id)
		}

		if len(folderIDsToPurge) > 0 {
			if err := s.db.Where("parent_folder_id IN ? AND library_id = ? AND trashed_at IS NOT NULL", folderIDsToPurge, libraryID).Find(&filesToPurge).Error; err != nil {
				return 0, fmt.Errorf("failed to load folder files for purge: %w", err)
			}
		}
	} else {
		// Purge all trashed items in the library
		if err := s.db.Where("library_id = ? AND trashed_at IS NOT NULL", libraryID).Find(&filesToPurge).Error; err != nil {
			return 0, fmt.Errorf("failed to load files for purge: %w", err)
		}
		var trashedFolders []models.Folder
		if err := s.db.Select("id").Where("library_id = ? AND trashed_at IS NOT NULL", libraryID).Find(&trashedFolders).Error; err != nil {
			return 0, fmt.Errorf("failed to load folders for purge: %w", err)
		}
		for _, folder := range trashedFolders {
			folderIDsToPurge = append(folderIDsToPurge, folder.ID.String())
		}
	}

	// Collect IDs for the source files being purged.
	fileIDs := make([]string, 0, len(filesToPurge))
	for _, f := range filesToPurge {
		fileIDs = append(fileIDs, f.ID.String())
	}

	// Load all derived files (proxies, thumbnails) whose source is being purged.
	// These are stored in the files table with source_file_id pointing at a source file.
	var derivedFiles []models.File
	if len(fileIDs) > 0 {
		if err := s.db.Where("source_file_id IN ?", fileIDs).Find(&derivedFiles).Error; err != nil {
			return 0, fmt.Errorf("failed to load derived files for purge: %w", err)
		}
	}

	// Delete blobs for all source files and their derived files (proxies, thumbnails) from disk
	// first, before touching the DB. If any storage delete fails we stop early and leave the DB intact.
	for _, f := range filesToPurge {
		// Delete the source blob and legacy cache artifacts (proxy.mp4, thumbnail.webp).
		if err := s.ingest.Storage.DeleteFile(f.LibraryID.String(), f.ID.String()); err != nil {
			return 0, fmt.Errorf("failed to delete file from disk: %w", err)
		}
	}
	for _, f := range derivedFiles {
		// Delete the derived file blob (proxy or thumbnail stored under its own file ID).
		if err := s.ingest.Storage.DeleteFileBlob(f.LibraryID.String(), f.ID.String()); err != nil {
			return 0, fmt.Errorf("failed to delete derived file from disk: %w", err)
		}
	}

	// Collect derived file IDs for DB cleanup.
	derivedFileIDs := make([]string, 0, len(derivedFiles))
	for _, f := range derivedFiles {
		derivedFileIDs = append(derivedFileIDs, f.ID.String())
	}

	purgedCount := 0

	// All DB mutations inside a transaction.
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if len(fileIDs) > 0 {
			// Remove file-tag associations for source files.
			if err := tx.Where("file_id IN ?", fileIDs).Delete(&models.FileTag{}).Error; err != nil {
				return fmt.Errorf("failed to delete file tags: %w", err)
			}

			// Remove live-document CRDT state (update log first, then the doc
			// row). The migration's FK CASCADEs cover other delete paths;
			// explicit deletes keep AutoMigrate-based test schemas honest.
			if err := tx.Where("file_id IN ?", fileIDs).Delete(&models.DocumentUpdate{}).Error; err != nil {
				return fmt.Errorf("failed to delete document updates: %w", err)
			}
			if err := tx.Where("file_id IN ?", fileIDs).Delete(&models.Document{}).Error; err != nil {
				return fmt.Errorf("failed to delete documents: %w", err)
			}

			// Delete derived file rows (proxies and thumbnails) that reference the source files.
			// These are never user-visible but must be cleaned up when the source is purged.
			if len(derivedFileIDs) > 0 {
				if err := tx.Where("id IN ?", derivedFileIDs).Delete(&models.File{}).Error; err != nil {
					return fmt.Errorf("failed to delete derived files: %w", err)
				}
			}

			// Delete the source file records.
			result := tx.Where("id IN ? AND library_id = ?", fileIDs, libraryID).Delete(&models.File{})
			if result.Error != nil {
				return fmt.Errorf("failed to delete files: %w", result.Error)
			}
			purgedCount += int(result.RowsAffected)
		}

		if len(folderIDsToPurge) > 0 {
			// Remove folder-tag associations
			if err := tx.Where("folder_id IN ?", folderIDsToPurge).Delete(&models.FolderTag{}).Error; err != nil {
				return fmt.Errorf("failed to delete folder tags: %w", err)
			}

			result := tx.Where("id IN ? AND library_id = ?", folderIDsToPurge, libraryID).Delete(&models.Folder{})
			if result.Error != nil {
				return fmt.Errorf("failed to delete folders: %w", result.Error)
			}
			purgedCount += int(result.RowsAffected)
		}

		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("failed to purge items: %w", err)
	}

	// Clean up face data for purged files (best-effort, outside transaction).
	if len(fileIDs) > 0 && s.ingest.Face != nil {
		if err := s.ingest.Face.DeleteFaceDataForFiles(libraryID, fileIDs); err != nil {
			log.Printf("failed to clean face data for purged files: %v", err)
		}
	}

	// Clean up object detection data for purged files (best-effort, outside transaction).
	if len(fileIDs) > 0 && s.ingest.Object != nil {
		if err := s.ingest.Object.DeleteObjectDataForFiles(libraryID, fileIDs); err != nil {
			log.Printf("failed to clean object detection data for purged files: %v", err)
		}
	}

	return purgedCount, nil
}
