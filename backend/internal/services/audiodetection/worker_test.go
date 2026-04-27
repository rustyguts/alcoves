package audiodetection

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

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
