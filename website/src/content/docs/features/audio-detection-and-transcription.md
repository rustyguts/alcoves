---
title: "Audio detection & speech transcription"
description: "Automatically tag sounds (laughter, music, speech) and transcribe spoken words into searchable, seekable subtitles using CPU-only local AI."
---

Alcoves can listen to any video or audio file and do two things automatically:
tag the sounds it hears and turn spoken words into a searchable transcript.
Both run entirely on your instance — no audio leaves your server, no cloud API
key required.

- **Audio event detection** — classifies sounds (laughter, applause, music,
  speech, and 520+ more categories from Google's AudioSet taxonomy) into a
  timestamped timeline alongside your file.
- **Speech transcription** — converts spoken words into plain text and WebVTT
  subtitles using whisper.cpp, an open-source, CPU-only speech model.

Both features feed directly into the video editor, where detections and
transcript cues become a seekable overlay on the timeline and power the
**highlight filters** engine — for example, "find every moment where there is
laughter within five seconds of the word 'wow'."

:::note
All inference is CPU-only and runs locally on your instance. See
[Privacy & local AI](/concepts/privacy-and-local-ai/) for the full story on
Alcoves' privacy model.
:::

---

## What you can do with it

### In the video editor

Open any video or audio file in the editor. The toolbar gives you two buttons:

**Transcribe** — runs whisper.cpp over the file's audio track. When it
finishes, the **Transcript panel** appears with:

- Time-coded cues you can click to jump to that moment in the video.
- A full-text search box to find any spoken phrase.
- A "top words" frequency view — click a word to filter the cue list.

**Detect audio** — runs the audio-event tagger over the same file. When it
finishes, the **Audio detections panel** appears with:

- Results grouped by sound label (e.g. "Speech", "Laughter", "Music").
- A confidence score badge for each category.
- A clickable timeline strip — one bar per analysis window, with opacity
  scaled to confidence — so you can jump to the loudest moment of any sound.

Both buttons show live progress while the job runs (`Transcribing 42%...`),
offer a **Retry** affordance if something goes wrong, and switch to
**Re-transcribe** / **Re-detect** once a result exists.

:::tip
Audio detection requires a completed transcript before it can run. The
**Detect audio** button stays disabled until transcription has finished for
that file.
:::

### In bulk across a library

You don't have to process files one at a time. From **Library → Settings** you
can kick off transcription or audio detection across all eligible files in the
library at once. The library browser's multi-select context menu also exposes
**Transcribe N files** and **Detect audio in N files** actions for a targeted
batch.

### Highlight filters

Once a file has both a transcript and audio detections, the **Highlight
filters** panel in the editor lets you write expressions combining word and
sound criteria — for example, `audio:laughter:30 & word:wow`. Alcoves evaluates
these client-side against the detections and cues and highlights matching
segments on the timeline, making it fast to cut a highlight reel from a long
recording.

---

## Choosing a model

### Whisper models (speech transcription)

The instance owner can change the active whisper model at any time from
**Admin → Inference Models** — no restart required. A smaller model is faster
and uses less RAM; a larger model is more accurate.

| Model | Disk | Peak RAM | Notes |
|---|---|---|---|
| `tiny` | 75 MB | 390 MB | Fastest; good for quick drafts |
| `base` | 142 MB | 500 MB | |
| `small` | 466 MB | 1 GB | |
| `medium` | 1.5 GB | 2.5 GB | |
| **`large-v3` (default)** | 3.1 GB | 3.9 GB | Best accuracy |
| `large-v3-q5_0` | 1.1 GB | 1.3 GB | Quantized; near large-v3 accuracy |
| `large-v3-turbo-q5_0` | 574 MB | 900 MB | ~8× faster than `large-v3` |
| `large-v3-turbo-q4_0` | 470 MB | 800 MB | Smallest near-accurate option |
| `distil-large-v3.5-q5` | 600 MB | 1 GB | English-only |

The owner can also set a default **language** or leave it on `auto` for
automatic detection. Supported languages include English, French, German,
Spanish, Italian, Portuguese, Dutch, Japanese, Chinese, Korean, and Russian.

:::tip
For a low-memory instance, `large-v3-turbo-q5_0` gives excellent accuracy
with roughly 8× faster processing and less than 1 GB RAM at peak.
:::

### Audio detection models

The instance owner selects the audio detection model from the same
**Admin → Inference Models** page.

| Model | Disk | Accuracy (mAP) | License | Status |
|---|---|---|---|---|
| `efficientat_mn04` | 5 MB | 0.432 | MIT | Planned |
| **`efficientat_mn10` (default)** | 20 MB | 0.471 | MIT | Available |
| `efficientat_mn40` | 280 MB | 0.487 | MIT | Planned |
| `ced_tiny` | 22 MB | 0.481 | Apache-2.0 | Planned |
| `ced_small` | 85 MB | 0.496 | Apache-2.0 | Planned |
| `ced_base` | 330 MB | 0.500 | Apache-2.0 | Planned |
| `pann_cnn14` (legacy) | 313 MB | 0.431 | Apache-2.0 | Available |

The default `efficientat_mn10` is a practical balance of size (20 MB) and
accuracy. `pann_cnn14` is the original baseline, kept selectable as a
rollback option.

Models marked **Planned** are catalogued but their weights are not yet
published to the model bucket. They appear greyed-out in the admin picker and
cannot be selected — choosing one would otherwise fail every audio-detect job
with a 404 when the worker tries to download the missing file. They become
selectable once their weights are published.

Models download automatically the first time they are needed, so the initial
run of a new model may take longer while the file is fetched.

---

## How it works

Both pipelines run as background jobs in Alcoves' async worker queue (Asynq).
No user action blocks on inference — you trigger the job, the worker picks it
up, and the editor polls for progress.

### Transcription pipeline

1. The audio track is extracted from the source file by ffmpeg as mono 16 kHz
   WAV.
2. The whisper.cpp CLI processes the WAV and emits plain text and WebVTT
   subtitle output.
3. Anti-hallucination flags are always applied: no prior-segment context is
   fed between segments, non-speech tokens are suppressed, and a Silero VAD
   (voice-activity detection) model filters out silent regions that can cause
   whisper to repeat itself.
4. Progress is tracked line by line from the whisper output and reported back
   to the editor in real time.
5. When complete, the transcript text and VTT are stored on the file record.
   An activity event is emitted so the library Feed reflects the update.

### Audio detection pipeline

1. The audio track is extracted by ffmpeg as raw mono float32 PCM at the
   model's required sample rate (16 kHz for CED models, 32 kHz for
   EfficientAT).
