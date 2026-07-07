// Package docs implements Live Documents: realtime collaborative markdown
// backed by Yjs CRDT state.
//
// The server never interprets Yjs data. Updates are opaque binary blobs in an
// append-only per-document log with a dense sequence (gap = loss, which
// clients detect and replay over HTTP). Compaction is client-computed: an
// editing client posts a merged snapshot (Y.encodeStateAsUpdate) plus the
// current markdown text, and the server folds the log into the snapshot and
// materializes the text into the file blob so downloads stay real.
package docs

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
)

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrFileNotFound   = errors.New("file not found")
	ErrNotMarkdown    = errors.New("file is not a markdown document")
	ErrTrashed        = errors.New("file is in the trash")
	ErrNotInitialized = errors.New("document not initialized")
	ErrStaleSnapshot  = errors.New("snapshot is stale")
	ErrTooLarge       = errors.New("payload exceeds size limit")
	ErrEmptyUpdate    = errors.New("update must not be empty")
)

// Publisher broadcasts committed document events to connected clients.
// Implemented by the realtime layer (Hub/Bus); a nil Publisher disables
// realtime fan-out (worker mode, stdio MCP, tests) without affecting
// correctness — clients converge via HTTP replay, and a reset is discovered
// on the next append/replay (409 → client resync).
type Publisher interface {
	PublishUpdate(fileID uuid.UUID, seq int64, data []byte)
	// PublishReset tells connected clients the document was replaced by a
	// non-CRDT writer (e.g. MCP) and they must discard local state and resync.
	PublishReset(fileID uuid.UUID)
}

// HashEnqueuer re-hashes a file after its blob is rewritten (dedup freshness).
// Satisfied by *filehash.Service; nil skips re-hashing.
type HashEnqueuer interface {
	EnqueueFileHash(libraryID, fileID string) error
}

// Service owns document CRDT state: the update log, snapshots, and
// materialization of markdown text into the file blob.
type Service struct {
	db        *gorm.DB
	storage   *storage.Service
	hash      HashEnqueuer
	publisher Publisher
}

func NewService(db *gorm.DB, storageSvc *storage.Service, hash HashEnqueuer, publisher Publisher) *Service {
	return &Service{db: db, storage: storageSvc, hash: hash, publisher: publisher}
}

// UpdateItem is one opaque Yjs update for replay.
type UpdateItem struct {
	Seq  int64
	Data []byte
}

// State is a document's full sync state (or, when Exists is false, the raw
// markdown text the client should seed a fresh Y.Doc from).
type State struct {
	Exists      bool
	Seq         int64
	SnapshotSeq int64
	Snapshot    []byte
	Updates     []UpdateItem
	HasMore     bool
	Text        string
}

// UpdatesPage is a replay page from ListUpdates.
type UpdatesPage struct {
	Seq     int64
	Updates []UpdateItem
	HasMore bool
}

// loadEligibleFile fetches the file scoped to the library and verifies it is
// a markdown document. Library access itself is the middleware's job; this
// guards file∈library and eligibility.
func (s *Service) loadEligibleFile(ctx context.Context, libraryID, fileID uuid.UUID) (*models.File, error) {
	var file models.File
	err := s.db.WithContext(ctx).
		Where("id = ? AND library_id = ?", fileID, libraryID).
		First(&file).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrFileNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load file: %w", err)
	}
	if !isMarkdown(&file) {
		return nil, ErrNotMarkdown
	}
	return &file, nil
}

// isMarkdown reports whether a file is live-document eligible. The name
// fallback covers markdown uploaded as application/octet-stream.
func isMarkdown(f *models.File) bool {
	if f.MimeType == "text/markdown" {
		return true
	}
	name := strings.ToLower(f.Name)
	return strings.HasSuffix(name, ".md") || strings.HasSuffix(name, ".markdown")
}

