# Media Processing: Image Proxy, Video Proxy, Thumbnails & Waveforms

This document covers Alcoves' **non-ML media processing** services: on-demand image
transformation, video transcoding proxies, thumbnail generation, audio waveform
extraction, and avatar normalization. (Face/object/audio detection and transcription
are ML pipelines documented elsewhere.)

Every heavyweight operation here runs **asynchronously through the Asynq job queue**
(backed by Dragonfly/Redis) on worker nodes, persists state on the `files` row, writes
derived artifacts through the `storage.Service` blob abstraction, and — where a human is
watching for a result — emits an `activity` event. The one exception is the image proxy,
which is request-driven and uses Redis pub/sub to coordinate a synchronous-feeling HTTP
response on top of an async worker.

All of these packages live under `backend/internal/services/` and define **no HTTP
routes of their own**. They are pure domain/processing logic, wired into the Asynq mux
in `backend/cmd/server/main.go` and invoked by handlers in `backend/internal/handlers/`.

---

## Architecture at a glance

| Concern | Package | Asynq task type(s) | Trigger | Output |
|---|---|---|---|---|
| Image transform | `services/imageproxy` | `image:proxy` | HTTP request (lazy) | Cache: `transforms/w{W}_h{H}_q{Q}.{fmt}` |
| Video proxy + thumb | `services/videoproxy` | `video:proxy`, `video:thumbnail` | Upload / explicit | Proxy `File` row + `thumbnail.webp`/JPEG |
| Waveform | `services/waveform` | `file:waveform` | Upload / explicit | Cache: `waveform.json` |
| Avatar normalize | `services/avatarproc` | _(none — sync function)_ | Avatar upload | WebP bytes |

Shared infrastructure:

- **`storage.Service`** (`services/storage`) — routes blob I/O to `ScopeFiles`,
  `ScopeAvatars`, `ScopeCache` over a `local` or `s3` driver. Range reads supported.
- **Asynq** on Dragonfly/Redis — task dispatch, retention, dedup (`asynq.Unique`).
- **libvips** via `govips/v2` — image decode/encode (imageproxy, avatarproc).
- **ffmpeg / ffprobe** via `os/exec` — video/audio decode/encode (videoproxy, waveform).
- The `files` async-job state-machine columns (see "Data model" below).

Worker wiring (in `main.go`, runs when `ALCOVES_MODE=all` or `worker`, concurrency 8,
queue priorities `imageproxy:10 >> default:1`):

```
imageproxy.TaskTypeImageProxy   → imgSvc.NewTaskHandler().ProcessTask
videoproxy.TaskTypeVideoProxy   → videoTaskHandler.ProcessTask
videoproxy.TaskTypeVideoThumb   → videoTaskHandler.ProcessThumbnailTask
waveform.TaskTypeWaveform       → waveformSvc.NewTaskHandler().ProcessTask
```

---

## Image proxy (`services/imageproxy`)

On-demand, cache-backed image transformation. The frontend never links to original
image bytes for display — it routes everything through the authenticated proxy route,
requesting a width/height/quality/format, and the backend produces (and caches) a
transformed derivative.

**Files:** `imageproxy.go`, `service.go`, `worker.go` (+ `imageproxy_test.go`,
`service_test.go`).

### TransformOptions and the cache-key scheme

```go
type TransformOptions struct {
    Width   int    // 0 = unconstrained
    Height  int    // 0 = unconstrained
    Quality int    // 1–100, default 80
    Format  string // "jpeg" | "webp" | "avif" | "png", default "jpeg"
}
```

The cache key is deterministic and normalized (empty format → `jpeg`, zero quality → 80):

```
{libraryID}/{fileID}/transforms/w{W}_h{H}_q{Q}.{format}
```

`NeedsTransform(opts)` returns **false** only for `{}` or `{Format:"jpeg"}` — handlers
use it to skip the queue entirely for passthrough requests.

### VipsProcessor.Transform pipeline

`VipsProcessor` implements the `Processor` interface
(`Transform(srcData []byte, opts) ([]byte, string, error)`) using libvips:

1. `vips.NewImageFromBuffer` — decode source bytes.
2. `img.AutoRotate()` — normalize EXIF orientation.
3. `img.ToColorSpace(vips.InterpretationSRGB)` — **bake the ICC profile to sRGB before
   metadata is stripped**, so wide-gamut sources don't render washed-out.
4. **Fit-inside resize** — maintains aspect ratio, uses `vips.KernelLinear`, and
   **never upscales** (gated on `scale < 1.0`).
5. Export per format: JPEG (progressive, `OptimizeCoding`, strip metadata), WebP, AVIF,
   or PNG. Default quality 80.

### ServeTransform: the 5-step concurrency model

`Service.ServeTransform` is what makes a request-time transform feel synchronous while
still running on a shared async worker and deduplicating concurrent requests for the
same derivative:

1. **NFS fast path** — `storageSvc.CacheExists` + `ReadCacheBuffer`. Hit → return now.
2. **Subscribe first** — subscribe to Redis pub/sub channel `imageproxy:done:{cacheKey}`
   *before* enqueueing, so a completion signal can never be missed.
3. **Double-check** — re-check NFS cache and the Redis result key (covers the race where
   a job finished between subscribe and enqueue).
4. **Enqueue** the `image:proxy` task on the `imageproxy` queue, with
   `asynq.Unique(2m)` for dedup (expired locks allow re-enqueue after a failure — avoids
   a permanent block from a stale `TaskID`), `MaxRetry(0)`, `Retention(5m)`.
5. **Wait** on the pub/sub channel up to `transformTimeout = 30s`:
   - `"ok"` → read the Redis result key first (bypasses NFS attribute-cache staleness),
     falling back to NFS with 5 × 100ms retries.
   - `"error:{msg}"` → return the error immediately (fast-fail, not a 30s timeout).
   - context cancel / timeout → return an error.

**Inline fallback:** when `asynqClient == nil || redisClient == nil` (dev/test, no
Redis), `ServeTransform` transforms **synchronously** via `processor.Transform` and
writes the NFS cache directly.

`HasProcessor()` lets callers skip transform entirely (serve the original) when no
libvips processor is configured.

### Worker: TaskHandler.ProcessTask

1. Unmarshal `ImageProxyPayload` (`libraryId`, `fileId`, `cacheKey`, `opts`).
2. `storageSvc.ReadFileBuffer(libraryID, fileID)`.
3. `processor.Transform(srcData, opts)`.
4. `storageSvc.StoreCacheBuffer(cacheKey, outBytes)` — NFS cache.
5. `SET imageproxy:bytes:{cacheKey} {bytes} EX 10m` — transient result bytes
   (non-fatal on failure).
6. `PUBLISH imageproxy:done:{cacheKey}` → `"ok"` or `"error:{msg}"`.

### Redis keys

| Key | Purpose |
|---|---|
| `imageproxy:done:{cacheKey}` | Pub/sub completion channel |
| `imageproxy:bytes:{cacheKey}` | Transient result bytes, TTL 10 min |
| _(asynq unique lock)_ | `asynq.Unique(2m)` dedup |

### The authenticated proxy route

`FileProxyHandler` (`handlers/download.go`) serves images through the proxy. Registered
on `/api/files`:

```
GET /api/files/proxy/*
```

with the path format `/api/files/proxy/{libraryId}/{fileId}/{filename}`.

- **Auth + membership:** requires an authenticated session
  (`middleware.RequireUserID`) and library membership
  (`access.NewService(h.db).GetLibraryAccess`). Because this route lives outside
  `/api/libraries/*`, the membership check is performed manually in the handler.
  **Non-members get `404`, not `403`**, to avoid leaking which libraries/files exist.
- **`parseTransformOptions`** parses `?width`, `?height`, `?quality`, `?format`:
  - `format` allowlist: `jpeg`, `webp`, `avif`, `png`.
  - width/height clamped to `maxTransformDimension = 4096` — a guard against
    memory-exhaustion via crafted query params against the libvips allocator.
  - quality clamped to 1–100.
- If transform params are set, MIME is `image/*`, and `imgSvc.HasProcessor()`, the
  handler calls `imgSvc.ServeTransform` and responds with
  `Cache-Control: public, max-age=31536000, immutable`.
