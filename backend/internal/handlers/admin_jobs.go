package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/hibiken/asynq"
	"github.com/labstack/echo/v4"
)

type AdminJobsHandler struct {
	inspector *asynq.Inspector
	ownerMW   echo.MiddlewareFunc
}

// NewAdminJobsHandler creates the handler. ownerMW is the owner-only
// middleware from AdminHandler; all job-queue routes are gated behind it.
func NewAdminJobsHandler(inspector *asynq.Inspector, ownerMW echo.MiddlewareFunc) *AdminJobsHandler {
	return &AdminJobsHandler{inspector: inspector, ownerMW: ownerMW}
}

func (h *AdminJobsHandler) RegisterRoutes(g *echo.Group) {
	g.Use(h.ownerMW)
	g.GET("/jobs/stats", h.Stats)
	g.GET("/jobs/:queueName", h.ListJobs)
	g.POST("/jobs/:queueName/purge", h.PurgeQueue)
	g.POST("/jobs/:queueName/:jobId", h.ControlJob)
	g.GET("/jobs/stream", h.Stream)
}

func (h *AdminJobsHandler) Stats(c echo.Context) error {
	if h.inspector == nil {
		return c.JSON(http.StatusOK, map[string]interface{}{"queues": map[string]interface{}{}})
	}

	queueStats, _, err := h.buildSnapshot(100)
	if err != nil {
		return internalError("Failed to load queue stats", err)
	}

	result := map[string]interface{}{}
	for _, q := range queueStats {
		result[q.Name] = map[string]int{
			"active":    q.Active,
			"completed": q.Completed,
			"failed":    q.Failed,
			"waiting":   q.Waiting,
			"delayed":   q.Delayed,
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"queues": result})
}

func (h *AdminJobsHandler) ListJobs(c echo.Context) error {
	if h.inspector == nil {
		return c.JSON(http.StatusOK, []interface{}{})
	}

	queue := c.Param("queueName")
	jobs, err := h.listJobsForQueue(queue, 200)
	if err != nil {
		return internalError("Failed to list jobs", err)
	}

	return c.JSON(http.StatusOK, jobs)
}

