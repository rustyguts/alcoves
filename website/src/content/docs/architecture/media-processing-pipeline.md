---
title: "Media processing pipeline"
description: "How Alcoves transforms images on demand, transcodes video, extracts audio waveforms, and normalizes avatars using libvips and ffmpeg."
---

Alcoves processes media in two distinct modes: **request-driven** (image transforms delivered synchronously via a cache-backed proxy) and **async** (video transcoding, waveform extraction, and thumbnail generation run as background jobs). All derived artifacts are stored through the same pluggable blob storage layer used for original files.

This page covers the non-ML media pipeline. AI-driven analysis (face recognition, object detection, audio event tagging, transcription) is a separate concern documented in the AI feature docs.

## Overview

| Pipeline | Trigger | Output |
|---|---|---|
| Image transform | HTTP request (lazy, cached) | Resized/converted derivative in cache storage |
| Video proxy | Upload or manual re-encode | H.264/AAC MP4 + WebP thumbnail |
| Video thumbnail | Upload or manual reprocess | JPEG or WebP thumbnail derived file |
| Audio waveform | Upload | `waveform.json` in cache storage |
| Avatar normalization | Avatar upload | 512 px square WebP |

**Shared infrastructure used by all pipelines:**

- **libvips** (via `govips`) — image decode, resize, color-space normalization, encode
- **ffmpeg / ffprobe** — video transcoding, thumbnail extraction, PCM audio extraction
- **Asynq job queue** (backed by Dragonfly/Redis) — async task dispatch, deduplication, and retention
- **Storage service** — unified blob I/O across local-disk and S3 backends, scoped to `Files`, `Avatars`, and `Cache`

Worker processes register with the Asynq mux when the server runs in `all` or `worker` mode (`ALCOVES_MODE`). The image proxy queue runs at higher priority than the default queue so interactive image loads are not starved by background transcodes.

---

## Image proxy

Every image displayed in the Alcoves UI flows through an authenticated proxy route rather than serving original bytes directly. The proxy resizes and converts on first request, caches the derivative, and serves subsequent requests from cache with a one-year immutable `Cache-Control` header.

### Transform parameters

The proxy accepts four query parameters:

| Parameter | Values | Default |
|---|---|---|
| `width` | 1–4096 | unconstrained |
| `height` | 1–4096 | unconstrained |
| `quality` | 1–100 | 80 |
| `format` | `jpeg`, `webp`, `avif`, `png` | `jpeg` |

Width and height are clamped to 4096 to prevent memory exhaustion from crafted requests against the libvips allocator.

### Transform pipeline (libvips)

1. Decode source bytes from storage.
2. Auto-rotate based on EXIF orientation.
3. Convert to sRGB — bakes the ICC profile before metadata is stripped, so wide-gamut sources render correctly rather than washed out.
4. Fit-inside resize — maintains aspect ratio, uses linear interpolation, never upscales.
5. Encode to the requested format. JPEG output is progressive with coding optimization; all formats strip metadata. Default quality 80.

### Request-time concurrency model

When a transform derivative is not yet cached, the proxy must coordinate concurrent requests for the same derivative without running duplicate work. This is handled with a five-step flow:

1. **Cache check** — return immediately if the derivative already exists in storage.
2. **Subscribe** — subscribe to a Redis pub/sub completion channel *before* enqueueing, so a completion signal cannot be missed.
3. **Double-check** — re-check cache and any transient result key to handle the race where a job finished between steps 1 and 2.
4. **Enqueue** — dispatch the transform task with a 2-minute deduplication window (so concurrent requests collapse to a single job) and no retries (fast-fail semantics).
5. **Wait** — block up to 30 seconds for the pub/sub signal. An `"ok"` signal reads the result from a transient Redis key first (avoids stale NFS attribute cache), falling back to storage with retries. An `"error"` signal returns immediately without waiting for the timeout.

When Redis is not available (development or test environments), the proxy transforms synchronously and writes directly to cache storage.

### Access control

The proxy route (`GET /api/files/proxy/{libraryId}/{fileId}/{filename}`) requires an authenticated session and library membership. Non-members receive `404` rather than `403` to avoid confirming that a library or file exists.

---

## Video proxy and thumbnails

Browsers cannot play every container or codec a user might upload. Alcoves transcodes non-web-friendly video to a standardized MP4 and generates thumbnails for grid and preview display.

### When transcoding is triggered

On upload, Alcoves inspects the MIME type:

- `video/mp4`, `video/webm`, `video/ogg` — already web-playable; a thumbnail is generated but no proxy transcode is enqueued by default.
- All other video MIME types — a proxy transcode is enqueued automatically.

Library owners can also trigger re-encoding manually from the library settings UI, or bulk-reprocess thumbnails for all videos in a library.

### Proxy transcode pipeline

1. **Probe** — ffprobe inspects the source streams. If the video is already H.264, the audio is AAC (or absent), the container is MP4 or MOV, and the height is 1080 px or less, transcoding is skipped and the file is marked `not_needed`.
2. **Transcode** — ffmpeg encodes with `libx264`, CRF 23, medium preset, High profile, level 4.1, yuv420p pixel format, AAC audio at 128 kbps stereo, and `+faststart` for progressive download. Video taller than 1080 px is scaled down.
3. **Progress** — ffmpeg's `-progress` output is parsed during the encode; the `proxy_status`, `proxy_progress`, and `proxy_eta_seconds` columns on the file record are updated so the frontend can show a progress bar and ETA.
4. **Storage** — the transcoded MP4 is stored as a derived file record linked to the original by `source_file_id`.
5. **Thumbnail** — a WebP thumbnail is generated at 480 px wide and written to cache.

### Thumbnail extraction and HDR handling

