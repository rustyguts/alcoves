package files

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/activity"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/filehash"
	"github.com/alcoves/alcoves-backend/internal/services/metadata"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

// IngestDeps carries the storage and async-job services needed to finalize an
// uploaded file into a File record. Storage is required; the detection / proxy /
// activity services are optional and each enqueue step is skipped when its
// service pointer is nil (mirroring the nil-guards in the original tus handler).
type IngestDeps struct {
	Storage     *storage.Service
	Face        *facedetection.Service
	Object      *objectdetection.Service
	Video       *videoproxy.Service
	Waveform    *waveform.Service
	Transcribe  *transcribe.Service
	AudioDetect *audiodetection.Service
	Metadata    *metadata.Service
	Activity    *activity.Service
}

// NewServiceWithIngest builds a files.Service that can both list and ingest.
// The plain NewService(db) still works for read-only callers (ingest disabled).
func NewServiceWithIngest(db *gorm.DB, deps IngestDeps) *Service {
	return &Service{db: db, ingest: &deps}
}

// IngestParams describes a single file ingest.
type IngestParams struct {
	LibraryID         uuid.UUID
	OwnerID           uuid.UUID
	FolderID          *uuid.UUID
	Name              string
	MimeType          string
	OriginalCreatedAt *time.Time
}

// IngestResult is returned after a successful ingest.
type IngestResult struct {
	File           *models.File
	DuplicateCount int
	DuplicateIDs   []uuid.UUID
}

// IngestStream streams r into permanent storage (computing a SHA-256 as it
// goes), creates the File record, emits an activity event, runs duplicate
// detection, and enqueues the post-upload async jobs (face / object detection
// for images; thumbnail / proxy / waveform / transcribe / audio-detect for
// videos). This is the single source of truth shared by the tus finalize path
// and the MCP upload tool. Behavior matches the original tus finishUpload.
//
// The copy is constant-memory (no full-file buffering) so 25GB+ files stream
// fine, and ctx cancellation aborts the copy and cleans up the partial blob.
func (s *Service) IngestStream(ctx context.Context, p IngestParams, r io.Reader) (*IngestResult, error) {
	if s.ingest == nil || s.ingest.Storage == nil {
		return nil, fmt.Errorf("files.Service is not configured for ingest")
	}

	fileID := uuid.New()

	// Stream to storage while hashing. ctxReader makes the copy cancelable.
	hr := filehash.NewHashingReader(&ctxReader{ctx: ctx, r: r})
	bytesWritten, err := s.ingest.Storage.StoreFileStream(p.LibraryID.String(), fileID.String(), hr)
	if err != nil {
		// Remove any partial blob (e.g. on ctx cancel mid-stream).
		_ = s.ingest.Storage.DeleteFile(p.LibraryID.String(), fileID.String())
		return nil, fmt.Errorf("failed to store file: %w", err)
	}

	hashStr := hr.HexSum()
	file := models.File{
		BaseModel:         models.BaseModel{ID: fileID},
		LibraryID:         p.LibraryID,
		ParentFolderID:    p.FolderID,
		Name:              p.Name,
		MimeType:          p.MimeType,
		Size:              bytesWritten,
		OwnerID:           &p.OwnerID,
		Hash:              &hashStr,
		OriginalCreatedAt: p.OriginalCreatedAt,
	}

	if err := s.db.Create(&file).Error; err != nil {
		_ = s.ingest.Storage.DeleteFile(p.LibraryID.String(), fileID.String())
		return nil, fmt.Errorf("failed to create file record: %w", err)
	}

	if s.ingest.Activity != nil {
		actor := p.OwnerID
		s.ingest.Activity.EmitAsync(activity.EmitParams{
			LibraryID:   p.LibraryID,
			ActorID:     &actor,
			Action:      activity.ActionFileCreated,
			SubjectType: activity.SubjectFile,
			SubjectID:   &fileID,
			Metadata: map[string]any{
				"name":           p.Name,
				"mimeType":       p.MimeType,
				"parentFolderId": p.FolderID,
				"size":           bytesWritten,
			},
		})
	}

	// Best-effort duplicate detection.
	var dupIDs []uuid.UUID
	if ids, derr := filehash.FindDuplicates(s.db, p.LibraryID, fileID, hashStr); derr != nil {
		log.Printf("dedup query failed for ingested file %s: %v", fileID, derr)
	} else {
		dupIDs = ids
	}

	s.enqueuePostIngestJobs(p.LibraryID, fileID, p.MimeType)

	return &IngestResult{File: &file, DuplicateCount: len(dupIDs), DuplicateIDs: dupIDs}, nil
}

