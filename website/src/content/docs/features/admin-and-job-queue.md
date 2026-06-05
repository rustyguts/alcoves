---
title: "Admin panel & job queue"
description: "Manage your Alcoves instance: view stats, control registration, pick AI models, manage users, and monitor background jobs in real time."
---

The admin panel is the owner's control room for an Alcoves instance. From a
single page you can see how the instance is being used, open or close
registration, choose which AI models run, promote or demote users, and watch
every background job as it moves through the queue.

Only the **instance owner** — the first account registered — can access the
admin panel. All other users cannot see it, and the backend enforces this gate
regardless of what the browser shows.

## The admin dashboard

Navigate to **Admin** in the sidebar (owners only) to reach `/admin`. The page
is divided into several sections.

### Instance stats

A summary grid shows the current state of your instance at a glance:

| Stat | What it counts |
|---|---|
| Files | Non-trashed files across all libraries |
| Storage | Total bytes consumed by uploaded files |
| Libraries | All libraries on the instance |
| Users | All registered accounts |
| Folders | Non-trashed folders across all libraries |

### Registration control

Choose how new accounts are created:

- **Open** — anyone with the URL can sign up.
- **Invite only** — sign-up is available, but an invitation is required.
- **Closed** — registration is disabled entirely; no new accounts can be created.

Changes take effect immediately. The sign-up page reads this setting without
requiring an authenticated session, so visitors see the correct form (or no
form) right away.

:::tip
Start with **Invite only** if you want to allow a few trusted people in without
opening the door to anyone who finds the URL.
:::

### AI model selection

Alcoves runs all inference locally on CPU — no data leaves the instance. The
admin panel is where you tune the trade-off between accuracy, memory use, and
disk footprint for each AI capability.

#### Speech transcription (Whisper)

Choose the Whisper model used for audio and video transcription. Nine model
sizes are available, from the compact `tiny` through the accurate `large-v3`
and quantized variants. The panel shows each model's:

- Disk size
- Peak RAM usage
- Word error rate (WER) on clean and other-accented speech
- Language support (some models are English-only)

You can also set the default transcription language, or leave it on **auto**
so Whisper detects the spoken language.

#### Audio-event tagging

The audio tagger labels sounds across 527 AudioSet categories. Seven models are
available — EfficientAT (mn04, mn10, mn40), CED (tiny, small, base), and PANNs
CNN14 — each listed with its disk size, peak RAM, mean average precision (mAP),
and license.

:::note
The default audio model (`efficientat_mn10`) is a reasonable balance of
accuracy and RAM. Switch to a smaller variant if memory is tight, or a larger
one for higher accuracy.
:::

#### Applying changes

Each selector applies immediately with a PATCH to the backend. If the request
fails, the UI rolls back the selection to its previous value. Workers pick up
the new model choice at runtime — you do not need to restart the server.

### User management

The users table lists every account on the instance with their name, role, and
timestamps. You can promote any user to **owner** or demote them back to
**member** from an inline dropdown.

:::caution
Your own account row is locked — you cannot demote yourself. This prevents
accidental lockout.
:::

### Hash backfill

If your instance has files uploaded before content-addressed hashing was
introduced, use the **Backfill hashes** action to enqueue a background job that
SHA-256-hashes each unhashed file. The job runs through the normal queue and
you can monitor its progress in the job dashboard below.

### Version info

The page footer shows the running build version — commit SHA, build timestamp,
and a flag if the binary was built from a dirty working tree.

---

## Background job queue

