---
title: "Search, activity feed & notifications"
description: "Search across all your libraries by name, detected content, and transcripts; follow library history in the activity feed; get real-time notifications from collaborators."
---

Alcoves gives you three ways to stay on top of your media: a cross-library search that understands what is *in* your files, a per-library activity history, and a real-time notification bell for collaborator actions.

---

## Cross-library search

The search box in the dashboard header searches **every library you belong to at once**. You do not need to pick a library first — type a query, press Enter, and results from all your libraries appear on a single page grouped by library.

### What you can search for

Search matches on three independent signals and merges them into one ranked list:

| Signal | What it finds |
|---|---|
| File name | Files whose name contains the query |
| Folder name | Folders whose name contains the query |
| AI object labels | Files where a detected object matches the query — e.g. search `dog` to find photos containing a dog, even if the word "dog" never appears in the filename |

Object-label search relies on the AI object-detection pipeline. It works automatically for any library where object detection is enabled; files are indexed in the background after they are uploaded.

When a result matched on detected objects, the matching labels appear as a small badge on its tile so you can see exactly which objects triggered the result.

### Using search

1. Type at least two characters into the header search box and press **Enter**.
2. Results render as a justified, Google-Photos-style gallery grouped by library — each library is a labelled section of thumbnails sized to their native aspect ratio. Non-media files and folders appear as icon tiles; the file name shows on hover.
3. Click any file tile to open a full preview.

:::tip
Try searching for common objects like `car`, `person`, `cat`, or `food`. If object detection has run on your library, these queries find matching files even when the filenames give no hint.
:::

---

## Library activity feed

Every library keeps a complete history of meaningful events — files uploaded, folders created or renamed, moments shared, members joining, and background processing milestones. You can view this history at **Library → Activity** (the feed tab inside any library).

The feed shows everything: your own actions, collaborator actions, and system events from background workers (for example, when a video proxy or transcript becomes ready). It is a full audit trail, not a filtered inbox, so nothing is hidden based on who did it.

Activities are grouped by actor and action when several similar events happen close together — for example, uploading twenty files at once appears as a single collapsed row rather than twenty separate entries.

### What gets recorded

| Event | What it means |
|---|---|
| `file.created` | A file was uploaded |
| `file.deleted` | A file was moved to trash |
| `folder.created` | A new folder was created |
| `folder.renamed` | A folder's name changed |
| `folder.deleted` | A folder was deleted |
| `tag.created` | A tag was added |
| `moment.created` | A moment clip was saved in the video editor |
| `moment.shared` | A public share link was created for a moment |
| `member.joined` | A user accepted an invite or joined the library |
| `member.removed` | A member was removed from the library |
| `system.waveform_ready` | Audio waveform processing finished (feed only) |
| `system.transcribe_ready` | Speech transcription finished (feed only) |
| `system.video_proxy_ready` | Video transcoding finished (feed only) |

System events appear in the library feed so you know when background processing completes, but they are never forwarded to the global notification bell.

---

## Notifications bell

The bell icon in the top navigation bar shows a live count of unread activity from your collaborators. It covers all your libraries in one place, filtered down to what is actually relevant to you:

- **Only other people's actions** — your own uploads and changes never generate a notification for yourself.
- **No system events** — background processing events stay in the library feed, not your inbox.
- **Persistent dismissal** — dismissed items stay dismissed across sessions. "Dismiss all" marks your entire inbox read in one click without affecting other members.

### Notification inbox

Click the bell to see a dropdown of recent notifications. Click **See all notifications** to open the full `/notifications` page, which loads older entries and groups them by library and time.

Each notification is a deep link: clicking a file notification navigates to that file in its library; a moment notification opens the video editor at that moment; a member notification goes to library settings.

### Real-time delivery

Notifications arrive in real time over a WebSocket connection. If the connection drops, Alcoves automatically reconnects with exponential backoff. After several failed reconnect attempts it falls back to polling for new notifications in the background.

The library feed also updates live while you are viewing it — new events prepend to the top of the feed as collaborators make changes.

:::note
Real-time delivery requires the Redis/Dragonfly queue to be running. If the queue is unavailable, activity is still recorded durably and will appear correctly when you load the feed or notifications page — you just will not receive live pushes until the queue is restored.
:::

---

## How the system works

### Durable log, best-effort live delivery

Every event is written to the database first. The real-time WebSocket delivery is an optimization on top of that durable record — if a push is missed (dropped connection, full buffer, server restart), nothing is lost. The next time a client loads the feed or notifications page it reads from the database and sees the complete history.

### Multi-replica fan-out

When more than one API server is running, events are broadcast across replicas over Redis Pub/Sub. A file uploaded via one replica notifies a collaborator connected to a different replica without any extra configuration — the same Redis instance used by the background job queue also carries the activity bus traffic.

### Configuration

The activity bus uses the same Redis/Dragonfly connection as the job queue:

| Environment variable | Purpose |
|---|---|
| `ALCOVES_QUEUE_HOST` | Redis/Dragonfly hostname |
| `ALCOVES_QUEUE_PORT` | Redis/Dragonfly port |
| `ALCOVES_QUEUE_PASSWORD` | Redis/Dragonfly password (if required) |

Without a queue configured, the feed and notifications still work correctly from the database — there is just no cross-process live fan-out and no real-time WebSocket delivery.

### Production reverse proxy

In production, make sure your reverse proxy forwards WebSocket upgrade headers for the `/api/ws` path. Without this, the WebSocket connection will not upgrade and Alcoves will fall back to polling.

For nginx:

```nginx
location /api/ws {
    proxy_pass http://alcoves-api:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

:::tip
If you use the official Helm chart, WebSocket headers are already configured in the bundled ingress annotations. No extra steps needed for Kubernetes deployments.
:::