// enqueuePostIngestJobs triggers the same async pipeline the tus finalize path
// used: face/object detection for images and thumbnail/proxy/waveform/
// transcribe/audio-detect for videos. Each step is nil-guarded and best-effort.
func (s *Service) enqueuePostIngestJobs(libraryID, fileID uuid.UUID, mimeType string) {
	d := s.ingest
	libStr := libraryID.String()
	fileStr := fileID.String()

	// EXIF / media-metadata extraction (Timeline + Map). No library-setting
	// gate — it's always cheap and useful. metadata_status is set so the
	// maintenance backfill scan skips this freshly-enqueued file.
	if d.Metadata != nil && (strings.HasPrefix(mimeType, "image/") || strings.HasPrefix(mimeType, "video/")) {
		s.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
			"metadata_status":  "queued",
			"metadata_version": 1,
		})
		if err := d.Metadata.EnqueueMetadata(libStr, fileStr); err != nil {
			log.Printf("failed to enqueue metadata extraction for ingest %s: %v", fileID, err)
		}
	}

	if d.Face != nil && strings.HasPrefix(mimeType, "image/") {
		var library models.Library
		if err := s.db.Select("face_recognition_enabled").Where("id = ?", libraryID).First(&library).Error; err == nil {
			if library.FaceRecognitionEnabled {
				if err := d.Face.EnqueueFaceDetection(libStr, fileStr); err != nil {
					log.Printf("failed to enqueue face detection for ingest %s: %v", fileID, err)
				}
			}
		}
	}

	if d.Object != nil && strings.HasPrefix(mimeType, "image/") {
		var objLibrary models.Library
		if err := s.db.Select("object_detection_enabled").Where("id = ?", libraryID).First(&objLibrary).Error; err == nil {
			if objLibrary.ObjectDetectionEnabled {
				if err := d.Object.EnqueueObjectDetection(libStr, fileStr); err != nil {
					log.Printf("failed to enqueue object detection for ingest %s: %v", fileID, err)
				}
			}
		}
	}

	if d.Video != nil && strings.HasPrefix(mimeType, "video/") {
		if err := d.Video.EnqueueVideoThumbnail(libStr, fileStr); err != nil {
			log.Printf("failed to enqueue video thumbnail for ingest %s: %v", fileID, err)
		}

		if videoproxy.ShouldCreateProxyByDefault(mimeType) {
			queued := "queued"
			zero := 0
			s.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
				"proxy_status":      queued,
				"proxy_progress":    zero,
				"proxy_eta_seconds": nil,
			})
			if err := d.Video.EnqueueVideoProxy(libStr, fileStr, false); err != nil {
				log.Printf("failed to enqueue video proxy for ingest %s: %v", fileID, err)
			}
		} else {
			notNeeded := "not_needed"
			s.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
				"proxy_status":      notNeeded,
				"proxy_progress":    nil,
				"proxy_eta_seconds": nil,
			})
		}

		if d.Waveform != nil {
			if err := d.Waveform.EnqueueWaveform(libStr, fileStr); err != nil {
				log.Printf("failed to enqueue waveform for ingest %s: %v", fileID, err)
			}
		}

		if d.Transcribe != nil {
			queued := "queued"
			zero := 0
			s.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
				"transcribe_status":      queued,
				"transcribe_progress":    zero,
				"transcribe_eta_seconds": nil,
				"transcribe_error":       nil,
				"transcribe_version":     1,
			})
			if err := d.Transcribe.EnqueueTranscribe(libStr, fileStr); err != nil {
				log.Printf("failed to enqueue transcribe for ingest %s: %v", fileID, err)
			}
		}

		if d.AudioDetect != nil {
			queued := "queued"
			zero := 0
			s.db.Model(&models.File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
				"audio_detect_status":      queued,
				"audio_detect_progress":    zero,
				"audio_detect_eta_seconds": nil,
				"audio_detect_error":       nil,
				"audio_detect_version":     1,
			})
			if err := d.AudioDetect.EnqueueDetect(libStr, fileStr); err != nil {
				log.Printf("failed to enqueue audio detection for ingest %s: %v", fileID, err)
			}
		}
	}
}

// ctxReader makes an io.Copy cancelable: each Read first checks ctx so a
// canceled/timed-out request aborts a long (multi-GB) transfer promptly.
type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (cr *ctxReader) Read(p []byte) (int, error) {
	if err := cr.ctx.Err(); err != nil {
		return 0, err
	}
	return cr.r.Read(p)
}