// GetState returns the document's sync state. For an eligible file with no
// document row it returns Exists=false plus the current blob text so the
// client can seed a Y.Doc (see Init).
func (s *Service) GetState(ctx context.Context, libraryID, fileID uuid.UUID) (*State, error) {
	file, err := s.loadEligibleFile(ctx, libraryID, fileID)
	if err != nil {
		return nil, err
	}

	var doc models.Document
	err = s.db.WithContext(ctx).Where("file_id = ?", fileID).First(&doc).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if file.Size > MaxTextBytes {
			return nil, ErrTooLarge
		}
		text, readErr := s.storage.ReadFileBuffer(libraryID.String(), fileID.String())
		if readErr != nil {
			// A missing blob (e.g. freshly created empty doc) seeds as empty.
			text = nil
		}
		if len(text) > MaxTextBytes {
			return nil, ErrTooLarge
		}
		return &State{Exists: false, Text: string(text)}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load document: %w", err)
	}

	updates, hasMore, err := s.listUpdatesSince(ctx, fileID, doc.SnapshotSeq)
	if err != nil {
		return nil, err
	}
	return &State{
		Exists:      true,
		Seq:         doc.LastSeq,
		SnapshotSeq: doc.SnapshotSeq,
		Snapshot:    doc.Snapshot,
		Updates:     updates,
		HasMore:     hasMore,
	}, nil
}

// Init seeds the document exactly once with the client-built first update.
// When another client won the race, conflicted is true and state carries the
// winner's full sync state so the caller can discard its local doc.
func (s *Service) Init(ctx context.Context, libraryID, fileID, authorID uuid.UUID, firstUpdate []byte) (conflicted bool, state *State, err error) {
	if len(firstUpdate) == 0 {
		return false, nil, ErrEmptyUpdate
	}
	if len(firstUpdate) > MaxUpdateBytes {
		return false, nil, ErrTooLarge
	}
	file, err := s.loadEligibleFile(ctx, libraryID, fileID)
	if err != nil {
		return false, nil, err
	}
	if file.TrashedAt != nil {
		return false, nil, ErrTrashed
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// A concurrent Init blocks here until the winner commits, then sees
		// RowsAffected == 0 (Postgres READ COMMITTED takes a fresh snapshot
		// per statement), so exactly one seed ever lands.
		res := tx.Exec(
			`INSERT INTO documents (file_id, library_id, last_seq) VALUES (?, ?, 1)
			 ON CONFLICT (file_id) DO NOTHING`,
			fileID, libraryID,
		)
		if res.Error != nil {
			return fmt.Errorf("insert document: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			conflicted = true
			return nil
		}
		update := models.DocumentUpdate{FileID: fileID, Seq: 1, Data: firstUpdate, AuthorID: &authorID}
		if err := tx.Create(&update).Error; err != nil {
			return fmt.Errorf("insert first update: %w", err)
		}
		return nil
	})
	if err != nil {
		return false, nil, err
	}

	if conflicted {
		winner, err := s.GetState(ctx, libraryID, fileID)
		if err != nil {
			return true, nil, err
		}
		return true, winner, nil
	}

	if s.publisher != nil {
		s.publisher.PublishUpdate(fileID, 1, firstUpdate)
	}
	return false, nil, nil
}

// AppendUpdate appends one opaque update, assigning the next dense sequence
// under the document row lock, and relays it to connected clients.
func (s *Service) AppendUpdate(ctx context.Context, libraryID, fileID, authorID uuid.UUID, data []byte) (int64, error) {
	if len(data) == 0 {
		return 0, ErrEmptyUpdate
	}
	if len(data) > MaxUpdateBytes {
		return 0, ErrTooLarge
	}
	file, err := s.loadEligibleFile(ctx, libraryID, fileID)
	if err != nil {
		return 0, err
	}
	if file.TrashedAt != nil {
		return 0, ErrTrashed
	}

	var seq int64
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var doc models.Document
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("file_id = ?", fileID).
			First(&doc).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotInitialized
		}
		if err != nil {
			return fmt.Errorf("lock document: %w", err)
		}

		seq = doc.LastSeq + 1
		update := models.DocumentUpdate{FileID: fileID, Seq: seq, Data: data, AuthorID: &authorID}
		if err := tx.Create(&update).Error; err != nil {
			return fmt.Errorf("insert update: %w", err)
		}
		return tx.Model(&models.Document{}).
			Where("file_id = ?", fileID).
			Updates(map[string]any{"last_seq": seq, "updated_at": time.Now()}).Error
	})
	if err != nil {
		return 0, err
	}

	if s.publisher != nil {
		s.publisher.PublishUpdate(fileID, seq, data)
	}
	return seq, nil
}