Alcoves processes heavy work — transcoding, AI inference, thumbnail generation,
waveforms — in a background queue backed by [Asynq](https://github.com/hibiken/asynq)
and Dragonfly (a Redis-compatible store). The job dashboard lets you see what
is happening in real time and intervene when something goes wrong.

### What runs in the queue

| Job type | Triggered by |
|---|---|
| Face detection | File upload or manual backfill |
| Object detection | File upload |
| Image proxying / transforms | First request for a transformed image |
| Video transcoding | File upload |
| Video thumbnail | File upload |
| Speech transcription | Manually triggered per file |
| Audio-event tagging | Manually triggered per file |
| Waveform generation | File upload |
| Moment export | Exporting a moment clip |
| File hashing | Backfill action or new upload |
| Image proxy variant pre-warm | Hourly maintenance loop (background) |

### Named queues

Each job type runs on its own named queue, ranked by **importance ÷
complexity** — how much a user is actively waiting on the result, weighed
against how long the job takes so a slow job class can never hog the worker
pool ahead of fast ones. Latency-sensitive work is never stuck behind a
backlog, and the heaviest long-runners (whisper transcription, full video
transcode) sit near the bottom — below fast jobs like thumbnailing. You can
filter the dashboard by queue:

| Queue | Priority | What it carries |
|---|---|---|
| `imageproxy` | Highest | Interactive, on-demand image transforms a user is waiting on |
| `metadata` | Very high | EXIF/GPS + ffprobe extraction (fast; unblocks Timeline, Map, file details) |
| `thumbnail` | High | Video poster-frame extraction (fast ffmpeg seek; makes the grid usable) |
| `hash` | High | SHA-256 content hashing for dedup (fast) |
| `moment-export` | Medium | User-initiated clip encodes — someone clicked "export" and is waiting |
| `waveform` | Medium | Audio waveform peaks for the editor/player |
| `object-detection` | Medium-low | YOLO ONNX inference (background search enrichment) |
| `face-detection` | Medium-low | Face ONNX inference + clustering (background) |
| `audio-detection` | Medium-low | AudioSet ONNX inference (background) |
| `video-transcode` | Low | Full video proxy transcodes — heavy, multi-minute ffmpeg work |
| `transcription` | Lowest (real work) | Whisper speech-to-text — the longest-running job class |
| `maintenance` | Lowest | Background upkeep — the hourly image-proxy variant pre-warm |

A `default` queue is retained only as a drain target for tasks enqueued by an
older build during an upgrade; no current job type routes new work to it.

Queue selection is **non-strict weighted sampling**: a lower-priority queue is
never starved when it's the only one with work — it simply yields to
higher-priority queues while they have a backlog.

### Periodic maintenance jobs

Three background loops run on `worker`/`all` nodes without any user action:

- **Metadata backfill** enqueues EXIF/media-metadata extraction for media files
  that have never been extracted.
- **Image-proxy variant pre-warm** (hourly) generates every cache variant for
  each image so the first view is instant rather than waiting on a transform.
  Disable it with `ALCOVES_IMAGE_PROXY_PREWARM_ENABLED=false`.
- **Job reaper** (every 5 minutes) recovers jobs that crashed mid-flight — see
  below.

The first two give up on a file after **3 failed attempts**, so a
permanently-broken file (e.g. a corrupted image) is never re-queued forever — it
shows up as a failed job at most three times and is then dropped from the
backfill scan.

### Stuck-job recovery (the reaper)

A worker can die part-way through a job — an out-of-memory kill, a pod eviction,
or Asynq exhausting its retries and archiving the task. When that happens the
queue no longer holds the task, but the database row still advertises the job as
`processing` (or `queued`): a thumbnail or transcript spinner that never
resolves. Left alone, that row stays dirty forever.

The **job reaper** reconciles the database against the queue every five minutes.
A job is treated as orphaned only when **both** are true:

- its status column is non-terminal (`queued` / `processing`), **and**
- the Asynq inspector reports **no live task** (active, pending, scheduled, or
  retrying) for that file or moment.

Using the queue itself as the source of truth is what keeps this safe for
**long-running jobs**: a multi-hour whisper transcribe is "active" in the queue
the entire time it runs, so the reaper never touches it — there is no wall-clock
timeout that could kill a healthy job. Only rows whose task has genuinely
vanished are recovered.

Recovery marks the row **failed** (clearing its progress bar and recording an
"orphaned" reason) rather than re-running it. A failed job is a clean terminal
state: the spinner stops, the breakage is visible in the dashboard, and it can
be retried manually. The reaper deliberately does not auto-re-enqueue, because
the usual cause of orphaning is an input that crashes its worker — blindly
retrying it would just crash the worker pool again in a loop.

It covers transcription, video proxy, audio-event detection, waveform
generation, and moment export. (Metadata and image pre-warm aren't reaped here —
their own backfill loops above already recover stuck rows.)

### Reading the dashboard

The job dashboard is embedded in the bottom of `/admin` and also available
full-screen at `/admin/jobs`.

A live stream updates every two seconds without a page refresh. At the top,
tiles summarise counts across all queues:

- **Active** — jobs currently being processed by a worker
- **Waiting** — jobs queued and ready to run
- **Delayed** — jobs scheduled to run in the future
- **Failed** — jobs that exhausted their retry attempts

Below the tiles, a per-queue table shows the same breakdown for each queue
individually, with a **Purge** button that clears all pending, scheduled, retry,
archived, and completed tasks from that queue in one action.

The job list below the queue table shows individual jobs. You can filter by
status and by queue. Expand any row to see the full payload, failure reason, and
timestamps.

### Retrying and removing failed jobs

Failed jobs stay visible so you can decide what to do with them. Each failed
job row offers two actions:

- **Retry** — push the job back into the active queue to run again.
- **Remove** — delete the job from the queue permanently.

:::caution
Purge and Remove are permanent. There is no undo.
:::

### When the queue is unavailable

If the Dragonfly/Redis store is unreachable, the queue dashboard shows empty
counts and mutating actions return an error rather than crashing. Alcoves
degrades gracefully — the rest of the application remains usable, and image
transforms fall back to inline processing.

---

## Access control

The admin panel is protected at two levels:

1. **Server-side gate** — every `/api/admin/**` request checks that the
   authenticated user holds the `owner` role. A `403` is returned otherwise,
   regardless of what the client sends.
2. **Frontend convenience** — the sidebar only renders the Admin link for
   owners, and the route middleware redirects non-owners away from `/admin` and
   `/admin/jobs` before the page loads.

The server-side gate is the authoritative enforcement. The frontend checks are
a usability layer, not a security boundary.