func (h *AdminJobsHandler) ControlJob(c echo.Context) error {
	if h.inspector == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Queue inspector unavailable")
	}

	queue := c.Param("queueName")
	jobID := c.Param("jobId")

	var req struct {
		Action string `json:"action"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	switch req.Action {
	case "retry":
		if err := h.inspector.RunTask(queue, jobID); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Failed to retry job")
		}
	case "remove":
		if err := h.inspector.DeleteTask(queue, jobID); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "Failed to remove job")
		}
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "Unsupported action")
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminJobsHandler) PurgeQueue(c echo.Context) error {
	if h.inspector == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "Queue inspector unavailable")
	}

	queue := c.Param("queueName")

	deleted := map[string]int{}

	if n, err := h.inspector.DeleteAllPendingTasks(queue); err == nil {
		deleted["waiting"] = n
	}
	if n, err := h.inspector.DeleteAllScheduledTasks(queue); err == nil {
		deleted["scheduled"] = n
	}
	if n, err := h.inspector.DeleteAllRetryTasks(queue); err == nil {
		deleted["retry"] = n
	}
	if n, err := h.inspector.DeleteAllArchivedTasks(queue); err == nil {
		deleted["failed"] = n
	}
	if n, err := h.inspector.DeleteAllCompletedTasks(queue); err == nil {
		deleted["completed"] = n
	}

	total := 0
	for _, count := range deleted {
		total += count
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"ok":      true,
		"deleted": deleted,
		"total":   total,
	})
}

func (h *AdminJobsHandler) Stream(c echo.Context) error {
	// SSE stream for job events
	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().WriteHeader(http.StatusOK)

	if h.inspector == nil {
		fmt.Fprintf(c.Response(), "data: {\"queues\":[],\"jobs\":[]}\n\n")
		c.Response().Flush()
		return nil
	}

	if err := h.sendSnapshot(c, 200); err != nil {
		return nil
	}

	// Keep connection alive with heartbeats until client disconnects
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request().Context().Done():
			return nil
		case <-ticker.C:
			if err := h.sendSnapshot(c, 200); err != nil {
				return nil
			}
		}
	}
}

type queueSnapshot struct {
	Name      string `json:"name"`
	Waiting   int    `json:"waiting"`
	Active    int    `json:"active"`
	Completed int    `json:"completed"`
	Failed    int    `json:"failed"`
	Delayed   int    `json:"delayed"`
}

type jobSnapshot struct {
	ID           string                 `json:"id"`
	QueueName    string                 `json:"queueName"`
	Name         string                 `json:"name"`
	Data         map[string]interface{} `json:"data"`
	Progress     int                    `json:"progress"`
	AttemptsMade int                    `json:"attemptsMade"`
	FailedReason *string                `json:"failedReason"`
	Timestamp    int64                  `json:"timestamp"`
	ProcessedOn  *int64                 `json:"processedOn"`
	FinishedOn   *int64                 `json:"finishedOn"`
	State        string                 `json:"state"`
}

func (h *AdminJobsHandler) sendSnapshot(c echo.Context, perQueueLimit int) error {
	queues, jobs, err := h.buildSnapshot(perQueueLimit)
	if err != nil {
		fmt.Fprintf(c.Response(), ": snapshot-error\n\n")
		c.Response().Flush()
		return err
	}

	payload, err := json.Marshal(map[string]interface{}{
		"queues": queues,
		"jobs":   jobs,
	})
	if err != nil {
		return err
	}

	fmt.Fprintf(c.Response(), "data: %s\n\n", payload)
	c.Response().Flush()
	return nil
}

func (h *AdminJobsHandler) buildSnapshot(perQueueLimit int) ([]queueSnapshot, []jobSnapshot, error) {
	queueNames, err := h.inspector.Queues()
	if err != nil {
		return nil, nil, err
	}

	queues := make([]queueSnapshot, 0, len(queueNames))
	jobs := []jobSnapshot{}

	for _, queue := range queueNames {
		info, err := h.inspector.GetQueueInfo(queue)
		if err != nil {
			continue
		}

		queues = append(queues, queueSnapshot{
			Name:      queue,
			Waiting:   info.Pending,
			Active:    info.Active,
			Completed: info.Completed,
			Failed:    info.Archived,
			Delayed:   info.Scheduled + info.Retry,
		})

		queueJobs, err := h.listJobsForQueue(queue, perQueueLimit)
		if err != nil {
			continue
		}
		jobs = append(jobs, queueJobs...)
	}

	return queues, jobs, nil
}

func (h *AdminJobsHandler) listJobsForQueue(queue string, limit int) ([]jobSnapshot, error) {
	opts := []asynq.ListOption{asynq.PageSize(limit)}
	out := []jobSnapshot{}

	appendTasks := func(tasks []*asynq.TaskInfo) {
		for _, task := range tasks {
			out = append(out, toJobSnapshot(task))
		}
	}

	if tasks, err := h.inspector.ListActiveTasks(queue, opts...); err == nil {
		appendTasks(tasks)
	}
	if tasks, err := h.inspector.ListPendingTasks(queue, opts...); err == nil {
		appendTasks(tasks)
	}
	if tasks, err := h.inspector.ListScheduledTasks(queue, opts...); err == nil {
		appendTasks(tasks)
	}
	if tasks, err := h.inspector.ListRetryTasks(queue, opts...); err == nil {
		appendTasks(tasks)
	}
	if tasks, err := h.inspector.ListArchivedTasks(queue, opts...); err == nil {
		appendTasks(tasks)
	}
	if tasks, err := h.inspector.ListCompletedTasks(queue, opts...); err == nil {
		appendTasks(tasks)
	}

	return out, nil
}

func toJobSnapshot(task *asynq.TaskInfo) jobSnapshot {
	data := map[string]interface{}{}
	if len(task.Payload) > 0 {
		_ = json.Unmarshal(task.Payload, &data)
	}

	state := mapTaskState(task.State)
	createdOn := task.NextProcessAt
	if task.CompletedAt.IsZero() {
		createdOn = task.NextProcessAt
	}
	createdMs := createdOn.UnixMilli()
	if createdMs <= 0 {
		createdMs = time.Now().UnixMilli()
	}

	var failedReason *string
	if task.LastErr != "" {
		failedReason = &task.LastErr
	}

	var processedOn *int64
	if !task.LastFailedAt.IsZero() {
		v := task.LastFailedAt.UnixMilli()
		processedOn = &v
	}

	var finishedOn *int64
	if !task.CompletedAt.IsZero() {
		v := task.CompletedAt.UnixMilli()
		finishedOn = &v
	}

	return jobSnapshot{
		ID:           task.ID,
		QueueName:    task.Queue,
		Name:         task.Type,
		Data:         data,
		Progress:     0,
		AttemptsMade: task.Retried,
		FailedReason: failedReason,
		Timestamp:    createdMs,
		ProcessedOn:  processedOn,
		FinishedOn:   finishedOn,
		State:        state,
	}
}

func mapTaskState(state asynq.TaskState) string {
	switch state {
	case asynq.TaskStateActive:
		return "active"
	case asynq.TaskStatePending:
		return "waiting"
	case asynq.TaskStateScheduled, asynq.TaskStateRetry:
		return "delayed"
	case asynq.TaskStateArchived:
		return "failed"
	case asynq.TaskStateCompleted:
		return "completed"
	default:
		return "waiting"
	}
}
