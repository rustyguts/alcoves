# Video Editor, Moments & Highlight Filters

The video editor is Alcoves' workspace for turning a long source video into short,
shareable clips. From a single page you can scrub a zoomable waveform timeline,
mark named time ranges ("moments"), export each moment to a standalone MP4, build
public share links, and surface interesting segments automatically with
**highlight filters** that match against the file's transcript and ONNX audio-event
detections.

This document covers the editor page, the moments domain (CRUD + export +
download), and the highlight-filter expression language end to end — both the
user-facing experience and the underlying routes, jobs, and data model.

---

## What you can do

- **Open any video in the editor** from the library browser (right-click a video →
  "Open in editor", or navigate to `/libraries/:id/edit/:fileId`). The editor
  remembers which folder you came from via a `?from=<folderId>` query param so the
  Back button returns you to the right place.
- **Create moments** — named time ranges on the video. Drag the playhead, press the
  shortcut keys to set in/out points, and a moment block appears on the timeline.
- **Edit moments precisely** — drag a moment bar to move it, drag either edge to
  resize, or type exact start/end seconds in the edit form. Unsaved edits are shown
  in orange and committed in a single batched save.
- **Export a moment** to a standalone, version-stamped MP4 (re-encoded with a
  clean H.264/AAC profile and a faststart MP4 container).
- **Download the exported clip** as a streamed MP4 (supports HTTP Range / seeking).
- **Share a moment publicly** via a tokenized `/s/:token` link (requires the
  library to have sharing enabled).
- **Find highlights automatically** — write expressions like
  `audio:Laughter:40, word:goal` and the editor evaluates them client-side against
  the transcript cues and audio detections, listing every matching segment as a
  one-click seek button.
- **Read and search the transcript**, inspect **audio-event detections**, and
  generate the **waveform** / **transcript** / **audio detections** on demand from
  the header.

---

## The editor page

**Route:** `/libraries/:id/edit/:fileId`
**File:** `frontend/app/pages/libraries/[id]/edit/[fileId].vue`
**Layout:** `dashboard` (full-width — *not* the `library` layout, so there is no
library tab chrome).

### Data it loads

| Call | Endpoint | Purpose |
|---|---|---|
| Library | `GET /api/libraries/:id` | sharing-enabled flag, permissions |
| File | `GET /api/libraries/:id/files/:fileId` | the source video + all job-status fields |

The file response carries every async-job status column the editor cares about:
`proxyStatus`, `transcribeStatus`/`transcribedVersion`/`transcriptModel`,
`audioDetectStatus`/`audioDetectedVersion`/`audioDetectModel`,
`waveformStatus`/`waveformedVersion`/`waveformPeaksPerSecond`.

### Layout grid

The page is a CSS grid `lg:grid-cols-[3fr_2fr]`:

- **Row 1** — `VideoEditorPlayer` (3fr) + `MomentsList` (2fr), clamped to
  `h-[60svh]` / `max-h-[600px]`.
- **Row 2** (full width) — `MomentTimeline`, then `MomentEditForm`,
  `HighlightFiltersPanel`, `TranscriptPanel`, and `AudioDetectionsPanel`.

### Composable wiring

The page is a thin orchestration shell over a stack of composables:

| Composable | Responsibility |
|---|---|
| `useLibraryMoments(libraryId, fileId)` | moment CRUD + export trigger + self-polling |
| `useMomentDownloads(libraryId, fileId, moments, triggerExport)` | "download when ready" queue |
| `useAudioDetections(libraryId, fileId, file)` | loads `AudioDetection[]` |
| `useTranscript(libraryId, fileId, file)` | VTT cues + raw VTT string |
| `useTranscribeJob(...)` / `useAudioDetectJob(...)` / `useWaveformJob(...)` | dispatch + poll the three "generate" jobs |
| `useWaveform(libraryId, fileId, file)` | waveform peak array |
| `useEditorHighlights(libraryId, audioDetections, transcriptVtt)` | highlight-filter facade (create/update/remove/load presets, computed matches/aggregates) |
| `useEditorShortcuts(...)` | keyboard bindings |

### `?from` folder restore

The library browser sets `?from=<folderId>` when it links into the editor. The
editor's Back button reads that param and navigates back to the originating folder,
so deep-linking into a clip and returning lands you exactly where you started.

