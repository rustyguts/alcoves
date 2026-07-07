package docs

import (
	"bytes"
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/services/storage"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func docsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_docs")
	if err := db.AutoMigrate(
		&models.User{}, &models.Library{}, &models.File{},
		&models.Document{}, &models.DocumentUpdate{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users, libraries, files, documents, document_updates RESTART IDENTITY CASCADE")
	return db
}

func newTestStorage(t *testing.T) *storage.Service {
	t.Helper()
	st := storage.NewService(storage.NewLocalDriver(t.TempDir(), t.TempDir(), t.TempDir()))
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("storage EnsureReady: %v", err)
	}
	return st
}

func mustUser(t *testing.T, db *gorm.DB, name string) models.User {
	t.Helper()
	u := models.User{Email: name + "@example.com", DisplayName: name, Role: "member"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func mustLibrary(t *testing.T, db *gorm.DB, ownerID uuid.UUID, name string) models.Library {
	t.Helper()
	lib := models.Library{Name: name, OwnerID: ownerID}
	if err := db.Create(&lib).Error; err != nil {
		t.Fatalf("create library: %v", err)
	}
	return lib
}

func mustMarkdownFile(t *testing.T, db *gorm.DB, lib models.Library, name string) models.File {
	t.Helper()
	f := models.File{LibraryID: lib.ID, Name: name, MimeType: "text/markdown"}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	return f
}

type publishedEvent struct {
	fileID uuid.UUID
	seq    int64
	data   []byte
}

type fakePublisher struct {
	mu     sync.Mutex
	events []publishedEvent
}

func (p *fakePublisher) PublishUpdate(fileID uuid.UUID, seq int64, data []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, publishedEvent{fileID, seq, data})
}

func (p *fakePublisher) PublishReset(fileID uuid.UUID) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, publishedEvent{fileID: fileID, seq: -1})
}

func (p *fakePublisher) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.events)
}

type fakeHasher struct {
	mu    sync.Mutex
	calls []string
}

func (h *fakeHasher) EnqueueFileHash(libraryID, fileID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.calls = append(h.calls, fileID)
	return nil
}

