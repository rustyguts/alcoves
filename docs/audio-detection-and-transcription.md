# AI: Audio Event Detection & Speech Transcription

Alcoves runs two CPU-only audio-ML pipelines over any video or audio file in a
library:

- **Audio event detection** — classifies *sounds* (laughter, applause,
  gunshot, music, speech, ...) into AudioSet's 527-class taxonomy, producing a
  timeline of timestamped, scored detections.
- **Speech transcription** — transcribes spoken words into plain text plus
  WebVTT subtitles using whisper.cpp.

Both are designed to power the video editor: detections and transcript cues
become a searchable, seekable overlay on the moment timeline, and they feed the
**highlight filters** engine (e.g. "find every moment where there is laughter
*and* the word 'wow' within 5 seconds").

This document covers what the features do for a user, how the backend job
pipelines work, the data model, the HTTP endpoints, and the frontend
composables/components that drive the UI.

---

## What it does (user-facing)

Open a video or audio file in the editor (`/libraries/:id/edit/:fileId`). The
editor toolbar exposes three async actions backed by these pipelines:

- **Transcribe** — runs whisper.cpp over the file's audio track. When ready,
  the **Transcript panel** shows time-coded cues you can click to seek, a
  full-text search box, and a "top words" frequency view.
- **Detect audio** — runs the audio-event tagger. When ready, the **Audio
  detections panel** buckets results by sound label (e.g. "Speech",
  "Laughter", "Music"), each with a best-score badge, hit count, and a clickable
  timeline strip.
- Both buttons report live progress (`Transcribing 42%`, etc.), turn into a
  "Retry" affordance on failure, and a "Re-transcribe" / re-run affordance once
  complete.

Both pipelines can also be run in bulk across a whole library from **Library →
Settings** (Transcription / Audio Event Detection sections) or from the library
browser's multi-select context menu ("Transcribe N files", "Detect audio in N
files").

The instance **owner** can change which model each pipeline uses at runtime in
**Admin → Inference Models** (whisper model + language; audio tagger model)
without restarting — see [Runtime model selection](#runtime-model-selection).

### Dependency: audio detection requires a ready transcript

`POST .../audio-detect` (the single-file endpoint) is gated on transcription
having completed first — `GenerateAudioDetections` in `handlers/file.go`
requires the file's transcript to be ready before it will enqueue the
audio-detect job. In the editor, the **Detect audio** button is enabled via the
`canDetectAudio` prop accordingly. (The bulk `bulk-audio-detect` endpoint does
not impose this per-file gate; it enqueues across eligible source files.)

---

## How it works

Neither pipeline registers HTTP routes itself. They are **Asynq** task
producers/consumers wired into the worker mux in `backend/cmd/server/main.go`
and invoked from `backend/internal/handlers/file.go`. Workers run when
`ALCOVES_MODE=all` (default) or `ALCOVES_MODE=worker`.

Shared shape for both services:

1. A `Service` facade that enqueues tasks and (for audio detection) answers
   list queries.
2. A `TaskHandler` that processes one job: stage the source blob to a temp
   dir, extract PCM/WAV with **ffmpeg**, run inference, write results to the DB,
   and stamp progress/version columns on the `files` row.
3. On-demand model download with a 6-attempt exponential-backoff retry
   (capped at 30 s), atomic temp-file rename, and an LFS-pointer / HTML-response
   guard.
4. The `files` row carries a per-job state machine
   (`*_status / *_progress / *_eta_seconds / *_error`) and an optimistic
   versioning pair (`*_version` requested, `*ed_version` completed).

---

## Audio event detection

Package: `backend/internal/services/audiodetection/`
Asynq task type: **`file:audio-detect`**
Payload: `{ libraryId, fileId }`

### Model registry

`registry.go` defines `var Registry map[string]ModelSpec` with seven selectable
ONNX models. Each ONNX file bakes its own mel-spectrogram transform into the
graph, so the Go worker always feeds **raw mono float32 PCM** regardless of
model family.

| ID | File | Sample rate | Disk | mAP | License |
|---|---|---|---|---|---|
| `pann_cnn14` (legacy) | `panns_cnn14.onnx` | 32000 | 313 MB | 0.431 | Apache-2.0 |
| `efficientat_mn04` | `efficientat_mn04_as.onnx` | 32000 | 5 MB | 0.432 | MIT |
| **`efficientat_mn10` (default)** | `efficientat_mn10_as.onnx` | 32000 | 20 MB | 0.471 | MIT |
| `efficientat_mn40` | `efficientat_mn40_as_ext.onnx` | 32000 | 280 MB | 0.487 | MIT |
| `ced_tiny` | `ced_tiny.onnx` | 16000 | 22 MB | 0.481 | Apache-2.0 |
| `ced_small` | `ced_small.onnx` | 16000 | 85 MB | 0.496 | Apache-2.0 |
| `ced_base` | `ced_base.onnx` | 16000 | 330 MB | 0.500 | Apache-2.0 |

- `DefaultModelID = "efficientat_mn10"`; `LegacyModelID = "pann_cnn14"` is kept
  in the registry for rollback.
- `LookupSpec(id)` falls back to the default for an empty or unknown ID.
- `ModelList()` returns a deterministically sorted slice for stable API
  responses.
- `IsValidModelID(id)` is used by the admin settings handler to validate the
  selected model before persisting.
- Sample rate is per-model: CED variants run at **16 kHz**; PANN and
  EfficientAT run at **32 kHz**.

### ONNX session loading & probing

`LoadSession(modelPath, sampleRate)` (in `models.go`) handles the fact that
these models come from different export toolchains with different tensor names.
It probes a matrix of **12 input names × 8 output names**, creating a
`DynamicAdvancedSession` and running a one-second silent probe (`[1, sampleRate]`
of float32 zeros) for each combination, keeping the first that succeeds. It
returns a `sessionInfo{ session, inputName, outputName }`.

Input names tried: `audio`, `input`, `waveform`, `x`, `input_1`, `input:0`,
`input_values`, `input.1`, `spec`, `mel`, `wav`, `audio_input`.
Output names tried: `clipwise_output`, `output`, `logits`, `pred`, `preds`,
`Identity`, `Identity:0`, `Identity_1:0`.

Asset download is `EnsureAssets(modelsDir, modelFile, modelURL, labelsURL)`,
which fetches the `.onnx` model (min 1 MB) and the AudioSet labels CSV (min
1024 bytes) if missing. `LoadLabels(path)` parses the AudioSet CSV
(`index,mid,display_name`), skips the header, and returns the 527
`display_name` values.

### Package-level session cache (and the documented leak)

`worker.go` keeps a process-wide cached session keyed by
`"{modelPath}|{sampleRate}"`, guarded by a `sync.Mutex`:

- `getSession(modelPath, sampleRate)` returns the cached session when the key
  matches; otherwise it calls `LoadSession`.
- When an admin changes the model, the cache key changes and a new session is
  loaded. **The old session is intentionally not `Destroy()`-ed** — this is a
  documented, accepted leak of one session per model switch (a rare admin
  action), chosen over the use-after-free risk of tearing down a session that
  may still be in flight.
- Failed loads are *not* cached, so a transient download/probe failure is
  retryable.

`ort.DynamicAdvancedSession.Run()` is not safe to call concurrently, so the
worker takes `sessionMu` around each inference.

### Worker pipeline (`TaskHandler.run`)

Enqueue uses **`asynq.Unique(2 * time.Hour)`** to gate duplicate enqueues for
the same file. This guards against double-clicks and pod races on the
`audio_detect_progress` updates and on the final DELETE+INSERT.

1. Guard: file must exist, not be trashed, and have MIME `video/*` or
   `audio/*`. Captures `file.AudioDetectVersion` for optimistic versioning.
2. Sets `audio_detect_status = "processing"`, `audio_detect_progress = 0`.
3. `copySourceToTemp` via `storage.OpenFileReadStream`.
4. `extractAudio` via ffmpeg:
   `ffmpeg -vn -ac 1 -ar {sampleRate} -f f32le -acodec pcm_f32le` — 16 kHz for
   CED, 32 kHz for PANN/EfficientAT.
5. Validates the PCM size: must be a multiple of 4 (float32) and at least
   `sampleRate/2` samples (0.5 s minimum).
6. `EnsureAssets` + `LoadLabels` + `getSession`.
7. **Streaming window loop** (O(window) RAM, not O(total samples)):
   - `windowLen = AudioDetectWindowSec * sampleRate` (default 10 s window).
   - Opens the PCM file with a 64 KB `bufio.Reader`.
   - Per window: `io.ReadFull` into a reused buffer, `decodePCMBytes`
     (little-endian float32, zero-pads the final partial window),
     `runInference` under the session lock.
   - `runInference` builds a `[1, windowLen]` tensor and **auto-applies
     sigmoid** when the output contains values outside `[-0.01, 1.01]` (i.e.
     the model emitted logits rather than probabilities).
   - `topKAbove(probs, AudioDetectTopK, AudioDetectThreshold)` filters by the
     probability threshold and keeps the top-K by score.
   - Appends `models.AudioDetection` records with `start_seconds`,
     `end_seconds`, `label`, `class_index`, `score`, and
     `version = targetVersion + 1`.
   - Updates `audio_detect_progress` per window.
8. **Transactional replace**: in a single DB transaction, `DELETE` all
   `audio_detections WHERE file_id = ?`, bulk-`INSERT` the new detections, and
   `UPDATE` the file columns to `audio_detect_status = "ready"`,
   `audio_detect_progress = 100`, `audio_detect_version = newVersion`,
   `audio_detected_version = newVersion`, `audio_detect_model = spec.ID`.

`setState` / `fail` helpers update the
`audio_detect_{status,progress,eta_seconds,error}` columns on `files`.

### Config / env vars

Consumed from `config.Config`:

| Env var | Default | Purpose |
|---|---|---|
| `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Base URL for ONNX model downloads |
| `ALCOVES_AUDIO_DETECT_LABELS_URL` | `.../audioset_class_labels_indices.csv` | AudioSet labels CSV |
| `ALCOVES_AUDIO_DETECT_WINDOW_SEC` | `10.0` | Inference window length (seconds) |
| `ALCOVES_AUDIO_DETECT_TOP_K` | `5` | Max labels kept per window |
| `ALCOVES_AUDIO_DETECT_THRESHOLD` | `0.2` | Min probability to keep a label |
| `ALCOVES_MODELS_PATH` | `{data}/.models` | Local model cache directory |
| `ALCOVES_FFMPEG_BINARY` | `ffmpeg` | ffmpeg binary path |

### Data model

`audio_detections` table (migration `00011`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `file_id` | uuid | FK -> `files(id) ON DELETE CASCADE` |
| `library_id` | uuid | FK -> `libraries(id) ON DELETE CASCADE` |
| `label` | text | AudioSet display name |
| `class_index` | int | AudioSet class index |
| `score` | real/float32 | post-sigmoid probability |
| `start_seconds` | real/float32 | window start |
| `end_seconds` | real/float32 | window end |
| `version` | int | stamp from the producing run |

Indexes: `file_id`, `library_id`, `(file_id, start_seconds)` (timeline range
queries).

The same migration adds the `files` columns: `audio_detect_status`,
`audio_detect_progress`, `audio_detect_eta_seconds`, `audio_detect_error`,
`audio_detect_version` (default 0), `audio_detected_version`,
`audio_detect_model`.

### Service API

```go
func NewService(db, storage, asynqClient, cfg, settingsSvc) *Service
func (s) EnqueueDetect(libraryID, fileID string) error             // 2h dedup
func (s) ListByFile(libraryID, fileID string) ([]models.AudioDetection, error)
func (s) NewTaskHandler() *TaskHandler
```

---

## Speech transcription

Package: `backend/internal/services/transcribe/`
Asynq task type: **`file:transcribe`**
Payload: `{ libraryId, fileId }`

Unlike audio detection, transcription shells out to the external **whisper.cpp**
`whisper-cli` binary (built into the Docker image at `v1.8.4`), and it does
**not** use an `asynq.Unique` dedup option.

### Model registry

`whisper_models.go` defines `var WhisperModels []WhisperModelSpec`, nine entries
ordered tiny -> large, used to render the admin selector. Model files on disk are
`ggml-{ID}.bin`, downloaded from `cfg.WhisperModelBaseURL + "/ggml-{ID}.bin"`.

| ID | Disk | RAM peak | WER (clean) | Notes |
|---|---|---|---|---|
| `tiny` | 75 MB | 390 MB | 7.5% | Fastest |
| `base` | 142 MB | 500 MB | 5.0% | |
| `small` | 466 MB | 1000 MB | 3.4% | |
| `medium` | 1500 MB | 2500 MB | 3.0% | Previous default |
| **`large-v3` (default)** | 3100 MB | 3900 MB | 2.7% | Current default |
| `large-v3-q5_0` | 1080 MB | 1300 MB | 2.9% | Quantized |
| `large-v3-turbo-q5_0` | 574 MB | 900 MB | 3.0% | ~8x faster than v3 |
| `large-v3-turbo-q4_0` | 470 MB | 800 MB | 3.2% | Smallest near-SOTA |
| `distil-large-v3.5-q5` | 600 MB | 1000 MB | 3.0% | English-only |

- `IsValidWhisperModel(id)` and `IsValidWhisperLanguage(lang)` are used by the
  admin settings handler to validate before persistence.
- `WhisperLanguages`:
  `["auto","en","fr","de","es","it","pt","nl","ja","zh","ko","ru"]`.

### Worker pipeline (`TaskHandler.run`)

1. Guard: file exists, not trashed, MIME `video/*` or `audio/*`. Captures
   `file.TranscribeVersion`.
2. Sets `transcribe_status = "processing"`, `transcribe_progress = 0`.
3. `copySourceToTemp` via `storage.OpenFileReadStream`.
4. `extractAudio`: ffmpeg mono 16 kHz 16-bit PCM WAV
   (`-ac 1 -ar 16000 -acodec pcm_s16le`).
5. `wavDurationSeconds(wavPath)` estimates duration from the WAV size
   (`(size - 44) / 32000`) for progress math.
6. `ensureModel(...)`: stat check then HTTP download (6-attempt retry, atomic
   `.part` rename) of `ggml-{model}.bin`.
7. Optionally `ensureModel` for `cfg.WhisperVADModel` (Silero VAD,
   `ggml-silero-v6.2.0.bin`). **VAD is required to suppress repetition-loop
   hallucinations on non-speech audio.**
8. `buildWhisperArgs(...)` — **anti-hallucination flags are always included**:
   - `-mc 0` (no prior-segment prompt context)
   - `-sns` (suppress non-speech tokens)
   - `--vad --vad-model {path}` when a VAD model is present
   - `-l {lang}` is omitted when the language is `"auto"`.
9. `runWhisper`: invokes via `stdbuf -oL -eL {binary} {args}` when `stdbuf` is
   on PATH, forcing line-buffered stdout/stderr so progress is not stalled by a
   4 KB pipe buffer on long audio. Reads stdout + stderr concurrently; the last
   error line is captured for diagnostics.
10. `progressTracker.consume(line)` per output line:
    - `[HH:MM:SS.mmm --> HH:MM:SS.mmm]` segment lines ->
      `pct = endSec / audioSec * 100`.
    - `progress = N%` lines (from the `-pp` flag) as a fallback signal.
    - **Monotonic**: any value <= the last reported percent is skipped; the
      value is clamped to 99 (100 is reserved for the post-write done state).
11. Reads `out.txt` (plain text) and `out.vtt` (WebVTT subtitles).
12. GORM `UPDATE` on `files`: `transcribe_status = "ready"`,
    `transcribe_progress = 100`, `transcript_text`, `transcript_vtt`,
    `transcript_model = modelName`, `transcribed_version = targetVersion`. (This
    is a direct update, *not* wrapped in a transaction — unlike audio
    detection's DELETE+INSERT.)
13. Emits an **`activity.ActionSystemTranscribeReady`** event via
    `activitySvc.EmitAsync` with `{ fileId, fileName, model }` metadata
    (surfaces in the library Feed; excluded from the global notification bell
    because it is a `system.*` action).

### Config / env vars

| Env var | Default | Purpose |
|---|---|---|
| `ALCOVES_WHISPER_BINARY` | `whisper-cli` | Path to the whisper.cpp CLI |
| `ALCOVES_WHISPER_MODEL` | `large-v3` | Boot-time default model |
| `ALCOVES_WHISPER_LANGUAGE` | `auto` | Boot-time default language |
| `ALCOVES_WHISPER_MODELS_DIR` | `{data}/.whisper` | Local `.bin` cache dir |
| `ALCOVES_WHISPER_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Download base URL |
| `ALCOVES_WHISPER_VAD_MODEL` | `silero-v6.2.0` | VAD model ID; empty disables VAD |
| `ALCOVES_FFMPEG_BINARY` | `ffmpeg` | ffmpeg binary path |

### Data model

Transcription stores results directly on the `files` row (migration `00010`):
`transcribe_status`, `transcribe_progress`, `transcribe_eta_seconds`,
`transcribe_error`, `transcribe_version` (default 0), `transcribed_version`,
`transcript_text` (plain text), `transcript_vtt` (WebVTT), `transcript_model`.

### Service API

```go
func NewService(db, storage, asynqClient, cfg, activitySvc, settingsSvc) *Service
func (s) EnqueueTranscribe(libraryID, fileID string) error
func (s) NewTaskHandler() *TaskHandler
```

---

## Runtime model selection

The instance **owner** can change the active models at runtime in **Admin ->
Inference Models** (`pages/admin/index.vue`), persisted to the single-row
`app_settings` table via `PATCH /api/admin/settings`. The admin handler
validates each value before delegating to `settings.Service.Update`:

- `whisper_model` -> `transcribe.IsValidWhisperModel`
- `whisper_language` -> `transcribe.IsValidWhisperLanguage`
- `audio_detect_model` -> `audiodetection.IsValidModelID`

At job start, each worker reads the admin-selected value first and falls back to
its env default:

- The transcribe worker reads `settings.Settings.WhisperModel` /
  `.WhisperLanguage` per job (overriding `cfg.WhisperModel` /
  `cfg.WhisperLanguage`).
- The audio-detect worker resolves the active model the same way; switching the
  model re-keys the package-level session cache (see the leak note above).

The `settings` package deliberately does **not** import the ML services — the
allow-list validation lives in the admin handler to keep `settings` free of ML
imports.

---

## HTTP endpoints

All under `/api/libraries/:id/files`, registered by `FileHandler` in
`backend/internal/handlers/file.go`. Library-access middleware applies: GET
requires viewer+, POST requires admin/owner.

| Method | Path | Handler | Behavior |
|---|---|---|---|
| POST | `/:fileId/transcribe` | `GenerateTranscript` | Bumps version, sets `transcribe_status=queued`, enqueues `file:transcribe` |
| GET | `/:fileId/transcript` | `GetTranscript` | Returns the stored `transcript_text` + `transcript_vtt` |
| POST | `/:fileId/audio-detect` | `GenerateAudioDetections` | **Requires transcript ready**, then enqueues `file:audio-detect` |
| GET | `/:fileId/audio-detections` | `ListAudioDetections` | Delegates to `audioDetectSvc.ListByFile` |
| POST | `/bulk-transcribe` | `BulkTranscribe` | Optional `fileIds`; empty = all non-trashed audio/video source files. Returns `{ enqueued: [], skipped: { id: reason } }` |
| POST | `/bulk-audio-detect` | `BulkAudioDetect` | Same pattern as bulk-transcribe |

The single-file `fileToJSON` serializer also exposes the full status surface for
both pipelines, e.g. `transcribeStatus/Progress/EtaSeconds/Error/Version/`
`transcribedVersion/transcriptModel` and
`audioDetectStatus/Progress/EtaSeconds/Error/Version/audioDetectedVersion/`
`audioDetectModel` — this is what the editor polls.

Uploads (both streaming `Upload` and the TUS `finishUpload` path) auto-enqueue
transcription and audio detection for newly created video files.

---

## Frontend

Typed routes live in `frontend/app/api/index.ts` under `api.files`:
`transcribe`, `transcript`, `audioDetect`, `audioDetections`, `bulkTranscribe`,
`bulkAudioDetect`. The editor (`pages/libraries/[id]/edit/[fileId].vue`) wires
the composables together.

### Job composables

- **`useTranscribeJob.ts`** — `run()` calls
  `api.files.transcribe(libraryId, fileId)` (`POST .../transcribe`). Watches
  `file.value.transcribeStatus / transcribeError / transcribeProgress` through
  `useAsyncJobStatus`. Returns `{ transcribing, button, run }`. Button labels:
  `Transcribe`, `Transcribing...`, `Transcribing N%`, `Retry transcribe`,
  `Retranscribe`.
- **`useAudioDetectJob.ts`** — same pattern; `run()` calls
  `api.files.audioDetect(libraryId, fileId)` (`POST .../audio-detect`). Polls
  `file.value.audioDetectStatus`. Returns `{ detecting, button, run }`.
- **`useAsyncJobStatus.ts`** — the generic polling engine shared by both (and
  by `useWaveformJob`). Caller passes a `statusGetter` and `pollFn`; it starts
  a `setInterval` (default **2000 ms**) while status is `queued` or
  `processing`, fires success/error toasts on terminal transitions
  (`ready` -> `onReady`), suppresses toasts when the job is already terminal on
  initial load, and clears the timer on `onBeforeUnmount`. Button visuals come
  from `~/utils/job-status-button`.

### Data composables

- **`useTranscript.ts`** — loads the VTT once `transcribeStatus === "ready"`
  via `api.files.transcript` (`GET .../transcript`), parses it with `parseVtt`,
  and exposes `{ vtt, cues, refresh }`. Clears automatically when the file
  changes or status leaves `"ready"`.
- **`useAudioDetections.ts`** — loads `AudioDetection[]` via
  `api.files.audioDetections` (`GET .../audio-detections`), auto-refreshing when
  `file.value.id` changes. Errors are handled silently (resets to `[]`).
  Returns `{ detections, refresh }`.

### Editor panels

- **`editor/TranscriptPanel.vue`** — two tabs over the parsed cues: a
  scrollable, searchable cue list (active cue auto-scrolls into view, click to
  seek) and a "top words" frequency analysis (stop-word filtered; clicking a
  word fills the search box). Only rendered when `cues.length > 0`.
- **`editor/AudioDetectionsPanel.vue`** — buckets detections by label sorted by
  best score, with per-label score badges (success >= 0.7, primary >= 0.4,
  warning >= 0.2), hit counts, and a clickable timeline strip (one bar per
  window, opacity scaled by score). Emits `seek`. Only rendered when there is at
  least one detection.
- **`editor/EditorHeader.vue`** — hosts the Transcribe / Audio Detect buttons,
  driven by the `JobStatusButton` specs from the job composables, with
  `canDetectAudio` gating the audio-detect action.

Both panels also feed **`useHighlightFilters` / `HighlightFiltersPanel.vue`**,
which evaluate user expressions (e.g. `audio:laughter:30 & word:wow`) against
the audio detections and transcript cues client-side.

---

## Related code

Backend:

- `backend/internal/services/audiodetection/` — `service.go`, `worker.go`,
  `registry.go`, `models.go` (+ `registry_test.go`, `worker_test.go`)
- `backend/internal/services/transcribe/` — `service.go`, `worker.go`,
  `whisper_models.go` (+ `whisper_models_test.go`, `worker_test.go`)
- `backend/internal/handlers/file.go` — `GenerateTranscript`, `GetTranscript`,
  `GenerateAudioDetections`, `ListAudioDetections`, `BulkTranscribe`,
  `BulkAudioDetect`, `fileToJSON`
- `backend/internal/handlers/admin.go` — settings validation +
  `GET/PATCH /api/admin/settings`
- `backend/internal/services/settings/settings.go` — runtime model overrides
- `backend/cmd/server/main.go` — service construction + Asynq task registration
- `backend/migrations/00010_*.sql` (transcription), `00011_*.sql`
  (audio detection)
- `models/audioset_class_labels_indices.csv` — AudioSet 527-class labels

Frontend:

- `frontend/app/composables/useTranscribeJob.ts`,
  `useAudioDetectJob.ts`, `useTranscript.ts`, `useAudioDetections.ts`,
  `useAsyncJobStatus.ts`
- `frontend/app/components/editor/TranscriptPanel.vue`,
  `editor/AudioDetectionsPanel.vue`, `editor/EditorHeader.vue`
- `frontend/app/pages/libraries/[id]/edit/[fileId].vue`,
  `pages/admin/index.vue`, `pages/libraries/[id]/settings.vue`
- `frontend/app/api/index.ts` (`api.files.*`),
  `frontend/shared/types/api.ts` (`AudioDetection`, `LibraryFile` job fields)

Ops:

- `scripts/export-audio-tagger.py` — exports EfficientAT/CED checkpoints to ONNX
  (mel transform baked in); output filenames must match `registry.go`
- `scripts/upload-whisper-models.sh` — mirrors GGML whisper + Silero VAD models;
  IDs must stay in sync with `whisper_models.go`
