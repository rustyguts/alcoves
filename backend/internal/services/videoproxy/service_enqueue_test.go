package videoproxy

import (
	"net"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// newAsynqClient dials the local Dragonfly/Redis used by the dev stack. Tests
// skip if it isn't reachable.
func newAsynqClient(t *testing.T) *asynq.Client {
	t.Helper()
	addr := "localhost:6389"
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		t.Skipf("redis/dragonfly not available at %s: %v", addr, err)
	}
	conn.Close()
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: addr})
	t.Cleanup(func() { client.Close() })
	return client
}

func TestEnqueueVideoProxy(t *testing.T) {
	client := newAsynqClient(t)
	s := NewService(nil, nil, client, nil)
	if err := s.EnqueueVideoProxy("lib-1", "file-1", false); err != nil {
		t.Fatalf("EnqueueVideoProxy: %v", err)
	}
	if err := s.EnqueueVideoProxy("lib-1", "file-2", true); err != nil {
		t.Fatalf("EnqueueVideoProxy force: %v", err)
	}
}

func TestEnqueueVideoThumbnail(t *testing.T) {
	client := newAsynqClient(t)
	s := NewService(nil, nil, client, nil)
	if err := s.EnqueueVideoThumbnail("lib-1", "file-1"); err != nil {
		t.Fatalf("EnqueueVideoThumbnail: %v", err)
	}
}

func TestEnqueueExistingVideoThumbnails(t *testing.T) {
	db := setupTestDB(t)
	client := newAsynqClient(t)
	libID, ownerID := seedLibrary(t, db)

	// Two source videos + one non-video + one derivative (source_file_id set) +
	// one trashed video. Only the two active source videos should be queued.
	v1 := models.File{ID: uuid.New(), LibraryID: libID, Name: "a.mp4", MimeType: "video/mp4", OwnerID: &ownerID}
	v2 := models.File{ID: uuid.New(), LibraryID: libID, Name: "b.mov", MimeType: "video/quicktime", OwnerID: &ownerID}
	doc := models.File{ID: uuid.New(), LibraryID: libID, Name: "c.txt", MimeType: "text/plain", OwnerID: &ownerID}
	deriv := models.File{ID: uuid.New(), LibraryID: libID, Name: "d.mp4", MimeType: "video/mp4", OwnerID: &ownerID, SourceFileID: uuidPtr(v1.ID)}
	trashedAt := time.Now()
	trashed := models.File{ID: uuid.New(), LibraryID: libID, Name: "e.mp4", MimeType: "video/mp4", OwnerID: &ownerID, TrashedAt: &trashedAt}
	for _, f := range []*models.File{&v1, &v2, &doc, &deriv, &trashed} {
		if err := db.Create(f).Error; err != nil {
			t.Fatalf("create file: %v", err)
		}
	}

	s := NewService(db, nil, client, nil)
	queued, err := s.EnqueueExistingVideoThumbnails(libID.String())
	if err != nil {
		t.Fatalf("EnqueueExistingVideoThumbnails: %v", err)
	}
	if queued != 2 {
		t.Fatalf("expected 2 queued, got %d", queued)
	}
}

func TestEnqueueExistingVideoThumbnails_QueryErrorPath(t *testing.T) {
	db := setupTestDB(t)
	client := newAsynqClient(t)
	s := NewService(db, nil, client, nil)
	// Empty library → zero queued, no error.
	queued, err := s.EnqueueExistingVideoThumbnails(uuid.NewString())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if queued != 0 {
		t.Fatalf("expected 0 queued for empty library, got %d", queued)
	}
}