- The no-transform path streams the original file with
  `Cache-Control: public, max-age=31536000`.

> **Note:** `docs/backend-top10-plan.md` historically tracked this proxy route as an
> unauthenticated-access gap; the membership-gated, `404`-on-non-member behavior
> described above is the hardened version.

### Frontend: AlcovesImage.vue

`frontend/app/components/AlcovesImage.vue` is the single component used everywhere an
image is displayed. Props: `libraryId`, `fileId`, `alt?`, `width?`, `height?`,
`format?` (default `"jpeg"`), `quality?` (default `80`).

It builds the proxy URL with query params **sorted alphabetically** (stable cache-key
ordering) and sets `crossorigin="use-credentials"` (the proxy requires the session
cookie), `loading="lazy"`, `decoding="async"`, `draggable="false"`. It emits `load` and
`error`. Grid cards (`LibraryEntryCard.vue`) and the full-screen `FilePreview.vue` build
on this.

---

## Video proxy & thumbnails (`services/videoproxy`)

Browsers can't play every container/codec a user uploads. The video proxy transcodes
non-web-friendly video to a standardized MP4 (H.264/AAC, `+faststart`) and generates
thumbnails for grid/preview display.

**Files:** `service.go`, `worker.go` (+ `service_test.go`).

### Tasks

| Task | Constant | Work |
|---|---|---|
| `video:proxy` | `TaskTypeVideoProxy` | ffprobe → (maybe) transcode → thumbnail |
| `video:thumbnail` | `TaskTypeVideoThumb` | JPEG thumbnail only (1280px wide) |

Both enqueued with `asynq.Retention(24h)`. Payloads: `VideoProxyPayload{fileId,
libraryId, force}` and `VideoThumbnailPayload{fileId, libraryId}`.

### processVideo (video:proxy)

1. Load `models.File`; **skip** if not found, not `video/*`, or already
   `proxy_status = "ready"` (idempotent).
2. Set `proxy_status = "processing"`, `proxy_progress = 0`.
3. Stage the source blob to `os.MkdirTemp` via `storage.OpenFileReadStream`.
4. **`probeVideo` (ffprobe)** — `ffprobe -print_format json -show_streams`. If the source
   is **H.264 video + AAC audio (or no audio) + MP4/MOV container + height ≤ 1080** and
   `force=false`, the file is already web-playable: mark `proxy_status = "not_needed"`
   and still generate a thumbnail. This skip logic avoids re-encoding the common case.
5. **Duration probe** (`ffprobe -show_entries format=duration`) for progress ETA.
6. **`transcodeVideo` (ffmpeg)** —
   `libx264 -crf 23 -preset medium -profile:v high -level:v 4.1 -pix_fmt yuv420p
   -c:a aac -b:a 128k -ac 2 -movflags +faststart`, scaling down to `maxHeight=1080`
   (`-vf scale=-2:1080`) when needed. Parses `ffmpeg -progress pipe:2`
   (`out_time`, `speed`, `progress`) to call `setProxyState(fileID, "processing",
   &percent, &etaSeconds)` on change.
7. Create a derived proxy `models.File` row (`source_file_id = &file.ID`,
   `mime_type = "video/mp4"`) and `storage.StoreFile(...)` the output.
8. **Thumbnail** (`generateThumbnail`) — WebP 480px wide, stored to cache key
   `{libraryID}/{fileID}/thumbnail.webp`.
9. Set `proxy_status = "ready"`, `proxy_progress = 100`.
10. Emit `activity.ActionSystemVideoProxyReady` via `activitySvc.EmitAsync`.

### processVideoThumbnail (video:thumbnail)

Skips derived files (`source_file_id IS NOT NULL`). Generates a **JPEG 1280px-wide**
thumbnail via `generateJPEGThumbnail` (`-q:v 3`), soft-deletes any previous
`image/jpeg` thumbnail for the source file (`trashed_at = now`), creates a new derived
`File` row (`source_file_id`, `mime_type = "image/jpeg"`), and updates
`files.thumbnail_file_id` on the source.