// HeadSeq returns the document's current sequence (0 when unseeded) after
// verifying the file is a live-document-eligible member of the library. Used
// for the WebSocket hello frame.
func (s *Service) HeadSeq(ctx context.Context, libraryID, fileID uuid.UUID) (int64, error) {
	if _, err := s.loadEligibleFile(ctx, libraryID, fileID); err != nil {
		return 0, err
	}
	var doc models.Document
	err := s.db.WithContext(ctx).Select("last_seq").Where("file_id = ?", fileID).First(&doc).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("load document: %w", err)
	}
	return doc.LastSeq, nil
}

// ListUpdates returns a replay page of updates with seq > since.
func (s *Service) ListUpdates(ctx context.Context, libraryID, fileID uuid.UUID, since int64) (*UpdatesPage, error) {
	if _, err := s.loadEligibleFile(ctx, libraryID, fileID); err != nil {
		return nil, err
	}
	var doc models.Document
	err := s.db.WithContext(ctx).Where("file_id = ?", fileID).First(&doc).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotInitialized
	}
	if err != nil {
		return nil, fmt.Errorf("load document: %w", err)
	}

	updates, hasMore, err := s.listUpdatesSince(ctx, fileID, since)
	if err != nil {
		return nil, err
	}
	return &UpdatesPage{Seq: doc.LastSeq, Updates: updates, HasMore: hasMore}, nil
}

func (s *Service) listUpdatesSince(ctx context.Context, fileID uuid.UUID, since int64) ([]UpdateItem, bool, error) {
	var rows []models.DocumentUpdate
	err := s.db.WithContext(ctx).
		Where("file_id = ? AND seq > ?", fileID, since).
		Order("seq ASC").
		Limit(MaxReplayPage + 1).
		Find(&rows).Error
	if err != nil {
		return nil, false, fmt.Errorf("list updates: %w", err)
	}
	hasMore := len(rows) > MaxReplayPage
	if hasMore {
		rows = rows[:MaxReplayPage]
	}
	items := make([]UpdateItem, len(rows))
	for i, r := range rows {
		items[i] = UpdateItem{Seq: r.Seq, Data: r.Data}
	}
	return items, hasMore, nil
}

// Compact stores a client-computed snapshot covering everything up to upTo,
// prunes the folded updates, and materializes the markdown text into the file
// blob. The guarded UPDATE makes concurrent/stale compactions atomic no-ops
// (mirrors the momentexport version guard).
func (s *Service) Compact(ctx context.Context, libraryID, fileID uuid.UUID, snapshot []byte, upTo int64, text string) error {
	if len(snapshot) == 0 {
		return ErrEmptyUpdate
	}
	if len(snapshot) > MaxSnapshotBytes || len(text) > MaxTextBytes {
		return ErrTooLarge
	}
	if upTo < 1 {
		return ErrStaleSnapshot
	}
	file, err := s.loadEligibleFile(ctx, libraryID, fileID)
	if err != nil {
		return err
	}
	if file.TrashedAt != nil {
		return ErrTrashed
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The guarded UPDATE takes a row lock on the documents row for the
		// duration of the tx. That serializes concurrent compactions (and
		// appends) so the blob write below happens in snapshot_seq order —
		// the higher upTo always materializes last (see M1).
		res := tx.Model(&models.Document{}).
			Where("file_id = ? AND snapshot_seq < ? AND last_seq >= ?", fileID, upTo, upTo).
			Updates(map[string]any{
				"snapshot":     snapshot,
				"snapshot_seq": upTo,
				"updated_at":   time.Now(),
			})
		if res.Error != nil {
			return fmt.Errorf("store snapshot: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			// Missing doc row, an upTo beyond last_seq, or a newer snapshot
			// already in place — all benign for the caller.
			return ErrStaleSnapshot
		}
		if err := tx.Where("file_id = ? AND seq <= ?", fileID, upTo).
			Delete(&models.DocumentUpdate{}).Error; err != nil {
			return fmt.Errorf("prune updates: %w", err)
		}
		// Materialize inside the tx while holding the row lock. If the blob
		// write fails the whole compaction rolls back (snapshot + prune),
		// leaving the CRDT log intact for the next attempt — stronger than a
		// best-effort after-commit write.
		return s.writeBlobTx(tx, libraryID, fileID, text)
	})
	if err != nil {
		return err
	}

	s.enqueueRehash(libraryID, fileID)
	return nil
}