Thumbnail extraction tries up to four ffmpeg strategies in order to handle HDR and SDR sources gracefully:

1. **Auto HDR to BT.709** — linearize the source, apply Hable tone-mapping, convert to BT.709 YUV420p. Requires an ffmpeg build with `zscale` (libzimg).
2. **Explicit SDR** — same pipeline but declares the source as BT.709 explicitly, for untagged content.
3. **SDR no-seek** — same as above but without seeking to mid-file.
4. **Simple scale** — last resort with no color management.

### Proxy status state machine

The `proxy_status` column on a file record cycles through:

```
queued → processing → ready
                    → not_needed
                    → failed
```

The frontend polls `GET /api/libraries/:id/files/:fileId` every two seconds while status is `queued` or `processing`, showing the progress percentage and estimated seconds remaining.

### Playback sources

`GET /api/libraries/:id/files/:fileId/playback-sources` returns the original file and any proxy MP4 as a list of playback sources. The video player and editor let users switch between sources if both are available.

:::note
Derived files (proxies, thumbnails) are always linked to their origin and excluded from normal file listings, deduplication, and trash views.
:::

---

## Audio waveform

The video editor draws a scrollable, zoomable waveform under the timeline so users can navigate audio visually when creating moment clips. Waveform data is extracted on upload and cached as JSON.

### Extraction pipeline

1. **Audio check** — ffmpeg probes for an audio stream. Files with no audio receive an empty waveform and are marked complete immediately.
2. **PCM extraction** — ffmpeg decodes the audio track to raw float32 little-endian PCM at 16 kHz mono.
3. **Peak computation** — a streaming, window-based algorithm divides the PCM into 320-sample windows (16000 Hz / 50 peaks per second) and records the maximum absolute value in each window, clamped to [0, 1]. The algorithm uses a fixed read buffer and a reused window buffer to avoid loading the entire file into memory. Quiet files stay quiet — there is no per-file normalization.
4. **Storage** — the peak array, peaks-per-second, and sample rate are serialized to JSON and written to cache storage.
5. **Version check** — before writing the result, the worker reloads the file record to confirm the waveform version has not changed (which would indicate the file was replaced while the job was running). Stale results are discarded.

The resulting JSON structure has 50 peaks per second of audio, which gives the waveform renderer enough resolution to draw accurately at any zoom level the editor supports.

### Waveform rendering

The editor renders the waveform on a `<canvas>` element pinned to the visible viewport. Only the visible slice of the waveform is drawn on each frame, with peak values accumulated per pixel column. The renderer is HiDPI-aware and SSR-safe.

---

## Avatar normalization

When a user uploads a profile avatar, the image is normalized synchronously before storage — no background job is involved.

The normalization pipeline:

1. Reject empty input or files larger than 8 MiB.
2. Decode the image with libvips; reject unrecognizable formats.
3. Auto-rotate based on EXIF orientation.
4. Center-crop to a square (using the shorter dimension).
5. Downscale to at most 512 × 512 px with Lanczos3 interpolation (never upscales).
6. Export as WebP at quality 85.

Avatars are stored keyed by user ID and served at `/api/auth/me/avatar` and `/api/auth/users/:userId/avatar` with a short `private, max-age=300` cache header.

The upload endpoint maps errors to HTTP status codes: empty or unrecognizable input returns `400`; files over 8 MiB return `413`.

---

## Data model

Async media jobs use a consistent status/progress/version pattern on the `files` table:

| Service | Columns |
|---|---|
| Video proxy | `proxy_status`, `proxy_progress`, `proxy_eta_seconds` |
| Waveform | `waveform_status`, `waveform_progress`, `waveform_error`, `waveform_version`, `waveformed_version`, `waveform_peaks_per_second` |
| Derived files | `thumbnail_file_id`, `source_file_id` |

The `waveform_version` / `waveformed_version` pair implements optimistic re-processing: incrementing `waveform_version` schedules a re-run, and the worker checks both at the start and end of the job to detect files that were replaced mid-extraction.

---

## End-to-end data flow

**On upload:** A new file record is created. Based on MIME type, the server enqueues derivatives — for video, this includes a thumbnail job, optionally a proxy transcode job, a waveform job, and any AI analysis jobs the library has enabled.

**On display:** Grid cards and file previews request images through `AlcovesImage.vue`, which builds a proxy URL with sorted query parameters for stable cache keys. The request hits `GET /api/files/proxy/...`, which either serves a cached derivative immediately or waits up to 30 seconds for a freshly computed one.

**In the editor:** The video editor loads playback sources and waveform data, then renders the waveform on a canvas under the moment timeline. Job status is polled for progress display while transcoding is in progress.

---

## Configuration

| Environment variable | Purpose | Default |
|---|---|---|
| `ALCOVES_MODE` | Set to `all` or `worker` to enable background job processing | `all` |
| `ALCOVES_FFMPEG_BINARY` | Path to the ffmpeg binary | `ffmpeg` (system PATH) |
| `ALCOVES_QUEUE_HOST` | Dragonfly/Redis host for the job queue | `localhost` |
| `ALCOVES_QUEUE_PORT` | Dragonfly/Redis port | `6389` |
| `ALCOVES_STORAGE_DRIVER` | `local` or `s3` | `local` |
| `ALCOVES_STORAGE_PATH` | Root path for local file storage | — |
| `ALCOVES_CACHE_STORAGE_PATH` | Root path for derived/cache storage | — |

:::caution
The image proxy requires libvips to be available at build time. If libvips is not installed, the proxy will fall back to serving original files without transformation. Docker images published by the project include libvips.
:::

:::tip
If you build ffmpeg from source, include `--enable-libzimg` to enable the `zscale` filter. Without it, the HDR-to-BT.709 thumbnail strategy is skipped and the fallback SDR strategies are used instead.
:::