2. The PCM is processed in 10-second windows using an ONNX model. Each window
   produces a probability score for each of 527 AudioSet sound categories.
3. Only results above a minimum confidence threshold (0.2 by default) and the
   top results per window are kept.
4. Results are stored as timestamped detection records, replacing any prior
   results for the file in a single atomic transaction.

:::note
Audio detection is gated on transcription completing first for single-file
runs. The transcript helps the pipeline understand which segments contain
speech vs. other sounds. Bulk operations can process audio detection across
many files without this per-file constraint.
:::

---

## Configuration reference

These environment variables tune the transcription and audio detection
pipelines. Most deployments can leave them at their defaults.

### Speech transcription

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_WHISPER_BINARY` | `whisper-cli` | Path to the whisper.cpp CLI binary |
| `ALCOVES_WHISPER_MODEL` | `large-v3` | Default model (overridden by admin setting) |
| `ALCOVES_WHISPER_LANGUAGE` | `auto` | Default language (overridden by admin setting) |
| `ALCOVES_WHISPER_MODELS_DIR` | `{data}/.whisper` | Local directory for downloaded model files |
| `ALCOVES_WHISPER_MODEL_BASE_URL` | *(internal)* | Base URL for model downloads |
| `ALCOVES_WHISPER_VAD_MODEL` | `silero-v6.2.0` | VAD model for hallucination suppression; set empty to disable |

### Audio event detection

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_AUDIO_DETECT_WINDOW_SEC` | `10.0` | Analysis window length in seconds |
| `ALCOVES_AUDIO_DETECT_TOP_K` | `5` | Maximum labels kept per window |
| `ALCOVES_AUDIO_DETECT_THRESHOLD` | `0.2` | Minimum confidence score to keep a label |
| `ALCOVES_MODELS_PATH` | `{data}/.models` | Local directory for downloaded ONNX models |
| `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` | *(internal)* | Base URL for ONNX model downloads |

### Shared

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_FFMPEG_BINARY` | `ffmpeg` | Path to the ffmpeg binary |

:::caution
The whisper.cpp CLI (`whisper-cli`) must be present at the configured path.
The official Docker image includes it at the correct version. If you are
running Alcoves outside Docker, install whisper.cpp and verify the binary is
on `PATH` before enabling transcription.
:::

---

## Automatic processing on upload

When a video file is uploaded, Alcoves automatically enqueues both
transcription and audio detection — no manual trigger needed. By the time you
open the editor, the jobs may already be in progress or complete.

---

## Related topics

- [Privacy & local AI](/concepts/privacy-and-local-ai/) — How all inference stays on your instance.
- [Getting started](/getting-started/quickstart/) — Running your first Alcoves instance.
- [Configuration](/getting-started/configuration/) — Full environment variable reference.
