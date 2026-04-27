package audiodetection

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/hibiken/asynq"
)

func TestNewTask_TypeAndPayload(t *testing.T) {
	task, err := newTask(Payload{LibraryID: "lib-1", FileID: "file-1"})
	if err != nil {
		t.Fatalf("newTask: %v", err)
	}
	if task.Type() != TaskTypeAudioDetect {
		t.Fatalf("task type: got %q want %q", task.Type(), TaskTypeAudioDetect)
	}
	var p Payload
	if err := json.Unmarshal(task.Payload(), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.LibraryID != "lib-1" || p.FileID != "file-1" {
		t.Fatalf("payload: got %+v", p)
	}
}

func TestPayloadJSONFieldNames(t *testing.T) {
	b, err := json.Marshal(Payload{LibraryID: "L", FileID: "F"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"libraryId":"L"`, `"fileId":"F"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("payload JSON %s missing %s", b, want)
		}
	}
}

func TestProcessTask_RejectsInvalidPayload(t *testing.T) {
	h := &TaskHandler{}
	bad := asynq.NewTask(TaskTypeAudioDetect, []byte("not json"))
	if err := h.ProcessTask(context.Background(), bad); err == nil {
		t.Fatal("expected error for invalid payload, got nil")
	}
}

func TestEnqueueDetect_DedupsConcurrentRequests(t *testing.T) {
	// Reproduces the houston bug: a duplicate enqueue (double-clicked
	// "detect" button or two pods racing) MUST NOT spawn a second worker
	// pass that competes with the first on audio_detect_progress
	// updates and races the final DELETE+INSERT transaction.
	mr := miniredis.RunT(t)
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: mr.Addr()})
	defer client.Close()

	svc := &Service{asynqClient: client}

	if err := svc.EnqueueDetect("lib-1", "file-1"); err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	if err := svc.EnqueueDetect("lib-1", "file-1"); err != nil {
		t.Fatalf("duplicate enqueue should be swallowed, got: %v", err)
	}
	// Different file is independent — must enqueue.
	if err := svc.EnqueueDetect("lib-1", "file-2"); err != nil {
		t.Fatalf("different file enqueue: %v", err)
	}

	// Sanity: bare client without dedup option would surface
	// ErrDuplicateTask. Confirm the underlying option is what gates this,
	// not some other code path that silently accepts everything.
	task, _ := newTask(Payload{LibraryID: "lib-1", FileID: "file-1"})
	_, err := client.Enqueue(task, asynq.Unique(enqueueUniqueWindow))
	if !errors.Is(err, asynq.ErrDuplicateTask) {
		t.Fatalf("expected asynq.ErrDuplicateTask from raw client, got: %v", err)
	}
}
