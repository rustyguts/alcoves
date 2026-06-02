# ML Models & Runtime Inference

This document describes the cross-cutting ML inference subsystem that powers
Alcoves' AI features: face recognition, object detection, audio-event tagging,
and speech transcription. The user-facing behaviors (the People tab, the object
label browser, the video editor's transcript/audio panels) are documented in
the respective feature docs. **This is the engine room** — the shared model
catalog, the runtime that loads and runs the models, the on-demand download
machinery, and the tooling that publishes the model assets.

If you are onboarding, read this to understand *how* a `.onnx` or `.bin` file
gets onto the box, into memory, and turned into rows in Postgres — without ever
touching a GPU or sending a byte off the instance.

---

## Design principles

1. **CPU-only, no GPU.** Every model runs on CPU. ONNX-based models
   (face, object, audio) go through **ONNX Runtime** via the
   [`github.com/yalue/onnxruntime_go`](https://github.com/yalue/onnxruntime_go)
   bindings. Speech transcription shells out to the **whisper.cpp** CLI
   (`whisper-cli`). There is no CUDA, no TensorRT, no remote inference API.

2. **Nothing leaves the instance.** Inference is fully local. The only
   outbound network traffic the subsystem makes is downloading the model
   weights themselves (once, on demand) from a configurable mirror. Your
   media is never uploaded to a third party.

3. **Models are not bundled in the image.** The Docker image ships ONNX
   Runtime and the whisper.cpp binary, but **no model weights**. Weights are
   fetched at runtime on first use and cached to disk. This keeps the image
   small and lets operators swap models without rebuilding.

4. **All inference is async.** No ML runs in an HTTP handler. Handlers enqueue
   Asynq jobs; workers (running when `ALCOVES_MODE=all` or `worker`) pull the
   job, lazily download the model if missing, run inference, and write results
   + progress back to Postgres. None of the inference packages register HTTP
   routes.

5. **Preprocessing is baked into the graph where possible.** Audio models
   bundle the mel-spectrogram transform inside the exported ONNX graph, so the
   Go worker feeds raw mono PCM and never implements an FFT pipeline. Image
   preprocessing (resize/normalize) is done in Go with libvips.

---

## Subsystem map

```
backend/internal/services/
├── facedetection/      face:detect       SCRFD + ArcFace (ONNX)
│   ├── models.go        download + ONNX session for det_10g / w600k_r50
│   └── worker.go        sync.Once session cache (per process)
├── objectdetection/    object:detect     YOLO26x (ONNX)
│   ├── models.go        download + ONNX session for yolo26x_fp16
│   └── worker.go        sync.Once session cache (per process)
├── audiodetection/     file:audio-detect EfficientAT / CED / PANNs (ONNX)
│   ├── registry.go      selectable model registry (7 entries)
│   ├── models.go        LoadSession + EnsureAssets + LoadLabels
│   └── worker.go        package-level session cache keyed by modelPath|sampleRate
└── transcribe/         file:transcribe   whisper.cpp CLI (external binary)
    ├── whisper_models.go  selectable model registry (9 entries) + languages
    └── worker.go          spawns whisper-cli per job; Silero VAD

models/                 repo data assets (audioset CSV, panns JSON, README)
scripts/
├── upload-whisper-models.sh   rclone mirror of GGML models + Silero VAD
└── export-audio-tagger.py     PyTorch → ONNX export with baked mel
docs/models.md          model catalog + sizes + sources
docs/publishing-models.md  how to publish/mirror weights
backend/Dockerfile      ONNX Runtime + whisper.cpp build stages
```

All four services are constructed in `backend/cmd/server/main.go` and their
`NewTaskHandler().ProcessTask` methods are wired into the Asynq `ServeMux`.

---

## Model catalog

All weights default to the mirror `https://s3.rustyguts.net/models`. Audio and
whisper base URLs are configurable; **object and face URLs are hard-coded
constants** in their respective `models.go` files.

### Face detection — SCRFD `det_10g.onnx`

| Property | Value |
|---|---|
| File | `det_10g.onnx` (~17 MB) |
| URL | `https://s3.rustyguts.net/models/det_10g.onnx` (hard-coded) |
| Inputs | `["input.1"]` |
| Outputs | `["score_8","score_16","score_32","bbox_8","bbox_16","bbox_32","kps_8","kps_16","kps_32"]` |
| Task | `face:detect` |

Detects faces (bounding box + 5 landmarks + confidence) at strides 8/16/32.
Preprocess: resize longest side to 640px, pad bottom/right with black,
normalize `(px - 127.5) / 128.0`. Followed by NMS at IoU 0.4. See
`facedetection/detect.go`.

### Face recognition — ArcFace `w600k_r50.onnx`

| Property | Value |
|---|---|
| File | `w600k_r50.onnx` (~167 MB) |
| URL | `https://s3.rustyguts.net/models/w600k_r50.onnx` (hard-coded) |
| Output | 512-dim embedding (L2-normalized) |
| Task | `face:detect` (same job as detection) |

Input/output tensor names are **probed at load time** across 9 known
combinations (`input.1`/`683`, `data`/`fc1`, `input`/`fc1`, …) with a live
dummy inference until one succeeds. Embeddings are stored as
`vector(512)` (pgvector) and clustered into `people` rows via HNSW cosine ANN.
See `facedetection/recognize.go` and `clustering.go`.

### Object detection — YOLO26x `yolo26x_fp16.onnx`

| Property | Value |
|---|---|
| File | `yolo26x_fp16.onnx` (~107 MB) |
| URL | `https://s3.rustyguts.net/models/yolo26x_fp16.onnx` (hard-coded) |
| Inputs | `["pixel_values"]` |
| Outputs | `["logits", "pred_boxes"]` — `[1,300,80]` + `[1,300,4]` |
| Labels | COCO-80 (`objectdetection/labels.go`) |
| Task | `object:detect` |

**NMS-free**: the model returns 300 already-deduplicated proposals, so no NMS
runs in Go (the `NMSThreshold` config field exists but is unused). Preprocess:
direct resize to 640×640 (no letterboxing), normalize to `[0,1]`, apply sigmoid
to logits, argmax per proposal. Validated at load with a dummy 640×640
inference. Session is cached process-wide via `sync.Once`. See
`objectdetection/detect.go`.

### Audio-event detection — selectable registry

`audiodetection/registry.go` defines a registry of interchangeable AudioSet
(527-class) taggers. All bundle the mel transform in-graph; the worker feeds
raw mono float32 PCM at the model's required sample rate.

| ID | File | Sample rate | Disk | mAP | License |
|---|---|---|---|---|---|
| `pann_cnn14` (legacy) | `panns_cnn14.onnx` | 32000 | 313 MB | 0.431 | Apache-2.0 |
| `efficientat_mn04` | `efficientat_mn04_as.onnx` | 32000 | 5 MB | 0.432 | MIT |
| **`efficientat_mn10` (default)** | `efficientat_mn10_as.onnx` | 32000 | 20 MB | 0.471 | MIT |
| `efficientat_mn40` | `efficientat_mn40_as_ext.onnx` | 32000 | 280 MB | 0.487 | MIT |
| `ced_tiny` | `ced_tiny.onnx` | 16000 | 22 MB | 0.481 | Apache-2.0 |
| `ced_small` | `ced_small.onnx` | 16000 | 85 MB | 0.496 | Apache-2.0 |
| `ced_base` | `ced_base.onnx` | 16000 | 330 MB | 0.500 | Apache-2.0 |

- `DefaultModelID = "efficientat_mn10"`; `LegacyModelID = "pann_cnn14"` (kept
  for rollback). `LookupSpec(id)` falls back to the default on empty/unknown
  IDs; `ModelList()` returns a deterministically sorted slice for stable API
  responses.
- Base URL: `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` (default mirror).
- Labels CSV: `ALCOVES_AUDIO_DETECT_LABELS_URL`
  (default `…/audioset_class_labels_indices.csv`), parsed by `LoadLabels`
  (`index,mid,display_name`, header skipped, 527 entries).
- Task: `file:audio-detect`.

### Speech transcription — whisper.cpp GGML registry

`transcribe/whisper_models.go` defines the allow-list of GGML whisper models.
Files on disk are `ggml-{ID}.bin`, downloaded from
`cfg.WhisperModelBaseURL + "/ggml-{ID}.bin"`.

| ID | Disk | RAM peak | WER (clean) | Notes |
|---|---|---|---|---|
| `tiny` | 75 MB | 390 MB | 7.5% | Fastest |
| `base` | 142 MB | 500 MB | 5.0% | |
| `small` | 466 MB | 1000 MB | 3.4% | |
| `medium` | 1500 MB | 2500 MB | 3.0% | Previous default |
| **`large-v3` (default)** | 3100 MB | 3900 MB | 2.7% | Current default |
| `large-v3-q5_0` | 1080 MB | 1300 MB | 2.9% | Quantized |
| `large-v3-turbo-q5_0` | 574 MB | 900 MB | 3.0% | ~8× faster than v3 |
| `large-v3-turbo-q4_0` | 470 MB | 800 MB | 3.2% | Smallest near-SOTA |
| `distil-large-v3.5-q5` | 600 MB | 1000 MB | 3.0% | English-only |

- Base URL: `ALCOVES_WHISPER_MODEL_BASE_URL` (default mirror).
- Languages (`WhisperLanguages`): `auto, en, fr, de, es, it, pt, nl, ja, zh, ko, ru`.
- `IsValidWhisperModel(id)` and `IsValidWhisperLanguage(lang)` gate admin input.
- **Silero VAD** (`ggml-silero-v6.2.0.bin`, configured via
  `ALCOVES_WHISPER_VAD_MODEL`, default `silero-v6.2.0`) is downloaded
  alongside the model and is **mandatory in practice** — it suppresses
  whisper's repetition-loop hallucinations on non-speech audio. Set the env var
  to `""` to disable.
- Task: `file:transcribe`.

---

## The shared on-demand download pattern

All three ONNX services and transcription use the same defensive download
routine before running a job. The model directory is `ALCOVES_MODELS_PATH`
(default `./data/.models`) for ONNX models and `ALCOVES_WHISPER_MODELS_DIR`
(default `./data/.whisper`) for whisper.

The pattern (see `facedetection/models.go`'s `EnsureModelsDownloaded`,
`objectdetection/models.go`, `audiodetection/models.go`'s `EnsureAssets`,
and `transcribe/worker.go`'s `ensureModel`):

1. **Stat check.** If the file exists *and* is larger than a minimum size
   threshold, skip the download (already present).
2. **Atomic write.** Download to a temp path (`{dest}.tmp` for ONNX,
   `{dest}.part` for whisper), then `os.Rename` into place. A partial download
   never leaves a corrupt file at the final path.
3. **Retry with backoff.** Up to **6 attempts** with exponential backoff
   capped at 30s (1s, 2s, 4s, 8s, 16s, 30s). 5xx responses and network errors
   are treated as transient and retried.
4. **HTML / LFS-pointer rejection.** If the response body looks like HTML
   (e.g. a Git LFS pointer page or an error page served as 200), it is
   rejected — this guards against silently caching a "model" that is actually a
   text pointer.
5. **Minimum-size validation.** The ONNX model must be **> 1 MB**; the AudioSet
   labels CSV must be **≥ 1024 bytes**. Anything smaller is considered a failed
   download and discarded.

Because workers download lazily on first job, **the first job of a given kind
may block while the model downloads.** At startup, `main.go` kicks off a
best-effort background goroutine (`faceSvc.EnsureModels()` +
`objSvc.EnsureModels()`) to pre-warm the face/object models; failures there are
logged as warnings and are non-fatal.

---

## ONNX Runtime environment initialization

ONNX Runtime requires a one-time process-wide environment init
(`ort.InitializeEnvironment()`). Each ONNX service
(`facedetection`, `objectdetection`, `audiodetection`) guards this with its own
package-level `sync.Once`. These are independent — ONNX Runtime itself tolerates
being initialized multiple times safely, so the three `sync.Once` vars don't
need to coordinate.

The native library is loaded via `dlopen("onnxruntime.so")`. The Docker image
creates an `onnxruntime.so` symlink and sets `LD_LIBRARY_PATH=/usr/local/lib`
so the loader finds it (see the Dockerfile section below).

---

## Session-management strategies

Each service manages its loaded ONNX session / CLI process differently,
reflecting how often its model can change at runtime:

| Service | Strategy | Runtime model switch? |
|---|---|---|
| `facedetection` | `sync.Once` per process; detection + recognition sessions loaded once on first job | No |
| `objectdetection` | `sync.Once` per process; single session loaded once on first job | No |
| `audiodetection` | Package-level cache keyed by `"{modelPath}\|{sampleRate}"`; reloads on key change | **Yes** (admin-selectable) |
| `transcribe` | No in-memory model; spawns a fresh `whisper-cli` subprocess per job | **Yes** (admin-selectable) |

### Audio detection session cache (and its documented leak)

`audiodetection/worker.go` holds a package-level `cachedSession`, `cachedKey`,
guarded by `sessionMu sync.Mutex`. `getSession(modelPath, sampleRate)`:

- Returns the cached session if `"{modelPath}|{sampleRate}"` matches.
- On a key mismatch (an admin changed the audio model), it loads a **new**
  session for the new key. The **old session is intentionally not
  `Destroy()`ed** — this is a documented, accepted leak. Destroying it would
  risk a use-after-free if an in-flight inference still references it, and model
  switches are a rare admin action. So a model switch leaks one session.
- Failed loads are **not** cached (so they remain retryable).

`runInference` is called under `sessionMu` — ONNX
`DynamicAdvancedSession.Run()` must not be called concurrently.

`LoadSession(modelPath, sampleRate)` probes **12 input names × 8 output names**
(common PANN/EfficientAT/CED/HF-Optimum conventions), running a 1-second silent
probe per combination, keeping the first that succeeds. This is what lets a
single Go worker run weights from three different model families unmodified.

### Face recognition reconcile leak

`facedetection/clustering.go`'s `ReconcileNewPerson` has a similar note: when a
model is switched, the old session is intentionally not destroyed to avoid a
use-after-free, leaking one session per switch.

---

## Runtime model selection

Two of the four pipelines let the **instance owner** pick the model at runtime
without restarting or changing env vars. Selection lives in the single-row
`app_settings` table (JSONB), managed by `services/settings`.

Settings keys: `whisper_model`, `whisper_language`, `audio_detect_model`
(plus `registration_mode`). Defaults: `large-v3`, `auto`, `efficientat_mn10`.

### Precedence

The worker reads the admin setting first and falls back to the env var on a
fresh install where the setting is unset:

- Transcription: `settings.WhisperModel` / `settings.WhisperLanguage` override
  `ALCOVES_WHISPER_MODEL` / `ALCOVES_WHISPER_LANGUAGE`.
- Audio detection: `settings.AudioDetectModel` overrides the default registry ID.

### Validation in the admin handler

`PATCH /api/admin/settings` (owner-gated, `handlers/admin.go`) validates the
proposed values **against the registries** before persisting:

- `whisper_model` → `transcribe.IsValidWhisperModel`
- `whisper_language` → `transcribe.IsValidWhisperLanguage`
- `audio_detect_model` → `audiodetection.IsValidModelID`

The `settings` package itself deliberately does **not** import the ML packages
— allow-list validation is delegated to the handler to keep the settings
service free of ML dependencies. The admin UI (`pages/admin/index.vue`,
"Inference Models" panel) surfaces these selectors with per-model disk/RAM/mAP
metadata and an optimistic-update-with-rollback pattern.

---

## Data flow (end to end)

Using audio detection as the representative example
(`audiodetection/worker.go`):

1. A handler (`POST /api/libraries/:id/files/:fileId/audio-detect`, or a bulk
   endpoint) calls `audioDetectSvc.EnqueueDetect`, which enqueues a
   `file:audio-detect` task with `asynq.Unique(2h)` to dedupe double-clicks /
   pod races.
2. The worker guards: file exists, not trashed, MIME `video/*` or `audio/*`.
   It captures `file.AudioDetectVersion` for optimistic versioning and sets
   `audio_detect_status = "processing"`.
3. ffmpeg extracts mono PCM at the model's sample rate
   (`-vn -ac 1 -ar {sampleRate} -f f32le -acodec pcm_f32le`). PCM length is
   validated (multiple of 4 bytes; ≥ 0.5s of samples).
4. `EnsureAssets` + `LoadLabels` + `getSession` ensure the model, labels, and
   session are ready.
5. A **streaming window loop** reads `AudioDetectWindowSec * sampleRate`
   samples per window (default 10s) through a 64 KB buffer — O(window) RAM, not
   O(total). Each window runs inference (sigmoid auto-applied if outputs fall
   outside `[-0.01, 1.01]`), keeps top-K labels above threshold, and bumps
   `audio_detect_progress`.
6. A transaction does `DELETE` of old `audio_detections` for the file + bulk
   `INSERT` of new rows + an `UPDATE` of the file's status/version/model
   columns (`audio_detect_status="ready"`, `audio_detected_version`,
   `audio_detect_model`).

The other pipelines follow the same shape; key differences:

- **Face/object** detection are idempotent (skip files that already have
  detection rows) and write per-detection rows; face also crops a 300×300 WebP
  thumbnail to cache at `{libraryID}/faces/{detectionID}.webp` and runs HNSW
  clustering.
- **Transcription** spawns `whisper-cli` (via `stdbuf -oL -eL` when available,
  to avoid pipe-buffer stalls on long audio), parses segment-timestamp lines
  for progress, always passes anti-hallucination flags (`-mc 0`, `-sns`, plus
  `--vad --vad-model …` when the VAD model is present), and writes
  `transcript_text` + `transcript_vtt` + `transcript_model` on the file. It
  emits a `system.transcribe_ready` activity event on completion.

### Progress / versioning columns on `files`

Each async ML job writes a repeating column family on `files` (see migrations
`00005`, `00010`, `00011`, `00015`):

```
<job>_status        queued | processing | ready | failed | null
<job>_progress      0–100
<job>_eta_seconds   nullable
<job>_error         nullable
<job>_version       bumped to request a (re)run
<job>ed_version     set == <job>_version on completion (stale-detection)
```

Job prefixes: `proxy`, `transcribe`, `audio_detect`, `waveform`. Transcription
also has `transcript_text/_vtt/_model`; audio detection also has
`audio_detect_model`. The frontend (`shared/types/api.ts`,
`utils/job-status-button.ts`, the polling composables `useTranscribeJob`,
`useAudioDetectJob`) renders these directly.

---

## Model-publishing tooling

Weights are produced/mirrored out-of-band and uploaded to the mirror bucket.
Two scripts plus repo data assets cover this.

### `scripts/upload-whisper-models.sh`

`rclone`-based mirror of GGML whisper models + Silero VAD to
`s3.rustyguts.net/models/`. Idempotent (rclone skips by size+mtime), supports
subset uploads (`./upload-whisper-models.sh medium tiny`) and `DRY_RUN=1`. All
files land as `ggml-<id>.bin`; downloads use `curl --retry 5` with a `.part`
suffix and atomic rename. **The model IDs must stay in sync with
`backend/internal/services/transcribe/whisper_models.go`.** Sources:

- Standard (`tiny`…`large-v3`, `large-v3-q5_0`): `huggingface.co/ggerganov/whisper.cpp`
- Turbo quants: `huggingface.co/Pomni/whisper-large-v3-turbo-ggml-allquants`
- Distil: `huggingface.co/Pomni/distil-large-v3.5-ggml-allquants`
- VAD: `huggingface.co/ggml-org/whisper-vad`

### `scripts/export-audio-tagger.py`

Exports EfficientAT and CED checkpoints to ONNX (opset 17) **with the
mel-spectrogram transform baked into the graph**, so the Go worker feeds raw
mono PCM. Input contract for every exported model:
`waveform: float32 [batch, samples]`; output:
`clipwise_output: float32 [batch, 527]` (post-sigmoid AudioSet probabilities,
dynamic batch + samples axes). Output filenames must match
`audiodetection/registry.go` (`efficientat_mn04_as.onnx`,
`efficientat_mn10_as.onnx`, `efficientat_mn40_as_ext.onnx`, `ced_tiny.onnx`,
`ced_small.onnx`, `ced_base.onnx`). Writes a `.sha256` sidecar per file;
upload via `rclone copy … rustyguts:models/`. Requirements in
`scripts/export-audio-tagger.requirements.txt` (torch/torchaudio 2.3–2.5, onnx,
transformers; EfficientAT is a repo clone, not a pip package).

### Repo data assets — `models/`

Model binaries are git-ignored, but a few data files are checked in:

| File | Purpose |
|---|---|
| `models/audioset_class_labels_indices.csv` | AudioSet 527-class CSV (`index,mid,display_name`), loaded by `audiodetection.LoadLabels` |
| `models/panns_labels.json` | AudioSet labels as a JSON array (tooling-only; not loaded by Go) |
| `models/README.md` | Documents all (gitignored) model binaries, sizes, upstream HF URLs, and override env vars |

### Reference docs

- `docs/models.md` — the human-readable model catalog (sizes, sources,
  per-model latency, defaults).
- `docs/publishing-models.md` — how to publish/mirror new weights.

---

## The Docker ML build

`backend/Dockerfile` is a multi-stage build that assembles the ML runtime; it
ships the engine but **not the weights**.

- **Base / build stage** (`golang:1.26-bookworm`): apt installs `libvips-dev`
  (govips image preprocessing), `ffmpeg` (audio/video decode), `cmake`,
  `build-essential`, `libgomp1` (OpenMP for ONNX). Built with `CGO_ENABLED=1`.
- **ONNX Runtime v1.24.1**: downloaded from GitHub releases, **arch-aware**
  (`arm64` → `aarch64`, otherwise `x64`), installed to `/usr/local/lib` +
  `/usr/local/include`, `.so` stripped, symlinked as `onnxruntime.so`,
  `ldconfig` run. The same arch-aware install runs in CI (`ci.yml`
  `backend-test` job).
- **whisper.cpp v1.8.4** (`whisper-build` stage, `debian:bookworm-slim`):
  shallow-cloned at the pinned tag, built with CMake Release (AVX/AVX2/FMA/F16C
  on, AVX-512 off, `-march=x86-64-v3`). Produces `whisper-cli` (installed to
  `/usr/local/bin`) and `libwhisper.so*` / `libggml*.so*`.
- **Final image** (`debian:bookworm-slim`): runtime deps `libvips42`, `ffmpeg`,
  `libgomp1`. Copies the ONNX Runtime libs + `whisper-cli` + whisper shared
  libs, recreates the `onnxruntime.so` symlink, runs `ldconfig`, and sets
  **`ENV LD_LIBRARY_PATH=/usr/local/lib`**. This env var is required because
  the Go ONNX bindings `dlopen("onnxruntime.so")` without an absolute path and
  `onnxruntime.so` is not a SONAME, so the ldconfig cache alone doesn't resolve
  it.

The Helm `backend-worker` deployment runs `ALCOVES_MODE=worker` with generous
memory and **no CPU limit** — whisper.cpp + ffmpeg + ONNX are bursty
compute-heavy workloads where CFS throttling hurts latency more than it helps.

---

## Environment variables (inference subsystem)

| Variable | Default | Affects |
|---|---|---|
| `ALCOVES_MODELS_PATH` | `./data/.models` | ONNX model cache dir (face/object/audio) |
| `ALCOVES_WHISPER_MODELS_DIR` | `./data/.whisper` | Whisper `.bin` cache dir |
| `ALCOVES_WHISPER_BINARY` | `whisper-cli` | Path to whisper.cpp CLI |
| `ALCOVES_WHISPER_MODEL` | `large-v3` | Boot-time fallback model (admin overrides) |
| `ALCOVES_WHISPER_LANGUAGE` | `auto` | Boot-time fallback language |
| `ALCOVES_WHISPER_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Whisper download mirror |
| `ALCOVES_WHISPER_VAD_MODEL` | `silero-v6.2.0` | Silero VAD model; `""` disables |
| `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Audio model mirror |
| `ALCOVES_AUDIO_DETECT_LABELS_URL` | `…/audioset_class_labels_indices.csv` | AudioSet label CSV URL |
| `ALCOVES_AUDIO_DETECT_WINDOW_SEC` | `10.0` | Inference window length |
| `ALCOVES_AUDIO_DETECT_THRESHOLD` | `0.2` | Min probability to keep a label |
| `ALCOVES_AUDIO_DETECT_TOP_K` | `5` | Max labels per window |
| `ALCOVES_FACE_DETECTION_MIN_SCORE` | `0.28`–`0.5` | SCRFD detection threshold |
| `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE` | `0.42`–`0.6` | Max cosine distance for a match |
| `ALCOVES_FACE_RECOGNITION_MIN_FACES` | `2`–`3` | Min cluster size for a new person |
| `ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP` | `80` | kNN candidates during assignment |
| `ALCOVES_OBJECT_DETECTION_MIN_SCORE` | `0.25` | Object confidence floor |
| `ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS` | `100` | Cap on detections per image |
| `ALCOVES_FFMPEG_BINARY` | `ffmpeg` | ffmpeg path (audio extraction) |

> Note: `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` replaced the older
> `ALCOVES_AUDIO_DETECT_MODEL_URL` in a v0.18.0 breaking rename.

---

## Asynq task types

| Task type | Package | Trigger handler(s) |
|---|---|---|
| `face:detect` | `facedetection` | upload, `POST …/face-recognition/reprocess`, library enable |
| `object:detect` | `objectdetection` | upload, `POST …/object-detection/reprocess`, library enable |
| `file:audio-detect` | `audiodetection` | `POST …/files/:id/audio-detect`, `POST …/files/bulk-audio-detect` |
| `file:transcribe` | `transcribe` | `POST …/files/:id/transcribe`, `POST …/files/bulk-transcribe` |

All are registered in `backend/cmd/server/main.go` and run only when
`ALCOVES_MODE` is `all` or `worker`.

---

## Extension points

- **Add a new audio tagger model**: export it with
  `scripts/export-audio-tagger.py` (must output the
  `waveform → clipwise_output[527]` contract with mel baked in), mirror it,
  add a `ModelSpec` to `audiodetection/registry.go` (file, sample rate, mAP,
  license), and it becomes selectable in the admin UI. `IsValidModelID` and the
  admin handler pick it up automatically.
- **Add a whisper model**: add an entry to `transcribe/whisper_models.go`
  (`WhisperModelSpec`), mirror `ggml-<id>.bin` via
  `scripts/upload-whisper-models.sh`, and it passes `IsValidWhisperModel`.
- **Swap the face/object model**: edit the hard-coded URL + tensor names in
  `facedetection/models.go` or `objectdetection/models.go`. These are not
  registry-driven and not admin-selectable.
- **Point at a different mirror / air-gapped host**: set the `*_BASE_URL` env
  vars (audio + whisper). Face/object URLs require a source edit.

---

## Related code

- `backend/internal/services/facedetection/{models.go,worker.go,detect.go,recognize.go,clustering.go}`
- `backend/internal/services/objectdetection/{models.go,worker.go,detect.go,labels.go}`
- `backend/internal/services/audiodetection/{registry.go,models.go,worker.go,service.go}`
- `backend/internal/services/transcribe/{whisper_models.go,worker.go,service.go}`
- `backend/internal/handlers/admin.go` — owner-gated model validation in `UpdateSettings`
- `backend/internal/services/settings/settings.go` — `app_settings` accessor
- `backend/internal/config/config.go` — all `ALCOVES_*` inference env vars
- `backend/cmd/server/main.go` — service construction + Asynq worker wiring + startup pre-fetch
- `backend/Dockerfile` — ONNX Runtime v1.24.1 + whisper.cpp v1.8.4 build
- `scripts/upload-whisper-models.sh`, `scripts/export-audio-tagger.py`
- `models/` (audioset CSV, panns JSON, README), `docs/models.md`, `docs/publishing-models.md`