### Thumbnail HDR/SDR 4-strategy fallback

Thumbnail extraction tries up to **4 ffmpeg strategies in order** to handle HDR vs SDR
sources gracefully:

1. **Auto HDR → BT.709** — `thumbnailColorFilter`: linearize → Hable tone-map
   (`tonemap=hable:desat=0`) → BT.709 YUV420p. Requires ffmpeg built with `zscale`
   (libzimg).
2. **Fallback SDR explicit** — `thumbnailFallbackSDR`: same chain but explicitly
   declares the source as BT.709 (for untagged content).
3. **Fallback SDR no-seek.**
4. **Simple scale** — last resort.

### ShouldCreateProxyByDefault

```go
ShouldCreateProxyByDefault(mimeType string) bool
```

Returns `false` for `video/mp4`, `video/webm`, `video/ogg` (already web-playable) and
`true` for everything else (including empty). MIME is normalized (lowercased, trimmed).
The upload handlers (`file.go` streaming `Upload`, `tus.go` `finishUpload`) use this to
decide whether to auto-enqueue `video:proxy`.

### EnqueueExistingVideoThumbnails

Bulk-enqueues `video:thumbnail` for all non-trashed, non-derived video files in a
library. Surfaced via `FileHandler.ReprocessVideoThumbnails` (library owner only) at
`POST /api/libraries/:id/files/video-thumbnails/reprocess` and the library settings UI.

### proxy_status state machine

`proxy_status` cycles through `queued` → `processing` → (`ready` | `not_needed` |
`failed`), with `proxy_progress` (0–100) and `proxy_eta_seconds` updated during
transcode. Related handler endpoints in `handlers/file.go`:

- `POST /api/libraries/:id/files/:fileId/proxy` (`GenerateProxy`) — expire old proxies,
  set `proxy_status=queued`, `videoSvc.EnqueueVideoProxy`.
- `GET /api/libraries/:id/files/:fileId/playback-sources` (`PlaybackSources`) — returns
  `{defaultSourceId, sources[]}` (original + any proxy `File` rows, with a legacy
  `{libraryId}/{fileId}/proxy.mp4` cache fallback).
- `GET /api/libraries/:id/files/:fileId/proxy` / `.../thumbnail` — serve legacy
  cache-keyed proxy/thumbnail with HTTP Range support, redirecting to a derived `File`
  when one exists.

The frontend `FilePreview.vue` and `editor/VideoEditorPlayer.vue` consume
`playback-sources`, offer a source/proxy dropdown, and poll `GET .../files/:fileId`
every 2s while `proxyStatus` is `queued`/`processing` (showing progress + ETA).

---

## Waveforms (`services/waveform`)

The video editor draws an audio waveform under the timeline so users can see where sound
happens. The waveform service extracts peak amplitudes from a file's audio track and
caches them as JSON.

**Files:** `service.go`, `worker.go` (+ `worker_test.go`). Task type:
`file:waveform` (`TaskTypeWaveform`), `Retention(24h)`. Payload: `{libraryId, fileId}`.

### TaskHandler.run pipeline

1. Load `models.File`; **skip** unless MIME is `audio/*` or `video/*`.
2. Capture `file.WaveformVersion` (a guard for detecting a file replaced mid-job).
3. Set `waveform_status = "processing"`, `waveform_progress = 0`.
4. Stage source to `os.MkdirTemp`.
5. **`probeAudioStream`** — run `ffmpeg -f null -` and check stderr for `"Stream #0"`.
   No audio stream → store an empty waveform JSON and mark complete.
6. **`extractPCM`** — `ffmpeg -vn -ac 1 -ar 16000 -f f32le -acodec pcm_f32le`:
   raw float32 little-endian PCM, **mono, 16 kHz**.
7. **`computePeaks`** — streaming, window-based (no full-file load):
   - window = `sampleRateHz / peaksPerSec = 16000 / 50 = 320 samples`
   - each window emits **max `|sample|`** (max-abs), clamped to `[0, 1]`
   - **no per-file normalization** (quiet files stay quiet)
   - partial trailing window is dropped; 64 KiB read buffer, one reused window buffer
