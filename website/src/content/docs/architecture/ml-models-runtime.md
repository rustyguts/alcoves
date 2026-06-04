---
title: "ML models & runtime inference"
description: "How Alcoves loads, caches, and runs CPU-only AI models (ONNX, whisper.cpp) for faces, objects, audio, and speech — no GPU required."
---

Alcoves ships four AI pipelines — face detection and recognition, COCO object detection, AudioSet audio-event tagging, and whisper.cpp speech transcription — all running locally on CPU with no cloud inference calls and no GPU dependency. This page explains how the engine works: how models reach disk, how they are loaded into memory, and how they turn raw media into structured metadata in the database.

## Design principles

**CPU-only, no GPU.** ONNX-based models (face, object, audio) run through [ONNX Runtime](https://onnxruntime.ai/) via Go bindings. Speech transcription is handled by the `whisper-cli` binary from [whisper.cpp](https://github.com/ggerganov/whisper.cpp). There is no CUDA, no TensorRT, and no remote inference API.

**Nothing leaves the instance.** Inference is entirely local. The only outbound network traffic the inference subsystem makes is downloading model weights on first use, from a configurable mirror. Your media is never sent to a third party.

**Models are not bundled in the Docker image.** The image ships the ONNX Runtime shared library and the `whisper-cli` binary, but no model weights. Weights are fetched on demand and cached to disk. This keeps the image small and lets operators swap models without rebuilding.

**All inference is async.** No ML runs inside an HTTP request handler. API handlers enqueue jobs; worker processes (running when `ALCOVES_MODE=all` or `ALCOVES_MODE=worker`) pick up jobs, lazily download any missing models, run inference, and write results back to Postgres. The frontend polls the file's status columns for live progress.

**Preprocessing is baked into the graph where possible.** Audio models embed the mel-spectrogram transform inside the ONNX graph, so workers feed raw mono PCM without implementing an FFT pipeline in Go. Image preprocessing (resize and normalize) is done in Go with libvips.

---

## Model catalog

### Face detection — SCRFD `det_10g.onnx`

Detects faces at strides 8/16/32, producing bounding boxes, five landmarks, and a confidence score per detection. Preprocessing resizes the longest side to 640 px, pads the remainder with black, and normalizes pixel values to `(px - 127.5) / 128.0`. Non-maximum suppression runs at IoU 0.4.

| Property | Value |
|---|---|
| File | `det_10g.onnx` |
| Disk size | ~17 MB |
| Task queue type | `face:detect` |

### Face recognition — ArcFace `w600k_r50.onnx`

Produces a 512-dimensional L2-normalized embedding for each detected face crop. Embeddings are stored as `vector(512)` in Postgres (pgvector) and clustered into named **People** via HNSW cosine nearest-neighbor search. Tensor names are probed at load time across nine known input/output name combinations — this lets the same Go code work with ArcFace weights from multiple sources.

| Property | Value |
|---|---|
| File | `w600k_r50.onnx` |
| Disk size | ~167 MB |
| Task queue type | `face:detect` (same job as detection) |

### Object detection — YOLO26x `yolo26x_fp16.onnx`

Labels files with COCO-80 object classes (person, car, dog, and so on). The model is NMS-free — it returns 300 already-deduplicated proposals — so no post-processing NMS runs in Go. Preprocessing resizes directly to 640×640 and normalizes to `[0, 1]`.

| Property | Value |
|---|---|
| File | `yolo26x_fp16.onnx` |
| Disk size | ~107 MB |
| Labels | COCO-80 |
| Task queue type | `object:detect` |

### Audio-event detection — selectable registry

Classifies audio into 527 AudioSet event classes (music, speech, dog bark, machinery, and so on). Each model in the registry bundles the mel-spectrogram transform inside the ONNX graph so the worker only feeds raw mono PCM. The active model is selectable from the admin panel at runtime.

The registry catalogues several models, but a model is only **selectable** once its ONNX weights are mirrored to the model bucket. Entries whose weights are not yet published carry `Available: false` in `audiodetection.Registry`: the admin API rejects selecting them, the picker renders them disabled, and `LookupSpec` falls back to the default for any stored-but-unavailable selection — so a stale setting can never make the worker 404 on a missing file. Flip `Available` to `true` in the same change that uploads the artifact.

| ID | Disk | mAP | Status | Notes |
|---|---|---|---|---|
| `efficientat_mn04` | 5 MB | 0.432 | Planned | Smallest; fast on constrained hardware |
| **`efficientat_mn10`** (default) | 20 MB | 0.471 | Available | Best balance of size and accuracy |
| `efficientat_mn40` | 280 MB | 0.487 | Planned | Higher accuracy, larger footprint |
| `ced_tiny` | 22 MB | 0.481 | Planned | Good accuracy-to-size ratio |
| `ced_small` | 85 MB | 0.496 | Planned | |
| `ced_base` | 330 MB | 0.500 | Planned | Highest mAP in the registry |
| `pann_cnn14` (legacy) | 313 MB | 0.431 | Available | Kept for rollback; not recommended for new installs |

| Property | Value |
|---|---|
| Task queue type | `file:audio-detect` |
| Labels | AudioSet 527-class |

### Speech transcription — whisper.cpp GGML models

Produces timestamped transcripts (`transcript_text` and `transcript_vtt`) from speech in video and audio files. The active model and language are selectable from the admin panel. Silero VAD (voice activity detection) runs alongside every transcription job to suppress repetition-loop hallucinations on non-speech audio — it is enabled by default.

| ID | Disk | RAM peak | WER (clean) | Notes |
|---|---|---|---|---|
| `tiny` | 75 MB | 390 MB | 7.5% | Fastest; useful for previews |
| `base` | 142 MB | 500 MB | 5.0% | |
| `small` | 466 MB | 1000 MB | 3.4% | |
| `medium` | 1500 MB | 2500 MB | 3.0% | |
| **`large-v3`** (default) | 3100 MB | 3900 MB | 2.7% | Highest accuracy |
| `large-v3-q5_0` | 1080 MB | 1300 MB | 2.9% | Quantized; good accuracy at lower RAM |
| `large-v3-turbo-q5_0` | 574 MB | 900 MB | 3.0% | ~8× faster than `large-v3` |
| `large-v3-turbo-q4_0` | 470 MB | 800 MB | 3.2% | Smallest near-SOTA option |
| `distil-large-v3.5-q5` | 600 MB | 1000 MB | 3.0% | English-only; fast |

| Property | Value |
|---|---|
| Task queue type | `file:transcribe` |
| Languages | `auto`, `en`, `fr`, `de`, `es`, `it`, `pt`, `nl`, `ja`, `zh`, `ko`, `ru` |

:::tip
For most self-hosted instances, `large-v3-turbo-q5_0` is a better default than `large-v3`: it is roughly eight times faster, uses far less RAM, and loses only 0.3 percentage points of accuracy.
:::

---

## On-demand model downloads

Model weights are not bundled in the Docker image. Instead, the worker downloads them on first use and caches them to disk. All four pipelines follow the same defensive pattern:

1. **Stat check.** If the file already exists on disk and exceeds a minimum size threshold, the download is skipped.
2. **Atomic write.** The download writes to a temporary path first (`.tmp` for ONNX, `.part` for whisper), then atomically renames it into place. A crash or interrupted download never leaves a corrupt file at the final path.
3. **Retry with backoff.** Up to six attempts with exponential backoff, capped at 30 seconds per delay (1 s, 2 s, 4 s, 8 s, 16 s, 30 s). Network errors and 5xx responses are treated as transient.
4. **HTML/pointer rejection.** If the response body looks like HTML (such as a Git LFS pointer page or a CDN error page served with a 200 status), the download is rejected. This prevents silently caching a text pointer as a model file.
5. **Minimum-size validation.** ONNX models must be larger than 1 MB; the AudioSet labels CSV must be at least 1024 bytes. Anything smaller is discarded and retried.

The first job of a given type may take longer while the model downloads. On startup, the server kicks off a background goroutine that pre-fetches the face and object detection models so those are ready before the first job arrives. Audio and whisper models are fetched lazily on first use.

Model cache directories:

| Env var | Default | Contents |
|---|---|---|
| `ALCOVES_MODELS_PATH` | `./data/.models` | ONNX weights (face, object, audio) |
| `ALCOVES_WHISPER_MODELS_DIR` | `./data/.whisper` | Whisper GGML `.bin` files |

---

## Runtime model selection

Two of the four pipelines let the instance owner change the active model from the admin panel without restarting the server or editing environment variables.

- **Audio-event detection** — the admin panel "Inference Models" section shows every model in the registry with its disk size and mAP score. Selecting a new model takes effect on the next queued job; the new weights are downloaded automatically if not already on disk.
- **Speech transcription** — the admin can select both the model and the target language. Changing the model applies to all subsequent transcription jobs.

The admin panel validates selections against the model registry before persisting the setting. The environment variables `ALCOVES_WHISPER_MODEL` and `ALCOVES_WHISPER_LANGUAGE` serve as boot-time fallbacks when no admin setting has been saved yet.

Face detection, face recognition, and object detection use fixed models and are not selectable from the admin panel.

---

## Data flow

Each AI pipeline follows the same shape:

1. An API handler (or a bulk endpoint) enqueues a typed Asynq task with a two-hour deduplication window, so rapid re-triggers and pod races produce a single job.
2. The worker validates the file: it must exist, must not be trashed, and must have an appropriate MIME type.
3. The worker sets the file's `<job>_status` column to `processing` and records the requested job version.
4. The model, labels (if any), and ONNX session are loaded from cache — downloading if necessary.
5. Inference runs. Audio and transcription jobs update `<job>_progress` as they advance through the file.
6. A database transaction replaces any prior results with the new rows and sets `<job>_status` to `ready` (or `failed` on error).

### Progress and status columns

Every async ML job writes a consistent set of columns on the `files` table. The frontend polls these to display live progress indicators and trigger UI updates.

```
<job>_status        queued | processing | ready | failed | null
<job>_progress      0–100 (integer percentage)
<job>_eta_seconds   nullable integer
<job>_error         nullable error message
<job>_version       incremented to request a rerun
<job>ed_version     set equal to <job>_version when complete
```

Job prefixes in use: `proxy`, `transcribe`, `audio_detect`, `waveform`. Transcription additionally writes `transcript_text`, `transcript_vtt`, and `transcript_model`; audio detection additionally writes `audio_detect_model`.

### Asynq task types

| Task type | Pipeline | What triggers it |
|---|---|---|
| `face:detect` | Face detection + recognition | File upload, library face-recognition enable, reprocess endpoint |
| `object:detect` | Object detection | File upload, library object-detection enable, reprocess endpoint |
| `file:audio-detect` | Audio-event tagging | Per-file and bulk audio-detect endpoints |
| `file:transcribe` | Speech transcription | Per-file and bulk transcribe endpoints |

Workers only run when `ALCOVES_MODE` is `all` or `worker`.

---

## Session management

Each ONNX service loads its sessions differently, reflecting how often the underlying model can change:

| Pipeline | Strategy | Hot-swap while running? |
|---|---|---|
| Face detection | Session loaded once per process (`sync.Once`) | No |
| Object detection | Session loaded once per process (`sync.Once`) | No |
| Audio detection | Session cached by `"{modelPath}\|{sampleRate}"` key; new key triggers a reload | Yes (admin-selectable) |
| Speech transcription | No persistent session; `whisper-cli` is spawned fresh per job | Yes (admin-selectable) |

When an admin changes the audio model, the old ONNX session is intentionally not destroyed before creating the new one. Destroying an in-use session risks a use-after-free if an in-flight inference still references it; since model switches are rare admin actions, leaving one session in memory is the safer trade-off.

The audio detection session is load-probed across 96 input/output name combinations on first use (12 input names × 8 output names, running a one-second silent inference per combination). This is what lets a single Go worker handle weights from EfficientAT, CED, and PANNs without requiring model-family-specific code.

---

## Docker ML build

`backend/Dockerfile` is a multi-stage build. It ships the inference runtime but not the model weights.

- **Build stage** (`golang:1.26-bookworm`): installs `libvips-dev` (image preprocessing), `ffmpeg` (audio/video decoding), `libgomp1` (OpenMP for ONNX), and build tools. Built with `CGO_ENABLED=1`.
- **ONNX Runtime v1.25.0**: downloaded from GitHub releases with architecture-aware selection (`arm64` or `x64`), installed to `/usr/local/lib`, stripped, and symlinked as `onnxruntime.so`. `ldconfig` runs after install. The runtime **must be 1.25.x** to match the version pinned by `onnxruntime_go`.
- **whisper.cpp v1.8.4** (separate stage): shallow-cloned at the pinned tag, built with CMake Release mode (AVX/AVX2/FMA/F16C enabled; AVX-512 disabled). Produces `whisper-cli` and the required shared libraries.
- **Final image** (`debian:bookworm-slim`): copies the ONNX Runtime library, `whisper-cli`, and whisper shared libraries. Sets `ENV LD_LIBRARY_PATH=/usr/local/lib` — this is required because the Go ONNX bindings call `dlopen("onnxruntime.so")` without an absolute path, and `onnxruntime.so` is not a SONAME, so `ldconfig` alone does not resolve it.

:::caution
The Helm `backend-worker` deployment runs with no CPU limit. whisper.cpp, ffmpeg, and ONNX Runtime are bursty compute-heavy workloads; CFS throttling significantly degrades latency without meaningfully helping other workloads.
:::

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ALCOVES_MODELS_PATH` | `./data/.models` | ONNX model cache directory (face, object, audio) |
| `ALCOVES_WHISPER_MODELS_DIR` | `./data/.whisper` | Whisper `.bin` model cache directory |
| `ALCOVES_WHISPER_BINARY` | `whisper-cli` | Path to the whisper.cpp CLI binary |
| `ALCOVES_WHISPER_MODEL` | `large-v3` | Boot-time fallback model (admin panel overrides this) |
| `ALCOVES_WHISPER_LANGUAGE` | `auto` | Boot-time fallback language |
| `ALCOVES_WHISPER_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Whisper weight download mirror |
| `ALCOVES_WHISPER_VAD_MODEL` | `silero-v6.2.0` | Silero VAD model ID; set to `""` to disable |
| `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Audio model weight download mirror |
| `ALCOVES_AUDIO_DETECT_LABELS_URL` | `…/audioset_class_labels_indices.csv` | AudioSet 527-class label CSV URL |
| `ALCOVES_AUDIO_DETECT_WINDOW_SEC` | `10.0` | Inference window length in seconds |
| `ALCOVES_AUDIO_DETECT_THRESHOLD` | `0.2` | Minimum probability to keep an audio label |
| `ALCOVES_AUDIO_DETECT_TOP_K` | `5` | Maximum labels retained per window |
| `ALCOVES_FACE_DETECTION_MIN_SCORE` | `0.28`–`0.5` | SCRFD detection confidence threshold |
| `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE` | `0.42`–`0.6` | Maximum cosine distance for a face match |
| `ALCOVES_FACE_RECOGNITION_MIN_FACES` | `2`–`3` | Minimum cluster size to create a Person |
| `ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP` | `80` | kNN candidates during face assignment |
| `ALCOVES_OBJECT_DETECTION_MIN_SCORE` | `0.25` | Object detection confidence floor |
| `ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS` | `100` | Maximum detections per file |
| `ALCOVES_FFMPEG_BINARY` | `ffmpeg` | Path to ffmpeg (used for audio extraction) |

:::note
`ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` replaced the older `ALCOVES_AUDIO_DETECT_MODEL_URL` in v0.18.0. Update any custom configuration that references the old name.
:::

---

## Testing (real-data inference)

Each pipeline has a **real-data test** that runs actual inference end to end against committed sample media — not mocks — so a model, runtime, or preprocessing regression is caught rather than papered over:

| Pipeline | File | What it asserts on real input |
|---|---|---|
| Waveform | `services/waveform/realmedia_test.go` | ffmpeg-decoded tones with a known amplitude envelope → peaks; full `ProcessTask` → cache JSON |
| Object detection | `services/objectdetection/realinference_test.go` | sample images → expected COCO labels (`person`/`dog`/`bicycle`) + box/score invariants |
| Face detection | `services/facedetection/realinference_test.go` | faces found; 512-dim L2-normed embeddings; same face matches across re-encode, different people don't |
| Audio events | `services/audiodetection/realinference_test.go` | speech clip → `Speech`; 527-class output range; full `ProcessTask` → DB rows |
| Transcription | `services/transcribe/realinference_test.go` | real `whisper-cli` (`tiny`) → transcript contains the spoken words |

Fixtures plus their provenance and licenses live in `internal/testsupport/testdata/` (AI-generated faces + CC0 images + a locally synthesized speech clip). Shared setup is in `internal/testsupport` (`mlfixtures.go`, `onnxtest/`).

:::note
Every test **skips** (it never fails) when a dependency is missing — ffmpeg, `whisper-cli`, the test Postgres, the ONNX Runtime shared library, or the model weights. CI installs all of these (libvips + ffmpeg + ONNX Runtime + a whisper.cpp build), so the suite runs there. Locally, point it at a matching ONNX Runtime via `$ALCOVES_ONNXRUNTIME_LIB` and, optionally, a warm model cache via `$ALCOVES_MODELS_PATH` / `$ALCOVES_WHISPER_MODELS_DIR`. The ONNX Runtime must be 1.25.x to match `onnxruntime_go`.
:::

---

## Extending the model registry

### Add an audio-event model

Export the model with `scripts/export-audio-tagger.py` (PyTorch → ONNX opset 17, with the mel-spectrogram transform baked in). The exported model must accept `waveform: float32 [batch, samples]` and produce `clipwise_output: float32 [batch, 527]` (post-sigmoid AudioSet probabilities). Mirror the file to the model bucket, then add a `ModelSpec` entry to `audiodetection/registry.go` with the file name, sample rate, mAP, and license. The admin panel and validation logic pick it up automatically.

### Add a whisper model

Add a `WhisperModelSpec` entry to `transcribe/whisper_models.go`, then mirror the corresponding `ggml-<id>.bin` file using `scripts/upload-whisper-models.sh`. The entry immediately becomes valid input for `ALCOVES_WHISPER_MODEL` and selectable in the admin panel.

### Point at a different mirror or air-gapped host

Set `ALCOVES_WHISPER_MODEL_BASE_URL` and `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` to your mirror URL. Face and object detection model URLs are currently hard-coded constants in the source and require a code change to redirect.
