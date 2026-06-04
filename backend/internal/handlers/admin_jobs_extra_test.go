package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/labstack/echo/v4"
)

func jobsInspector(t *testing.T) *asynq.Inspector {
	t.Helper()
	insp := asynq.NewInspector(asynq.RedisClientOpt{Addr: "localhost:6389"})
	if _, err := insp.Queues(); err != nil {
		t.Skipf("asynq inspector unavailable: %v", err)
	}
	t.Cleanup(func() { _ = insp.Close() })
	return insp
}

// enqueueJob pushes a task to a dedicated queue and returns the queue + task id.
func enqueueJob(t *testing.T, queue string) string {
	t.Helper()
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "localhost:6389"})
	t.Cleanup(func() { _ = client.Close() })
	info, err := client.Enqueue(asynq.NewTask("admintest:job", []byte(`{"hello":"world"}`)), asynq.Queue(queue))
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	return info.ID
}

func jobsCtx(method, body, queue, jobID string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	req := httptest.NewRequest(method, "/", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	names := []string{}
	vals := []string{}
	if queue != "" {
		names = append(names, "queueName")
		vals = append(vals, queue)
	}
	if jobID != "" {
		names = append(names, "jobId")
		vals = append(vals, jobID)
	}
	c.SetParamNames(names...)
	c.SetParamValues(vals...)
	return c, rec
}

func TestAdminJobs_Stats_NilInspector(t *testing.T) {
	h := NewAdminJobsHandler(nil, nil)
	c, rec := jobsCtx(http.MethodGet, "", "", "")
	if err := h.Stats(c); err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAdminJobs_Stats_Real(t *testing.T) {
	insp := jobsInspector(t)
	enqueueJob(t, "admintest")
	h := NewAdminJobsHandler(insp, nil)
	c, rec := jobsCtx(http.MethodGet, "", "", "")
	if err := h.Stats(c); err != nil {
		t.Fatalf("Stats: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if _, ok := resp["queues"]; !ok {
		t.Fatalf("expected queues key")
	}
}

func TestAdminJobs_ListJobs_NilInspector(t *testing.T) {
	h := NewAdminJobsHandler(nil, nil)
	c, rec := jobsCtx(http.MethodGet, "", "admintest", "")
	if err := h.ListJobs(c); err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAdminJobs_ListJobs_Real(t *testing.T) {
	insp := jobsInspector(t)
	enqueueJob(t, "admintestlist")
	h := NewAdminJobsHandler(insp, nil)
	c, rec := jobsCtx(http.MethodGet, "", "admintestlist", "")
	if err := h.ListJobs(c); err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	var jobs []map[string]any
	json.Unmarshal(rec.Body.Bytes(), &jobs)
	if len(jobs) < 1 {
		t.Fatalf("expected >=1 job, got %d", len(jobs))
	}
}

func TestAdminJobs_ControlJob_NilInspector(t *testing.T) {
	h := NewAdminJobsHandler(nil, nil)
	c, _ := jobsCtx(http.MethodPost, `{"action":"remove"}`, "q", "j")
	if httpCode(t, h.ControlJob(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}

func TestAdminJobs_ControlJob_BadBody(t *testing.T) {
	insp := jobsInspector(t)
	h := NewAdminJobsHandler(insp, nil)
	c, _ := jobsCtx(http.MethodPost, `{bad`, "q", "j")
	if httpCode(t, h.ControlJob(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestAdminJobs_ControlJob_UnsupportedAction(t *testing.T) {
	insp := jobsInspector(t)
	h := NewAdminJobsHandler(insp, nil)
	c, _ := jobsCtx(http.MethodPost, `{"action":"frobnicate"}`, "q", "j")
	if httpCode(t, h.ControlJob(c)) != http.StatusBadRequest {
		t.Fatalf("want 400")
	}
}

func TestAdminJobs_ControlJob_Remove(t *testing.T) {
	insp := jobsInspector(t)
	jobID := enqueueJob(t, "admintestremove")
	h := NewAdminJobsHandler(insp, nil)
	c, rec := jobsCtx(http.MethodPost, `{"action":"remove"}`, "admintestremove", jobID)
	if err := h.ControlJob(c); err != nil {
		t.Fatalf("ControlJob remove: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200")
	}
}

func TestAdminJobs_ControlJob_RemoveMissing(t *testing.T) {
	insp := jobsInspector(t)
	h := NewAdminJobsHandler(insp, nil)
	c, _ := jobsCtx(http.MethodPost, `{"action":"retry"}`, "admintestremove", "nonexistent-task-id")
	if httpCode(t, h.ControlJob(c)) != http.StatusBadRequest {
		t.Fatalf("want 400 for missing task")
	}
}

func TestAdminJobs_PurgeQueue_NilInspector(t *testing.T) {
	h := NewAdminJobsHandler(nil, nil)
	c, _ := jobsCtx(http.MethodPost, "", "q", "")
	if httpCode(t, h.PurgeQueue(c)) != http.StatusServiceUnavailable {
		t.Fatalf("want 503")
	}
}

func TestAdminJobs_PurgeQueue_Real(t *testing.T) {
	insp := jobsInspector(t)
	enqueueJob(t, "admintestpurge")
	h := NewAdminJobsHandler(insp, nil)
	c, rec := jobsCtx(http.MethodPost, "", "admintestpurge", "")
	if err := h.PurgeQueue(c); err != nil {
		t.Fatalf("PurgeQueue: %v", err)
	}
	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["ok"] != true {
		t.Fatalf("expected ok true")
	}
}

func TestAdminJobs_Stream_NilInspector(t *testing.T) {
	h := NewAdminJobsHandler(nil, nil)
	c, rec := jobsCtx(http.MethodGet, "", "", "")
	if err := h.Stream(c); err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if !strings.Contains(rec.Body.String(), "queues") {
		t.Fatalf("expected empty snapshot in body")
	}
}

func TestAdminJobs_Stream_RealCancelled(t *testing.T) {
	insp := jobsInspector(t)
	enqueueJob(t, "adminteststream")
	h := NewAdminJobsHandler(insp, nil)
	// Cancelled context so the heartbeat loop returns immediately after the
	// first snapshot.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	done := make(chan error, 1)
	go func() { done <- h.Stream(c) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Stream: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("Stream did not return on cancelled context")
	}
	if !strings.Contains(rec.Body.String(), "data:") {
		t.Fatalf("expected at least one data frame")
	}
}

func TestAdminJobs_MapTaskState(t *testing.T) {
	cases := map[asynq.TaskState]string{
		asynq.TaskStateActive:    "active",
		asynq.TaskStatePending:   "waiting",
		asynq.TaskStateScheduled: "delayed",
		asynq.TaskStateRetry:     "delayed",
		asynq.TaskStateArchived:  "failed",
		asynq.TaskStateCompleted: "completed",
	}
	for state, want := range cases {
		if got := mapTaskState(state); got != want {
			t.Fatalf("mapTaskState(%v)=%q want %q", state, got, want)
		}
	}
}

func TestAdminJobs_ToJobSnapshot(t *testing.T) {
	task := &asynq.TaskInfo{
		ID:      "abc",
		Queue:   "default",
		Type:    "face:detect",
		Payload: []byte(`{"k":"v"}`),
		State:   asynq.TaskStatePending,
	}
	snap := toJobSnapshot(task)
	if snap.ID != "abc" || snap.Name != "face:detect" || snap.State != "waiting" {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
	if snap.Data["k"] != "v" {
		t.Fatalf("payload not decoded")
	}
}