8. Serialize `{ peaks: []float64, peaksPerSecond: 50, sampleRate: 16000 }` and store at
   cache key `{libraryID}/{fileID}/waveform.json`.
9. **Version re-check** — reload the row; if `WaveformVersion` changed (file replaced),
   discard and return `nil`.
10. Update DB: `waveform_status = "ready"`, `waveform_progress = 100`,
    `waveformed_version`, `waveform_peaks_per_second`.
11. Emit `activity.ActionSystemWaveformReady`.

Constants: `defaultPeaksPerSecond = 50`, `sampleRateHz = 16000`. The ffmpeg binary path
comes from `cfg.FFmpegBinaryPath` (`ALCOVES_FFMPEG_BINARY`), not a hard-coded `"ffmpeg"`.

### Handler endpoints (`handlers/file.go`)

- `POST /api/libraries/:id/files/:fileId/waveform` (`GenerateWaveform`) — set
  `waveform_status=queued`, enqueue.
- `GET /api/libraries/:id/files/:fileId/waveform` (`GetWaveform`) — stream
  `{libraryId}/{fileId}/waveform.json` from cache storage.

### Frontend: useWaveform.ts + useWaveformRenderer.ts

- **`useWaveform.ts`** — loads `WaveformData` once `waveformStatus === "ready"`; watches
  both `waveformStatus` and `waveformedVersion` so it refetches when the job reruns.
  Returns `{ data, peaks, peaksPerSecond, refresh }` (default `peaksPerSecond = 50`).
  Calls `api.files.waveform` → `GET .../files/:fileId/waveform`.
- **`useWaveformRenderer.ts`** — canvas renderer (no API calls). Draws mirrored peaks
  onto a viewport-pinned `<canvas>`, HiDPI-aware via `window.devicePixelRatio`, drawing
  only the visible slice (`scrollLeft / pxPerSec` → `(scrollLeft + viewportWidth) /
  pxPerSec`) and accumulating peak-max per pixel column. Default color
  `rgba(59, 130, 246, 0.85)`. SSR-guarded.

`editor/MomentTimeline.vue` wires these together: a `sticky left:0` canvas row that
redraws only the visible region, click-to-seek (with manual `scrollLeft` correction),
zoom, and auto-follow.

---

## Avatar processing (`services/avatarproc`)

A small, synchronous (non-queued) normalization step for user avatar uploads. Unlike
every other service here, it has no DB, storage, or queue dependency — it is a pure
transform function.

**Files:** `avatarproc.go` (+ `avatarproc_test.go`).

```go
func Process(input []byte) ([]byte, error)
```

Pipeline:

1. Reject empty input → `ErrEmptyInput`.
2. Reject `> 8 MiB` (`MaxInputBytes`) → `ErrInputTooLarge` (guards libvips memory).
3. `vips.NewImageFromBuffer`; decode failure → `ErrInvalidImage`.
4. `img.AutoRotate()` — EXIF orientation.
5. **Center-crop to square** — `side = min(w, h)`, `ExtractArea` centered.
6. **Downscale to ≤ `MaxAvatarSize = 512`px** with `vips.KernelLanczos3` (higher quality
   than the proxy's Linear; never upscales).
7. `ExportWebp` at `WebpQuality = 85`.

Sentinel errors: `ErrEmptyInput`, `ErrInputTooLarge`, `ErrInvalidImage`.

`AvatarHandler.Upload` (`handlers/avatar.go`) calls `avatarproc.Process(data)`, stores
the WebP via `storageSvc.StoreAvatar` (keyed by user UUID), and sets
`users.avatar_url = /api/auth/me/avatar`. The error mapping is `ErrEmptyInput → 400`,
`ErrInputTooLarge → 413`, `ErrInvalidImage → 400`. Avatars are served at
`/api/auth/me/avatar`, `/api/auth/users/:userId/avatar` with
`Cache-Control: private, max-age=300`.

---

## Data model (`files` columns)

The async media jobs use the repeating status/progress/version pattern on the `files`
table (migrations `00005`, `00015`, plus `thumbnail_file_id`/`source_file_id`):

| Service | Columns on `files` |
|---|---|
| Video proxy | `proxy_status`, `proxy_progress`, `proxy_eta_seconds` |
| Waveform | `waveform_status`, `waveform_progress`, `waveform_error`, `waveform_version`, `waveformed_version`, `waveform_peaks_per_second` (default 50) |
| Derivatives | `thumbnail_file_id` (uuid?), `source_file_id` (uuid?) |

The `_version` / `_ed_version` pair implements optimistic re-processing: bumping
`waveform_version` requests a re-run, and a worker compares it against
`waveformed_version` (and re-checks mid-job) to detect stale results from a replaced
file. Derived files (proxies, thumbnails) are always linked to their origin by
`source_file_id` and are excluded from normal file listings and dedup.

---

## How the pieces connect (data flow)

**Upload → derivatives.** On upload (`handlers/file.go` streaming `Upload` or
`handlers/tus.go` `finishUpload`), a `File` row is created and, by MIME:

- image → face/object detection enqueued (if enabled by the library).
- video → `video:thumbnail` always; `video:proxy` if `ShouldCreateProxyByDefault`;
  `file:waveform`; transcription; audio detection.

**Display.** Grid/preview images flow through `AlcovesImage.vue` →
`GET /api/files/proxy/...` → `imgSvc.ServeTransform` (cache hit, or enqueue + 30s wait).
Video thumbnails resolve via `thumbnail_file_id` (a derived `File` served through the
proxy) or the legacy `.../thumbnail` cache route.

**Editing.** The video editor (`pages/libraries/[id]/edit/[fileId].vue`) loads playback
sources, the waveform JSON, and polls job status, then renders the waveform on a canvas
under an interactive moment timeline.

---

## Related code

**Backend services**

- `backend/internal/services/imageproxy/` — `imageproxy.go` (`VipsProcessor`,
  `TransformOptions`, cache key, `NeedsTransform`), `service.go` (`ServeTransform`,
  inline fallback, `HasProcessor`), `worker.go` (`TaskHandler.ProcessTask`).
- `backend/internal/services/videoproxy/` — `service.go`
  (`ShouldCreateProxyByDefault`, `EnqueueExistingVideoThumbnails`), `worker.go`
  (`processVideo`, `processVideoThumbnail`, ffprobe/ffmpeg, 4-strategy thumbnails).
- `backend/internal/services/waveform/` — `service.go`, `worker.go` (`probeAudioStream`,
  `extractPCM`, `computePeaks`, version re-check).
- `backend/internal/services/avatarproc/` — `avatarproc.go` (`Process`, sentinels).
- `backend/internal/services/storage/storage.go` — blob abstraction (scopes, ranges,
  `StoreCacheBuffer`/`StoreCacheStream`/`CacheExists`/`ReadCacheBuffer`).

**Backend handlers**

- `backend/internal/handlers/download.go` — `FileProxyHandler`
  (`GET /api/files/proxy/*`, `parseTransformOptions`, 4096 clamp, format allowlist,
  membership-gated `404`).
- `backend/internal/handlers/file.go` — `GenerateProxy`, `PlaybackSources`,
  `GenerateWaveform`/`GetWaveform`, `ReprocessVideoThumbnails`, legacy `Proxy`/`Thumbnail`.
- `backend/internal/handlers/avatar.go` — avatar upload/serve.

**Worker wiring & config**

- `backend/cmd/server/main.go` — service construction + Asynq mux registration.
- `backend/internal/config/config.go` — `FFmpegBinaryPath` (`ALCOVES_FFMPEG_BINARY`),
  storage paths, queue host/port.

**Frontend**

- `frontend/app/components/AlcovesImage.vue` — proxied image element.
- `frontend/app/components/FilePreview.vue`, `library/LibraryEntryCard.vue` — display.
- `frontend/app/components/editor/MomentTimeline.vue`,
  `editor/VideoEditorPlayer.vue` — editor surfaces.
- `frontend/app/composables/useWaveform.ts`,
  `useWaveformRenderer.ts` — waveform data + canvas rendering.
- `frontend/shared/types/api.ts` — `LibraryFile` job-status fields, `WaveformData`,
  `PlaybackSource`.