### Keyboard shortcuts

Registered by `useEditorShortcuts.ts` on a `window` keydown listener (mounted/
unmounted under an `import.meta.client` guard). All shortcuts are skipped when focus
is inside an `input`, `textarea`, or `select`.

| Key | Action |
|---|---|
| `I` / `i` | Set in-point (start) — only when a moment is selected (`hasSelection`) |
| `O` / `o` | Set out-point (end) — only when a moment is selected |
| `M` / `m` (also `N`) | Create new moment |
| `Space` | Toggle playback |

The timeline component (`MomentTimeline`) registers its own additional shortcuts:
`Z`/`X` zoom in/out, `A`/`D` scroll left/right, `C` center on playhead. The
`EditorKeyboardHelpModal` documents the full set.

---

## `MomentTimeline.vue` — the interactive timeline

**File:** `frontend/app/components/editor/MomentTimeline.vue`

This is the heart of the editor. It renders a zoomable, scrollable ruler with the
waveform underneath and draggable moment bars on top.

**Props:** `duration`, `currentTime`, `moments: Moment[]`, `selectedId?`,
`waveformPeaks?: number[] | null`, `waveformPeaksPerSecond?: number | null`.
**Emits:** `seek`, `select-moment`, `save-pending`, `create-moment`,
`open-shortcuts`.

### Zoom and scroll

- **Zoom range 1×–50×**, step factor 1.5×. Ctrl/Meta + scroll-wheel zooms; `Z`/`X`
  zoom from the keyboard. Zoom **preserves the playhead's screen position** so the
  thing you're looking at stays put.
- **Scroll**: `A`/`D` scroll 25% of the viewport; trackpad/wheel scrolls;
  `C` centers on the playhead. The native scrollbar is hidden
  (`scrollbar-width: none`).
- A `ResizeObserver` tracks container width to compute `pxPerSec` and size the
  waveform.

### Ruler ticks

Time ticks are drawn at "nice" intervals (0.1s up to 1h) derived from `pxPerSec`,
with major and minor ticks. Clicking the ruler seeks.

### Draggable moment bars

Each moment renders as a bar that supports three drag modes via
`mousedown`/`mousemove`/`mouseup` listeners attached to `window`:

- **Move** (drag the body)
- **Left-edge resize** (change start)
- **Right-edge resize** (change end)

**Pending-change batching:** while you drag, edits accumulate as *pending* state and
render in **orange** rather than hitting the server on every mouse move. A "Save
changes" button batches all pending edits into a single `save-pending` emit, which
the page turns into the moment update call(s).

**Status pills:** when a moment bar is wider than 120px, a status pill renders
showing `not_processed` / `processing` / `processed` / `failed`, with an SVG
progress ring during processing.

### Waveform canvas

The waveform is a `<canvas>` rendered by the `useWaveformRenderer` composable
(`frontend/app/composables/useWaveformRenderer.ts`). It is **viewport-pinned**
(`sticky left:0`) and only the visible slice is redrawn — the renderer accumulates
peak-max per pixel column over the range
`scrollLeft / pxPerSec … (scrollLeft + viewportWidth) / pxPerSec`, uses
`devicePixelRatio` for HiDPI, and mirrors the peaks vertically. Default color is
`rgba(59, 130, 246, 0.85)`. Clicking the waveform seeks (the sticky row's non-zero
`scrollLeft` is corrected manually).

### Auto-follow and pending reconciliation

- **Auto-follow:** when zoomed in, the timeline auto-scrolls to keep the playhead
  inside a margin.
- **Pending reconciliation:** when the server-side `moments` prop updates with
  values that match a pending edit (within a `0.001s` epsilon), the pending entry is
  dropped — so once the save round-trips, the orange "unsaved" indicator clears
  cleanly without a flash.

---

## Moments: data model & CRUD

### Data model

**Table:** `moments` (migration `00009`), GORM model `models.Moment`.

| Column | Notes |
|---|---|
| `id`, `file_id`, `library_id`, `created_by_id` | identity / ownership |
| `name`, `description` | metadata (`name` defaults to `''`) |
| `start_seconds`, `end_seconds` | `NUMERIC(12,3)`; DB CHECK constraint `end_seconds > start_seconds` |
| `export_status` / `export_progress` / `export_eta_seconds` | export state machine |
| `export_version` | bumped to request a (re-)export; defaults to `1` |
| `exported_version` | last successfully exported version |
| `trashed_at` | soft-delete |

