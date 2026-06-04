// Package queuerouting holds an integration test that pins which Asynq queue
// every enqueue helper routes to. It lives in its own package so it can import
// every service without creating an import cycle through the queues package.
//
// The test guards a subtle, easy-to-regress contract: a service that forgets
// the asynq.Queue(...) option silently falls back to the "default" queue, which
// would quietly undo the per-job-type prioritisation. Each case below enqueues
// one real task and asserts it landed on the intended queue.
//
// It uses an in-memory miniredis instance per subtest, so it needs no external
// Redis and can't be polluted by uniqueness locks left over from prior runs.
package queuerouting

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/hibiken/asynq"

	"github.com/alcoves/alcoves-backend/internal/queues"
	"github.com/alcoves/alcoves-backend/internal/services/audiodetection"
	"github.com/alcoves/alcoves-backend/internal/services/facedetection"
	"github.com/alcoves/alcoves-backend/internal/services/filehash"
	"github.com/alcoves/alcoves-backend/internal/services/metadata"
	"github.com/alcoves/alcoves-backend/internal/services/momentexport"
	"github.com/alcoves/alcoves-backend/internal/services/objectdetection"
	"github.com/alcoves/alcoves-backend/internal/services/transcribe"
	"github.com/alcoves/alcoves-backend/internal/services/videoproxy"
	"github.com/alcoves/alcoves-backend/internal/services/waveform"
)

func TestEnqueueHelpersRouteToIntendedQueue(t *testing.T) {
	cases := []struct {
		name  string
		queue string
		// enqueue performs exactly one enqueue using the service's real helper,
		// against the provided client.
		enqueue func(c *asynq.Client) error
	}{
		{
			name:  "transcribe",
			queue: queues.Transcription,
			enqueue: func(c *asynq.Client) error {
				return transcribe.NewService(nil, nil, c, nil, nil, nil).EnqueueTranscribe("lib", "file")
			},
		},
		{
			name:  "video-proxy",
			queue: queues.VideoTranscode,
			enqueue: func(c *asynq.Client) error {
				return videoproxy.NewService(nil, nil, c, nil).EnqueueVideoProxy("lib", "file", false)
			},
		},
		{
			name:  "video-thumbnail",
			queue: queues.Thumbnail,
			enqueue: func(c *asynq.Client) error {
				return videoproxy.NewService(nil, nil, c, nil).EnqueueVideoThumbnail("lib", "file")
			},
		},
		{
			name:  "moment-export",
			queue: queues.MomentExport,
			enqueue: func(c *asynq.Client) error {
				return momentexport.NewService(nil, nil, c).Enqueue("lib", "file", "moment")
			},
		},
		{
			name:  "face-detect",
			queue: queues.FaceDetection,
			enqueue: func(c *asynq.Client) error {
				return facedetection.NewService(nil, nil, c, nil).EnqueueFaceDetection("lib", "file")
			},
		},
		{
			name:  "object-detect",
			queue: queues.ObjectDetection,
			enqueue: func(c *asynq.Client) error {
				return objectdetection.NewService(nil, nil, c, nil).EnqueueObjectDetection("lib", "file")
			},
		},
		{
			name:  "metadata",
			queue: queues.Metadata,
			enqueue: func(c *asynq.Client) error {
				return metadata.NewService(nil, nil, c, nil).EnqueueMetadata("lib", "file")
			},
		},
		{
			name:  "waveform",
			queue: queues.Waveform,
			enqueue: func(c *asynq.Client) error {
				return waveform.NewService(nil, nil, c, nil, nil).EnqueueWaveform("lib", "file")
			},
		},
		{
			name:  "audio-detect",
			queue: queues.AudioDetection,
			enqueue: func(c *asynq.Client) error {
				return audiodetection.NewService(nil, nil, c, nil, nil).EnqueueDetect("lib", "file")
			},
		},
		{
			name:    "file-hash",
			queue:   queues.Hash,
			enqueue: func(c *asynq.Client) error { return filehash.NewService(nil, nil, c).EnqueueFileHash("lib", "file") },
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mr := miniredis.RunT(t)
			opt := asynq.RedisClientOpt{Addr: mr.Addr()}

			client := asynq.NewClient(opt)
			defer client.Close()
			insp := asynq.NewInspector(opt)
			defer insp.Close()

			if err := tc.enqueue(client); err != nil {
				t.Fatalf("enqueue: %v", err)
			}

			info, err := insp.GetQueueInfo(tc.queue)
			if err != nil {
				t.Fatalf("GetQueueInfo(%q): %v — task did not land on the intended queue", tc.queue, err)
			}
			if info.Pending < 1 {
				t.Fatalf("expected >=1 pending task on queue %q, got %d", tc.queue, info.Pending)
			}

			// Nothing should have leaked onto the default fallback queue. A
			// missing asynq.Queue option would send the task there instead.
			if def, err := insp.GetQueueInfo(queues.Default); err == nil && def.Pending != 0 {
				t.Fatalf("task leaked onto the default queue (%d pending); the asynq.Queue option is missing", def.Pending)
			}
		})
	}
}