// writeBlobTx materializes the markdown into the file blob and updates the
// file row's size/updated_at within the given transaction. Storage I/O is
// not transactional, but running it under the caller's row lock (and rolling
// the DB changes back on failure) keeps the blob ordered against concurrent
// writers to the same document.
func (s *Service) writeBlobTx(tx *gorm.DB, libraryID, fileID uuid.UUID, text string) error {
	if err := s.storage.StoreFile(libraryID.String(), fileID.String(), []byte(text)); err != nil {
		return fmt.Errorf("materialize blob: %w", err)
	}
	if err := tx.Model(&models.File{}).
		Where("id = ?", fileID).
		Updates(map[string]any{"size": int64(len(text)), "updated_at": time.Now()}).Error; err != nil {
		return fmt.Errorf("update file size: %w", err)
	}
	return nil
}

// enqueueRehash refreshes the dedup hash after a blob rewrite (best-effort;
// never fails the already-committed write). Runs after commit so a rolled-back
// tx never orphans a queued job.
func (s *Service) enqueueRehash(libraryID, fileID uuid.UUID) {
	if s.hash == nil {
		return
	}
	if err := s.hash.EnqueueFileHash(libraryID.String(), fileID.String()); err != nil {
		log.Printf("docs: enqueue rehash for %s: %v", fileID, err)
	}
}

// ReplaceContent overwrites a document's markdown wholesale on behalf of a
// non-CRDT writer (the MCP document tools). The server cannot merge into Yjs
// state, so in one transaction — holding the documents row lock so it is
// ordered against concurrent compactions/appends — it materializes the new
// blob, then drops the CRDT sidecar (update log + doc row) so the next open
// re-seeds from the new blob. Connected clients are told to resync via a reset
// frame; without realtime they discover it on their next append/replay (409).
//
// The blob write happens BEFORE the drop (and fails the whole op on error), so
// the new content is never lost: a client opening in the gap either still sees
// the (about-to-reset) CRDT or re-seeds from the already-written new blob.
func (s *Service) ReplaceContent(ctx context.Context, libraryID, fileID uuid.UUID, text string) error {
	if len(text) > MaxTextBytes {
		return ErrTooLarge
	}
	file, err := s.loadEligibleFile(ctx, libraryID, fileID)
	if err != nil {
		return err
	}
	if file.TrashedAt != nil {
		return ErrTrashed
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Lock the documents row if it exists, serializing against a
		// concurrent compaction or append so our blob write lands last.
		var doc models.Document
		lockErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("file_id = ?", fileID).First(&doc).Error
		if lockErr != nil && !errors.Is(lockErr, gorm.ErrRecordNotFound) {
			return fmt.Errorf("lock document: %w", lockErr)
		}
		hasCRDT := lockErr == nil

		if err := s.writeBlobTx(tx, libraryID, fileID, text); err != nil {
			return err
		}
		if hasCRDT {
			if err := tx.Where("file_id = ?", fileID).Delete(&models.DocumentUpdate{}).Error; err != nil {
				return fmt.Errorf("drop update log: %w", err)
			}
			if err := tx.Where("file_id = ?", fileID).Delete(&models.Document{}).Error; err != nil {
				return fmt.Errorf("drop document row: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}

	s.enqueueRehash(libraryID, fileID)
	if s.publisher != nil {
		s.publisher.PublishReset(fileID)
	}
	return nil
}