Two related tables: `moment_tags` (M2M to `tags`, unique on `moment_id + tag_id`)
and `moment_shares` (`token` unique, `revoked_at` nullable).

The **`export_version` / `exported_version` pair** is the optimistic-concurrency
mechanism for export — see the export section below.

### Frontend type

`Moment` in `frontend/shared/types/api.ts`:
`{ id, fileId, libraryId, createdById, name, description, startSeconds, endSeconds,
exportStatus, exportProgress, exportEtaSeconds, exportVersion, exportedVersion,
trashedAt, createdAt, updatedAt, tags }`.

### Routes

**Handler:** `backend/internal/handlers/moment.go`, struct
`MomentHandler{db, storage, momentExport, baseURL, activitySvc}`.
**Frontend composable:** `useLibraryMoments.ts` (via `api.moments.*`).

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/libraries/:id/files/:fileId/moments` | list moments for a file |
| POST | `/api/libraries/:id/files/:fileId/moments` | create |
| GET | `/api/libraries/:id/files/:fileId/moments/:momentId` | fetch one |
| PATCH | `/api/libraries/:id/files/:fileId/moments/:momentId` | update |
| DELETE | `/api/libraries/:id/files/:fileId/moments/:momentId` | soft-delete |
| PUT | `/api/libraries/:id/files/:fileId/moments/:momentId/tags` | sync tags (atomic replace) |
| POST | `/api/libraries/:id/files/:fileId/moments/:momentId/export` | trigger export |
| GET | `/api/libraries/:id/files/:fileId/moments/:momentId/download` | stream exported MP4 |
| GET/POST/DELETE | `…/moments/:momentId/shares[/:token]` | share-link management |

### CRUD behavior (`moment.go`)

- **Create** validates `endSeconds > startSeconds` and `startSeconds >= 0`, sets
  `ExportVersion = 1`, and emits an `ActionMomentCreated` activity. The frontend
  `MomentCreate` body is `{ startSeconds, endSeconds, title?, tags? }`.
- **Update**: if the time **range changes**, it bumps `ExportVersion`, clears the
  export status/progress/eta/`exportedVersion`, and deletes the existing export
  cache via `storage.DeleteCachePrefix` — so a previously exported clip is
  invalidated the moment its bounds move. (Metadata-only edits don't touch the
  export.)
- **Delete** sets `trashed_at` (soft-delete).
- **SyncTags** runs in a transaction and validates that every tag ID belongs to the
  library before replacing.

### Self-polling on export status

`useLibraryMoments.ts` runs a 2000ms poll loop whenever any moment's `exportStatus`
is `queued` or `processing` (tracked by a `hasInFlight` watcher). The loop is started
/stopped reactively and torn down on `onUnmounted`. The list is re-sorted by
`startSeconds` after every create/update.

---

## Moment export (the `moment:export` job)

**Service:** `backend/internal/services/momentexport/` (`service.go`, `worker.go`).
**Asynq task type:** `moment:export` (`TaskTypeMomentExport`), `Retention(24h)`.
**Payload:** `{ momentId, fileId, libraryId }`.

### Triggering an export

`POST …/moments/:momentId/export` (handler `MomentHandler.Export`):

- **Skips** if the moment is already exported at the current version
  (`exported_version == export_version`).
- Otherwise marks `export_status = "queued"`, calls `momentExport.Enqueue`, and
  returns **202 Accepted**.

### The worker pipeline (`processMoment`)

1. Load `models.Moment` by `id + library_id + file_id`; must not be trashed.
2. Capture `moment.ExportVersion` as `runVersion`; **skip** if
   `exported_version == runVersion` (idempotent re-runs).
3. Set `export_status = "processing"`, `export_progress = 0`.
4. Stage the source file to a temp dir via `storage.OpenFileReadStream`.
5. Validate `EndSeconds - StartSeconds > 0`.
6. **ffmpeg clip transcode** (`transcodeClip`):
   ```
   -ss {start} -to {end} -accurate_seek -i src
   -c:v libx264 -crf 23 -preset medium -profile:v high -level:v 4.1 -pix_fmt yuv420p
   -vf scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2
   -c:a aac -b:a 128k -ac 2 -movflags +faststart
   ```
   The `scale` filter **clamps** the output to at most 1920×1080 while preserving
   aspect ratio. Progress is parsed from `ffmpeg -progress pipe:2` (`out_time`,
   `speed`) and written back as percent + ETA.
7. **Stale-version self-discard:** reload the moment; if `ExportVersion != runVersion`
   (the user edited the range mid-encode), the output is silently discarded.
8. Stream the result into cache via
   `storage.StoreCacheStream(CacheKey(libraryID, momentID, runVersion), outFile)`
   — it streams rather than buffering the whole MP4.
9. Set `export_status = "ready"`, `export_progress = 100`,
   `exported_version = runVersion`.

### Version-stamped cache key

```
CacheKey(libraryID, momentID, version) = "{libraryID}/moments/{momentID}/v{version}.mp4"
CachePrefix(libraryID, momentID)       = "{libraryID}/moments/{momentID}/"
```

Every version lives under the same prefix, so a range change can sweep all stale
versions with one `DeleteCachePrefix`. Because the cache key is version-stamped, an
old export is never overwritten until a new encode completes successfully — readers
always have a consistent file.

---

## Downloading an exported clip

**Handler:** `MomentHandler.Download` —
`GET /api/libraries/:id/files/:fileId/moments/:momentId/download`.

Streams the exported MP4 from
`momentexport.CacheKey(libID, momentID, exportedVersion)` with HTTP **Range**
support and `Content-Disposition: attachment`.

**Frontend queue:** `useMomentDownloads.ts` implements a "download when ready" UX:

- `request(momentId)` — if the moment is already ready
  (`exportStatus === "ready"` **and** `exportedVersion === exportVersion`), it
  navigates immediately to `api.moments.downloadUrl(...)` via
  `window.location.href`.
- Otherwise it triggers the export and adds the id to `pendingIds`. A watcher on the
  `moments` list navigates as soon as the clip becomes ready, and removes the id +
  shows an error toast if export `"failed"`.

Returns `{ pendingIds, isPending(id), request }`.

---

## Public share links

Moment shares power the `/s/:token` public landing pages. Creating a share requires
`library.sharing_enabled = true`.

- **Create** (`MomentHandler.CreateShare`): generates a 192-bit
  `base64.RawURLEncoding` token, emits `ActionMomentShared`.
- **Revoke**: sets `revoked_at`, returns 204.
- **Public endpoints** (`backend/internal/handlers/share.go`, no auth, allowlisted in
  auth middleware): `GET /api/share/:token` (metadata),
  `GET /api/share/:token/video` (streamed MP4 with Range, ETag `"v{exportedVersion}"`),
  `GET /api/share/:token/thumbnail`. Metadata reports `ready: true` only when
  `ExportedVersion != nil && ExportStatus == "ready"`, and only then includes the
  video/thumbnail URLs.

**Frontend:** `MomentShareModal.vue` lists/creates/revokes shares via
`api.moments.listShares|createShare|revokeShare`. If `sharingEnabled` is false the
Create button is disabled with a pointer to library settings. The share landing page
itself is `frontend/app/pages/s/[token].vue` — the only SSR page in the app (for
OpenGraph/Twitter player tags).

---

## Highlight filters

Highlight filters are named, per-library expressions that automatically surface
interesting segments of a video by matching against its **transcript cues** and
**audio-event detections**. The matching runs **client-side** in the editor, so
results update instantly as the transcript and detections load.

### The expression DSL

**Parser:** `frontend/app/utils/highlight-expression.ts`.

```
expression := orGroup ( "," orGroup )*
orGroup    := andTerm ( ("&" | "AND") andTerm )*
andTerm    := [ type ":" ] value [ ":" score ]
type       := "audio" | "word" | "keyword" | "text"
value      := bareWord | quotedString
score      := integer 0-100   (audio only; normalized to 0-1)
```

- **Comma = OR**, **`&` (or `AND`) = AND**.
- `word:foo` / `keyword:foo` / `text:foo` → match a transcript cue containing `foo`.
- `audio:Laughter` → match an audio detection whose label contains `Laughter`.
  Audio is the **default type**, so a bare `Laughter` is treated as `audio:Laughter`.
- `:NN` suffix on an audio term sets the **minimum score** as a percentage (e.g.
  `audio:Cheering:40` → min score 0.40). Default audio min score is `0.2`.
- Quoted values may contain spaces; type prefixes and `OR`/`AND` keywords are
  case-insensitive. Parse errors are collected non-fatally in `errors`.

`Term = { type, value, minScore }`, `AndGroup = { terms }`,
`ParsedExpression = { groups, errors }`. `formatTerm` serializes a term back to
canonical DSL (omits `audio:` prefix and the default `0.2` score).

### Proximity matching (`evaluateAndGroup`)

For an AND group, the first term produces *anchor* hits. Each subsequent AND term
must have a hit whose **midpoint** is within `filter.proximitySeconds` of the
anchor's midpoint. This is how you express "laughter **and** the word 'wow' close
together". Results are deduped by a `startSeconds|endSeconds` key.

The composable `useHighlightMatches(filters, audioDetections, transcriptVtt)`
(in `useHighlightFilters.ts`) returns:

- `cues` — VTT cues parsed via `parseVtt` (`frontend/app/utils/parse-vtt.ts`).
- `matches: Record<filterId, FilterMatch[]>` —
  `FilterMatch = { filterId, startSeconds, endSeconds, score: 0-1, evidence: string[] }`.
- `aggregates: Record<filterId, FilterAggregate>` —
  `{ count, meanScore, maxScore, expressionErrors }`.

### Presets

`useHighlightFilters.loadPresets()` batch-creates 7 built-in presets from
`HIGHLIGHT_PRESETS`: Laughter, Screaming, Cheering, Gunshot, Profanity, Reactions,
and Funny clip. Per-preset errors are ignored. The "Load presets" affordance is
offered when a library has no filters yet.

### Data model & routes

**Table:** `highlight_filters` (migrations `00012`/`00013`). Current schema uses a
free-form `expression TEXT`, `proximity_seconds INTEGER DEFAULT 5`, and
`color TEXT DEFAULT '#3B82F6'` (the rigid `kind`/`pattern`/`min_score` schema from
`00012` was migrated into expression strings in `00013`).

**Handler:** `backend/internal/handlers/highlight_filter.go`,
`HighlightFilterHandler{db}`:

| Method | Path |
|---|---|
| GET | `/api/libraries/:id/highlight-filters` |
| POST | `/api/libraries/:id/highlight-filters` |
| PATCH | `/api/libraries/:id/highlight-filters/:filterId` |
| DELETE | `/api/libraries/:id/highlight-filters/:filterId` |

`Create` requires `name` + `expression`; `proximitySeconds` is clamped to
`[0, 60]` (default 5) by `clampProximity`; `color` defaults to `#3B82F6`.