func TestGetState_UnseededReturnsBlobText(t *testing.T) {
	db := docsTestDB(t)
	st := newTestStorage(t)
	svc := NewService(db, st, nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")
	if err := st.StoreFile(lib.ID.String(), file.ID.String(), []byte("# Hello")); err != nil {
		t.Fatalf("store blob: %v", err)
	}

	state, err := svc.GetState(context.Background(), lib.ID, file.ID)
	if err != nil {
		t.Fatalf("GetState: %v", err)
	}
	if state.Exists {
		t.Fatal("expected Exists=false for unseeded doc")
	}
	if state.Text != "# Hello" {
		t.Fatalf("Text = %q, want %q", state.Text, "# Hello")
	}
}

func TestGetState_MissingBlobSeedsEmpty(t *testing.T) {
	db := docsTestDB(t)
	svc := NewService(db, newTestStorage(t), nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "empty.md")

	state, err := svc.GetState(context.Background(), lib.ID, file.ID)
	if err != nil {
		t.Fatalf("GetState: %v", err)
	}
	if state.Exists || state.Text != "" {
		t.Fatalf("expected empty unseeded state, got exists=%v text=%q", state.Exists, state.Text)
	}
}

func TestGetState_EligibilityAndScoping(t *testing.T) {
	db := docsTestDB(t)
	svc := NewService(db, newTestStorage(t), nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	otherLib := mustLibrary(t, db, owner.ID, "M")

	png := models.File{LibraryID: lib.ID, Name: "photo.png", MimeType: "image/png"}
	if err := db.Create(&png).Error; err != nil {
		t.Fatalf("create png: %v", err)
	}
	if _, err := svc.GetState(context.Background(), lib.ID, png.ID); err != ErrNotMarkdown {
		t.Fatalf("png GetState err = %v, want ErrNotMarkdown", err)
	}

	// Name-based fallback: octet-stream .md is eligible.
	blob := models.File{LibraryID: lib.ID, Name: "Readme.MD", MimeType: "application/octet-stream"}
	if err := db.Create(&blob).Error; err != nil {
		t.Fatalf("create blob file: %v", err)
	}
	if _, err := svc.GetState(context.Background(), lib.ID, blob.ID); err != nil {
		t.Fatalf(".md octet-stream should be eligible, got %v", err)
	}

	md := mustMarkdownFile(t, db, lib, "notes.md")
	if _, err := svc.GetState(context.Background(), otherLib.ID, md.ID); err != ErrFileNotFound {
		t.Fatalf("cross-library GetState err = %v, want ErrFileNotFound", err)
	}
}

func TestInit_AppendGetRoundtrip(t *testing.T) {
	db := docsTestDB(t)
	pub := &fakePublisher{}
	svc := NewService(db, newTestStorage(t), nil, pub)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")

	conflicted, _, err := svc.Init(context.Background(), lib.ID, file.ID, owner.ID, []byte{1, 2, 3})
	if err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}

	seq, err := svc.AppendUpdate(context.Background(), lib.ID, file.ID, owner.ID, []byte{4, 5})
	if err != nil || seq != 2 {
		t.Fatalf("AppendUpdate: seq=%d err=%v, want seq=2", seq, err)
	}
	seq, err = svc.AppendUpdate(context.Background(), lib.ID, file.ID, owner.ID, []byte{6})
	if err != nil || seq != 3 {
		t.Fatalf("AppendUpdate: seq=%d err=%v, want seq=3", seq, err)
	}

	state, err := svc.GetState(context.Background(), lib.ID, file.ID)
	if err != nil {
		t.Fatalf("GetState: %v", err)
	}
	if !state.Exists || state.Seq != 3 || state.SnapshotSeq != 0 || state.Snapshot != nil {
		t.Fatalf("state = %+v, want exists seq=3 snapshotSeq=0 nil snapshot", state)
	}
	if len(state.Updates) != 3 || state.Updates[0].Seq != 1 || state.Updates[2].Seq != 3 {
		t.Fatalf("updates = %+v, want seqs 1..3", state.Updates)
	}
	if !bytes.Equal(state.Updates[1].Data, []byte{4, 5}) {
		t.Fatalf("update 2 data = %v", state.Updates[1].Data)
	}
	if pub.count() != 3 {
		t.Fatalf("publisher events = %d, want 3 (init + 2 appends)", pub.count())
	}

	page, err := svc.ListUpdates(context.Background(), lib.ID, file.ID, 1)
	if err != nil {
		t.Fatalf("ListUpdates: %v", err)
	}
	if page.Seq != 3 || len(page.Updates) != 2 || page.Updates[0].Seq != 2 || page.HasMore {
		t.Fatalf("page = %+v, want seq=3 updates 2..3 hasMore=false", page)
	}
}

func TestInit_RaceExactlyOneWinner(t *testing.T) {
	db := docsTestDB(t)
	svc := NewService(db, newTestStorage(t), nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "race.md")

	const racers = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	winners := 0
	for i := range racers {
		wg.Go(func() {
			conflicted, state, err := svc.Init(context.Background(), lib.ID, file.ID, owner.ID, []byte{byte(i + 1)})
			if err != nil {
				t.Errorf("Init: %v", err)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			if !conflicted {
				winners++
			} else if state == nil || !state.Exists || state.Seq < 1 {
				t.Errorf("loser got invalid winner state: %+v", state)
			}
		})
	}
	wg.Wait()
	if winners != 1 {
		t.Fatalf("winners = %d, want exactly 1", winners)
	}

	var count int64
	db.Model(&models.DocumentUpdate{}).Where("file_id = ?", file.ID).Count(&count)
	if count != 1 {
		t.Fatalf("update rows = %d, want 1", count)
	}
}

func TestAppend_ConcurrentDenseSeq(t *testing.T) {
	db := docsTestDB(t)
	svc := NewService(db, newTestStorage(t), nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "dense.md")

	if conflicted, _, err := svc.Init(context.Background(), lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}

	const writers, perWriter = 10, 10
	var wg sync.WaitGroup
	var mu sync.Mutex
	seen := map[int64]bool{}
	for range writers {
		wg.Go(func() {
			for range perWriter {
				seq, err := svc.AppendUpdate(context.Background(), lib.ID, file.ID, owner.ID, []byte{9})
				if err != nil {
					t.Errorf("AppendUpdate: %v", err)
					return
				}
				mu.Lock()
				if seen[seq] {
					t.Errorf("duplicate seq %d", seq)
				}
				seen[seq] = true
				mu.Unlock()
			}
		})
	}
	wg.Wait()

	// Init used seq 1; concurrent appends must fill 2..101 densely.
	if len(seen) != writers*perWriter {
		t.Fatalf("distinct seqs = %d, want %d", len(seen), writers*perWriter)
	}
	for s := int64(2); s <= int64(writers*perWriter+1); s++ {
		if !seen[s] {
			t.Fatalf("missing seq %d — sequence not dense", s)
		}
	}
}

func TestAppend_RequiresInitAndRespectsTrash(t *testing.T) {
	db := docsTestDB(t)
	svc := NewService(db, newTestStorage(t), nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")

	if _, err := svc.AppendUpdate(context.Background(), lib.ID, file.ID, owner.ID, []byte{1}); err != ErrNotInitialized {
		t.Fatalf("append before init err = %v, want ErrNotInitialized", err)
	}

	if conflicted, _, err := svc.Init(context.Background(), lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}

	now := time.Now()
	if err := db.Model(&models.File{}).Where("id = ?", file.ID).Update("trashed_at", &now).Error; err != nil {
		t.Fatalf("trash file: %v", err)
	}
	if _, err := svc.AppendUpdate(context.Background(), lib.ID, file.ID, owner.ID, []byte{2}); err != ErrTrashed {
		t.Fatalf("append on trashed err = %v, want ErrTrashed", err)
	}
	if err := svc.Compact(context.Background(), lib.ID, file.ID, []byte{1}, 1, "x"); err != ErrTrashed {
		t.Fatalf("compact on trashed err = %v, want ErrTrashed", err)
	}
	// Reads stay open while trashed.
	if _, err := svc.GetState(context.Background(), lib.ID, file.ID); err != nil {
		t.Fatalf("GetState on trashed: %v", err)
	}
}

func TestCompact_PrunesMaterializesAndGuards(t *testing.T) {
	db := docsTestDB(t)
	st := newTestStorage(t)
	hasher := &fakeHasher{}
	svc := NewService(db, st, hasher, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")

	ctx := context.Background()
	if conflicted, _, err := svc.Init(ctx, lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}
	for i := range 3 {
		if _, err := svc.AppendUpdate(ctx, lib.ID, file.ID, owner.ID, []byte{byte(i)}); err != nil {
			t.Fatalf("AppendUpdate: %v", err)
		}
	}

	snapshot := []byte{0xAA, 0xBB}
	if err := svc.Compact(ctx, lib.ID, file.ID, snapshot, 4, "# Compacted"); err != nil {
		t.Fatalf("Compact: %v", err)
	}

	var doc models.Document
	if err := db.Where("file_id = ?", file.ID).First(&doc).Error; err != nil {
		t.Fatalf("load doc: %v", err)
	}
	if doc.SnapshotSeq != 4 || !bytes.Equal(doc.Snapshot, snapshot) {
		t.Fatalf("doc = snapshotSeq=%d snapshot=%v, want 4/%v", doc.SnapshotSeq, doc.Snapshot, snapshot)
	}
	var remaining int64
	db.Model(&models.DocumentUpdate{}).Where("file_id = ?", file.ID).Count(&remaining)
	if remaining != 0 {
		t.Fatalf("remaining updates = %d, want 0", remaining)
	}

	blob, err := st.ReadFileBuffer(lib.ID.String(), file.ID.String())
	if err != nil || string(blob) != "# Compacted" {
		t.Fatalf("materialized blob = %q err=%v", blob, err)
	}
	var freshFile models.File
	if err := db.Where("id = ?", file.ID).First(&freshFile).Error; err != nil {
		t.Fatalf("reload file: %v", err)
	}
	if freshFile.Size != int64(len("# Compacted")) {
		t.Fatalf("file size = %d, want %d", freshFile.Size, len("# Compacted"))
	}
	if len(hasher.calls) != 1 || hasher.calls[0] != file.ID.String() {
		t.Fatalf("hash enqueues = %v, want one for file", hasher.calls)
	}

	// Stale retry (same upTo) and upTo beyond last_seq are guarded no-ops.
	if err := svc.Compact(ctx, lib.ID, file.ID, snapshot, 4, "x"); err != ErrStaleSnapshot {
		t.Fatalf("stale compact err = %v, want ErrStaleSnapshot", err)
	}
	if err := svc.Compact(ctx, lib.ID, file.ID, snapshot, 99, "x"); err != ErrStaleSnapshot {
		t.Fatalf("future compact err = %v, want ErrStaleSnapshot", err)
	}

	// GetState after compaction: snapshot + no updates.
	state, err := svc.GetState(ctx, lib.ID, file.ID)
	if err != nil {
		t.Fatalf("GetState: %v", err)
	}
	if !state.Exists || state.Seq != 4 || state.SnapshotSeq != 4 || len(state.Updates) != 0 {
		t.Fatalf("post-compact state = %+v", state)
	}

	// New appends after compaction continue the sequence and replay works.
	seq, err := svc.AppendUpdate(ctx, lib.ID, file.ID, owner.ID, []byte{7})
	if err != nil || seq != 5 {
		t.Fatalf("append after compact seq=%d err=%v, want 5", seq, err)
	}
	page, err := svc.ListUpdates(ctx, lib.ID, file.ID, 4)
	if err != nil || len(page.Updates) != 1 || page.Updates[0].Seq != 5 {
		t.Fatalf("replay after compact = %+v err=%v", page, err)
	}
}

func TestListUpdates_Paging(t *testing.T) {
	db := docsTestDB(t)
	svc := NewService(db, newTestStorage(t), nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "big.md")

	// Seed the log directly — appending MaxReplayPage+1 times through the
	// service would be needlessly slow here.
	if err := db.Create(&models.Document{FileID: file.ID, LibraryID: lib.ID, LastSeq: MaxReplayPage + 1}).Error; err != nil {
		t.Fatalf("create doc: %v", err)
	}
	rows := make([]models.DocumentUpdate, MaxReplayPage+1)
	for i := range rows {
		rows[i] = models.DocumentUpdate{FileID: file.ID, Seq: int64(i + 1), Data: []byte{1}}
	}
	if err := db.CreateInBatches(rows, 200).Error; err != nil {
		t.Fatalf("bulk insert: %v", err)
	}

	page, err := svc.ListUpdates(context.Background(), lib.ID, file.ID, 0)
	if err != nil {
		t.Fatalf("ListUpdates: %v", err)
	}
	if len(page.Updates) != MaxReplayPage || !page.HasMore {
		t.Fatalf("page1 = %d updates hasMore=%v, want %d/true", len(page.Updates), page.HasMore, MaxReplayPage)
	}
	page2, err := svc.ListUpdates(context.Background(), lib.ID, file.ID, page.Updates[len(page.Updates)-1].Seq)
	if err != nil {
		t.Fatalf("ListUpdates page2: %v", err)
	}
	if len(page2.Updates) != 1 || page2.HasMore {
		t.Fatalf("page2 = %d updates hasMore=%v, want 1/false", len(page2.Updates), page2.HasMore)
	}
}

func TestValidation_SizesAndEmpty(t *testing.T) {
	db := docsTestDB(t)
	svc := NewService(db, newTestStorage(t), nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")
	ctx := context.Background()

	if _, _, err := svc.Init(ctx, lib.ID, file.ID, owner.ID, nil); err != ErrEmptyUpdate {
		t.Fatalf("empty init err = %v, want ErrEmptyUpdate", err)
	}
	big := make([]byte, MaxUpdateBytes+1)
	if _, _, err := svc.Init(ctx, lib.ID, file.ID, owner.ID, big); err != ErrTooLarge {
		t.Fatalf("oversize init err = %v, want ErrTooLarge", err)
	}
	if _, err := svc.AppendUpdate(ctx, lib.ID, file.ID, owner.ID, big); err != ErrTooLarge {
		t.Fatalf("oversize append err = %v, want ErrTooLarge", err)
	}
	if err := svc.Compact(ctx, lib.ID, file.ID, []byte{1}, 0, "x"); err != ErrStaleSnapshot {
		t.Fatalf("compact upTo=0 err = %v, want ErrStaleSnapshot", err)
	}
}

func TestReplaceContent_ResetsCRDTAndMaterializes(t *testing.T) {
	db := docsTestDB(t)
	st := newTestStorage(t)
	pub := &fakePublisher{}
	hasher := &fakeHasher{}
	svc := NewService(db, st, hasher, pub)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")
	ctx := context.Background()

	if conflicted, _, err := svc.Init(ctx, lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}
	if _, err := svc.AppendUpdate(ctx, lib.ID, file.ID, owner.ID, []byte{2}); err != nil {
		t.Fatalf("AppendUpdate: %v", err)
	}

	if err := svc.ReplaceContent(ctx, lib.ID, file.ID, "# Replaced by MCP"); err != nil {
		t.Fatalf("ReplaceContent: %v", err)
	}

	// CRDT sidecar is gone; the next GetState is the unseeded path with the
	// new text, and a fresh Init restarts the sequence at 1.
	var docCount, updateCount int64
	db.Model(&models.Document{}).Where("file_id = ?", file.ID).Count(&docCount)
	db.Model(&models.DocumentUpdate{}).Where("file_id = ?", file.ID).Count(&updateCount)
	if docCount != 0 || updateCount != 0 {
		t.Fatalf("doc rows = %d, update rows = %d, want 0/0", docCount, updateCount)
	}
	state, err := svc.GetState(ctx, lib.ID, file.ID)
	if err != nil || state.Exists || state.Text != "# Replaced by MCP" {
		t.Fatalf("state = %+v err=%v, want unseeded with replaced text", state, err)
	}
	blob, err := st.ReadFileBuffer(lib.ID.String(), file.ID.String())
	if err != nil || string(blob) != "# Replaced by MCP" {
		t.Fatalf("blob = %q err=%v", blob, err)
	}
	if len(hasher.calls) == 0 {
		t.Fatal("expected a rehash enqueue after replacement")
	}
	// Last published event is the reset marker.
	pub.mu.Lock()
	last := pub.events[len(pub.events)-1]
	pub.mu.Unlock()
	if last.seq != -1 || last.fileID != file.ID {
		t.Fatalf("last publish = %+v, want reset for file", last)
	}

	if conflicted, _, err := svc.Init(ctx, lib.ID, file.ID, owner.ID, []byte{9}); err != nil || conflicted {
		t.Fatalf("re-Init after replace: conflicted=%v err=%v", conflicted, err)
	}
	seq, err := svc.AppendUpdate(ctx, lib.ID, file.ID, owner.ID, []byte{10})
	if err != nil || seq != 2 {
		t.Fatalf("append after re-init seq=%d err=%v, want 2", seq, err)
	}

	// Oversize and trash guards.
	if err := svc.ReplaceContent(ctx, lib.ID, file.ID, string(make([]byte, MaxTextBytes+1))); err != ErrTooLarge {
		t.Fatalf("oversize replace err = %v, want ErrTooLarge", err)
	}
	now := time.Now()
	db.Model(&models.File{}).Where("id = ?", file.ID).Update("trashed_at", &now)
	if err := svc.ReplaceContent(ctx, lib.ID, file.ID, "x"); err != ErrTrashed {
		t.Fatalf("trashed replace err = %v, want ErrTrashed", err)
	}
}

// failingDriver wraps a real driver but fails PutBuffer on demand, to prove
// that a materialization failure rolls the DB changes back (M1/M2).
type failingDriver struct {
	storage.Driver
	failPut bool
}

func (f *failingDriver) PutBuffer(scope storage.Scope, key string, data []byte) error {
	if f.failPut {
		return fmt.Errorf("simulated storage failure")
	}
	return f.Driver.PutBuffer(scope, key, data)
}

func TestCompact_BlobWriteFailureRollsBack(t *testing.T) {
	db := docsTestDB(t)
	fd := &failingDriver{Driver: storage.NewLocalDriver(t.TempDir(), t.TempDir(), t.TempDir())}
	st := storage.NewService(fd)
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	svc := NewService(db, st, nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")
	ctx := context.Background()
	if conflicted, _, err := svc.Init(ctx, lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}
	if _, err := svc.AppendUpdate(ctx, lib.ID, file.ID, owner.ID, []byte{2}); err != nil {
		t.Fatalf("AppendUpdate: %v", err)
	}

	fd.failPut = true
	if err := svc.Compact(ctx, lib.ID, file.ID, []byte{0xAA}, 2, "text"); err == nil {
		t.Fatal("expected Compact to fail when the blob write fails")
	}

	// The snapshot must NOT have been stored and the update log must NOT have
	// been pruned — the whole compaction rolled back.
	var doc models.Document
	if err := db.Where("file_id = ?", file.ID).First(&doc).Error; err != nil {
		t.Fatalf("load doc: %v", err)
	}
	if doc.SnapshotSeq != 0 || doc.Snapshot != nil {
		t.Fatalf("snapshot should be unchanged, got seq=%d", doc.SnapshotSeq)
	}
	var updates int64
	db.Model(&models.DocumentUpdate{}).Where("file_id = ?", file.ID).Count(&updates)
	if updates != 2 {
		t.Fatalf("update log should be intact (2 rows), got %d", updates)
	}
}

func TestReplaceContent_BlobWriteFailureKeepsCRDT(t *testing.T) {
	db := docsTestDB(t)
	fd := &failingDriver{Driver: storage.NewLocalDriver(t.TempDir(), t.TempDir(), t.TempDir())}
	st := storage.NewService(fd)
	if err := st.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	svc := NewService(db, st, nil, nil)

	owner := mustUser(t, db, "owner")
	lib := mustLibrary(t, db, owner.ID, "L")
	file := mustMarkdownFile(t, db, lib, "notes.md")
	ctx := context.Background()
	if conflicted, _, err := svc.Init(ctx, lib.ID, file.ID, owner.ID, []byte{1}); err != nil || conflicted {
		t.Fatalf("Init: conflicted=%v err=%v", conflicted, err)
	}

	fd.failPut = true
	if err := svc.ReplaceContent(ctx, lib.ID, file.ID, "new content"); err == nil {
		t.Fatal("expected ReplaceContent to fail when the blob write fails")
	}

	// The CRDT sidecar must survive — the new content was never lost, the
	// caller just sees a failure (MCP reports it) with the old doc intact.
	var docCount int64
	db.Model(&models.Document{}).Where("file_id = ?", file.ID).Count(&docCount)
	if docCount != 1 {
		t.Fatalf("document row should be intact, got %d", docCount)
	}
}
