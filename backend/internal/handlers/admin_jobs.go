package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// AdminJobsHandler handles job queue admin endpoints.
// Note: Job queue integration with asynq will be added when workers are implemented.
// For now, these return placeholder responses so the frontend doesn't break.
type AdminJobsHandler struct{}

func NewAdminJobsHandler() *AdminJobsHandler {
	return &AdminJobsHandler{}
}

func (h *AdminJobsHandler) RegisterRoutes(g *echo.Group) {
	g.GET("/jobs/stats", h.Stats)
	g.GET("/jobs/:queueName", h.ListJobs)
	g.POST("/jobs/:queueName/:jobId", h.ControlJob)
	g.GET("/jobs/stream", h.Stream)
}

func (h *AdminJobsHandler) Stats(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"queues": map[string]interface{}{
			"video-processing": map[string]int{
				"active":    0,
				"completed": 0,
				"failed":    0,
				"waiting":   0,
				"delayed":   0,
			},
			"face-detection": map[string]int{
				"active":    0,
				"completed": 0,
				"failed":    0,
				"waiting":   0,
				"delayed":   0,
			},
		},
	})
}

func (h *AdminJobsHandler) ListJobs(c echo.Context) error {
	return c.JSON(http.StatusOK, []interface{}{})
}

func (h *AdminJobsHandler) ControlJob(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminJobsHandler) Stream(c echo.Context) error {
	// SSE stream for job events
	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().WriteHeader(http.StatusOK)

	// Send initial connected event
	fmt.Fprintf(c.Response(), "data: {\"type\":\"connected\"}\n\n")
	c.Response().Flush()

	// Keep connection alive with heartbeats until client disconnects
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request().Context().Done():
			return nil
		case <-ticker.C:
			fmt.Fprintf(c.Response(), ": heartbeat\n\n")
			c.Response().Flush()
		}
	}
}