**Frontend type:** `HighlightFilter` =
`{ id, libraryId, createdById, name, expression, proximitySeconds, color,
createdAt, updatedAt }`.

### UI: `HighlightFiltersPanel.vue`

`frontend/app/components/editor/HighlightFiltersPanel.vue` — inline add/edit forms
(`UInput` + native `<input type="color">`). Each filter shows its aggregates
(`count`, `meanScore`, `maxScore`); parse errors raise a warning badge. Matches are
clickable seek buttons (timestamp + score + evidence), sorted by match count
descending. The panel is gated on `hasSignals` — `useEditorHighlights` computes
`hasSignals = audioDetections.length > 0 || transcriptVtt.length > 0`.

---

## Editor sub-components

| Component | File | Role |
|---|---|---|
| `VideoEditorPlayer` | `components/editor/VideoEditorPlayer.vue` | vidstack player; lazy-imports `vidstack/player` in `onMounted`; loads sources via `api.files.playbackSources`, defaults to `defaultSourceId`; `crossorigin="use-credentials"`; ResizeObserver keeps a 16:9 letterbox. Emits `update:currentTime/duration/paused`; exposes `seek()`, `togglePlay()`. |
| `MomentsList` | `components/editor/MomentsList.vue` | sidebar list sorted by `startSeconds`; shows name, range, duration, export-status badge (`queued`/`processing`/`ready`/`failed` with `exportProgress`). Enter/Space select. |
| `MomentEditForm` | `components/editor/MomentEditForm.vue` | metadata editor for the selected moment; mirrors `name/description/start/end`; Save clamps `start >= 0`, `end > start + 0.001`. Emits `save`, `set-to-playhead`, `delete`, `close`, `export`, `download`, `share`. |
| `MomentShareModal` | `components/editor/MomentShareModal.vue` | share-link CRUD (see Share section). |
| `EditorHeader` | `components/editor/EditorHeader.vue` | Back + filename + job buttons (Transcribe / Audio Detect / Waveform). Button state is driven by `JobStatusButton` objects from `~/utils/job-status-button`. Emits `back`, `transcribe`, `audio-detect`, `waveform`. |
| `TranscriptPanel` | `components/editor/TranscriptPanel.vue` | VTT cues (search + active-cue auto-scroll) and a "Top words" frequency tab. Emits `seek`. |
| `AudioDetectionsPanel` | `components/editor/AudioDetectionsPanel.vue` | buckets `AudioDetection[]` by label with per-window timeline strips; click to seek. |
| `EditorKeyboardHelpModal` | `components/editor/EditorKeyboardHelpModal.vue` | static shortcut reference. |

