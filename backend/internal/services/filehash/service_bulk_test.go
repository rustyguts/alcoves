package filehash

import (
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// testRedisOpt isolates these tests on a dedicated Redis logical DB so parallel
// agents sharing the same Dragonfly instance don't interfere with each other.
func testRedisOpt() asynq.RedisClientOpt {
	return asynq.RedisClientOpt{Addr: "localhost:6389", DB: 14}
}

// newAsynqClient returns a connected client or skips when Redis is unreachable.
func newAsynqClient(t *testing.T) *asynq.Client {
	t.Helper()
	client := asynq.NewClient(testRedisOpt())
	// Probe connectivity by enqueuing+removing nothing; asynq is lazy, so issue
	// a ping via the inspector instead.
	insp := asynq.NewInspector(testRedisOpt())
	defer insp.Close()
	if _, err := insp.Queues(); err != nil {
		client.Close()
		t.Skipf("Skipping: redis not available: %v", err)
	}
	t.Cleanup(func() { client.Close() })
	return client
}

// drainQueue removes any pending file:hash tasks left in the isolated DB so the
// shared Dragonfly instance stays clean.
func drainQueue(t *testing.T) {
	t.Helper()
	insp := asynq.NewInspector(testRedisOpt())
	defer insp.Close()
	queues, err := insp.Queues()
	if err != nil {
		return
	}
	for _, q := range queues {
		_, _ = insp.DeleteAllPendingTasks(q)
		_, _ = insp.DeleteAllScheduledTasks(q)
		_, _ = insp.DeleteAllRetryTasks(q)
		_, _ = insp.DeleteAllCompletedTasks(q)
	}
}

func TestEnqueueFileHash(t *testing.T) {
	client := newAsynqClient(t)
	t.Cleanup(func() { drainQueue(t) })

	svc := NewService(nil, nil, client)
	if err := svc.EnqueueFileHash("lib-1", "file-1"); err != nil {
		t.Fatalf("EnqueueFileHash: %v", err)
	}

	// Confirm the task landed in the default queue.
	insp := asynq.NewInspector(testRedisOpt())
	defer insp.Close()
	info, err := insp.GetQueueInfo("default")
	if err != nil {
		t.Fatalf("GetQueueInfo: %v", err)
	}
	if info.Pending < 1 {
		t.Fatalf("expected at least 1 pending task, got %d", info.Pending)
	}
}

func TestNewService_Wiring(t *testing.T) {
	client := newAsynqClient(t)
	t.Cleanup(func() { drainQueue(t) })

	db := setupDedupDB(t)
	st := newLocalStorage(t)
	svc := NewService(db, st, client)
	if svc.db != db || svc.storage != st || svc.asynqClient != client {
		t.Fatal("NewService did not wire all dependencies")
	}

	// NewTaskHandler should yield a handler wired to the same db + storage.
	h := svc.NewTaskHandler()
	if h.db != db || h.storage != st {
		t.Fatal("service.NewTaskHandler did not propagate dependencies")
	}
}

func TestService_EnqueueUnhashedFiles(t *testing.T) {
	client := newAsynqClient(t)
	t.Cleanup(func() { drainQueue(t) })
	drainQueue(t) // start from a clean slate

	db := setupDedupDB(t)
	owner, lib := mkLibrary(t, db)

	// 2 unhashed, active files -> should be enqueued.
	mkFile(t, db, lib, owner, nil, nil, false)
	mkFile(t, db, lib, owner, nil, nil, false)
	// 1 already hashed -> skipped.
	hash := "abc"
	mkFile(t, db, lib, owner, &hash, nil, false)
	// 1 trashed unhashed -> skipped.
	mkFile(t, db, lib, owner, nil, nil, true)

	svc := NewService(db, nil, client)
	n, err := svc.EnqueueUnhashedFiles()
	if err != nil {
		t.Fatalf("EnqueueUnhashedFiles: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 enqueued, got %d", n)
	}
}

func TestEnqueueUnhashedFiles_EmptyDB(t *testing.T) {
	client := newAsynqClient(t)
	t.Cleanup(func() { drainQueue(t) })

	db := setupDedupDB(t)
	// No files at all.
	n, err := EnqueueUnhashedFiles(client, db)
	if err != nil {
		t.Fatalf("EnqueueUnhashedFiles: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 enqueued from empty db, got %d", n)
	}
}

func TestEnqueueUnhashedFiles_OnlyHashedAndTrashed(t *testing.T) {
	client := newAsynqClient(t)
	t.Cleanup(func() { drainQueue(t) })

	db := setupDedupDB(t)
	owner, lib := mkLibrary(t, db)
	hash := "h"
	mkFile(t, db, lib, owner, &hash, nil, false) // hashed -> skip
	mkFile(t, db, lib, owner, nil, nil, true)    // trashed -> skip

	n, err := EnqueueUnhashedFiles(client, db)
	if err != nil {
		t.Fatalf("EnqueueUnhashedFiles: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 enqueued, got %d", n)
	}
}

func TestEnqueueFileHash_EnqueueError(t *testing.T) {
	// A closed client fails to enqueue, exercising the error branch.
	client := asynq.NewClient(testRedisOpt())
	if err := client.Close(); err != nil {
		t.Skipf("Skipping: could not init redis client: %v", err)
	}
	svc := NewService(nil, nil, client)
	if err := svc.EnqueueFileHash("lib-1", "file-1"); err == nil {
		t.Fatal("expected error enqueuing on a closed client")
	}
}

func TestEnqueueUnhashedFiles_EnqueueErrorsContinue(t *testing.T) {
	db := setupDedupDB(t)
	owner, lib := mkLibrary(t, db)
	mkFile(t, db, lib, owner, nil, nil, false)
	mkFile(t, db, lib, owner, nil, nil, false)

	// Closed client -> every Enqueue call fails, the loop logs + continues,
	// and the final count is 0 (no task successfully enqueued).
	client := asynq.NewClient(testRedisOpt())
	if err := client.Close(); err != nil {
		t.Skipf("Skipping: could not init redis client: %v", err)
	}
	n, err := EnqueueUnhashedFiles(client, db)
	if err != nil {
		t.Fatalf("expected nil error (failures are logged + skipped), got %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 enqueued on closed client, got %d", n)
	}
}

func TestEnqueueUnhashedFiles_QueryError(t *testing.T) {
	client := newAsynqClient(t)
	t.Cleanup(func() { drainQueue(t) })

	// A DB whose `files` table does not exist forces the SELECT to error.
	db := setupDedupDB(t)
	if err := db.Migrator().DropTable("files"); err != nil {
		t.Skipf("Skipping: could not drop files table: %v", err)
	}
	t.Cleanup(func() { _ = db.AutoMigrate(&models.File{}) })

	_, err := EnqueueUnhashedFiles(client, db)
	if err == nil {
		t.Fatal("expected error when files table is missing")
	}
}

// reference time + gorm imports so they're considered used across the file.
var _ = time.Hour
var _ = gorm.ErrRecordNotFound