The header "generate" buttons dispatch the three supporting jobs — these are not
moment-specific but feed the timeline (waveform) and highlight filters (transcript,
audio detections):

- **Transcribe** → `POST /api/libraries/:id/files/:fileId/transcribe`
  (`useTranscribeJob`).
- **Audio Detect** → `POST /api/libraries/:id/files/:fileId/audio-detect`
  (`useAudioDetectJob`; requires a ready transcript first on the backend).
- **Waveform** → `POST /api/libraries/:id/files/:fileId/waveform`
  (`useWaveformJob`). The waveform JSON is read back from
  `GET /api/libraries/:id/files/:fileId/waveform`
  (`{ peaks, peaksPerSecond, sampleRate }`).

All three use the generic `useAsyncJobStatus` polling engine (2s interval; success/
failure toasts; cleanup on `onBeforeUnmount`).

---

## Related code

**Backend**

- `backend/internal/handlers/moment.go` — moment + share CRUD, export trigger, download
- `backend/internal/handlers/moment_share.go`, `share.go` — public share endpoints
- `backend/internal/handlers/highlight_filter.go` — highlight-filter CRUD
- `backend/internal/services/momentexport/` (`service.go`, `worker.go`) — `moment:export` job, version-stamped cache keys
- `backend/internal/services/waveform/` — `file:waveform` peaks (50 windows/sec, mono 16kHz)
- `backend/internal/models/models.go` — `Moment`, `MomentTag`, `MomentShare`, `HighlightFilter`, `AudioDetection`
- `backend/migrations/00009_*` (moments), `00012`/`00013` (highlight filters), `00015` (waveform fields)

**Frontend — page & composables**

- `frontend/app/pages/libraries/[id]/edit/[fileId].vue` — the editor page
- `frontend/app/composables/useLibraryMoments.ts` — moment CRUD + self-polling
- `frontend/app/composables/useMomentDownloads.ts` — download-when-ready queue
- `frontend/app/composables/useHighlightFilters.ts` — filter CRUD + match engine
- `frontend/app/composables/useEditorHighlights.ts` — editor-page highlight facade
- `frontend/app/composables/useEditorShortcuts.ts` — keyboard bindings
- `frontend/app/composables/useWaveformRenderer.ts` — canvas waveform renderer

**Frontend — components & utils**

- `frontend/app/components/editor/*` — `VideoEditorPlayer`, `MomentTimeline`, `MomentsList`, `MomentEditForm`, `MomentShareModal`, `EditorHeader`, `TranscriptPanel`, `AudioDetectionsPanel`, `HighlightFiltersPanel`, `EditorKeyboardHelpModal`
- `frontend/app/utils/highlight-expression.ts` — DSL parser
- `frontend/app/utils/parse-vtt.ts` — WebVTT parser
- `frontend/app/utils/job-status-button.ts` — job-button rendering helper
- `frontend/shared/types/api.ts` — `Moment`, `MomentShare`, `HighlightFilter`, `AudioDetection`, `WaveformData`, `PlaybackSource`
