# ML test fixtures

Real sample media used by the ML/inference real-data tests (face, object, audio
event detection, transcription, waveform). Resolved via
`testsupport.Fixture` / `testsupport.FixtureBytes`.

Everything here is deliberately small and license-clean (CC0 / public domain /
locally-synthesized / AI-generated-non-person). **Do not** add user photos or
copyrighted media.

## images/

| File | Source | License | Notes |
|---|---|---|---|
| `face_a.jpg` | thispersondoesnotexist.com (StyleGAN) | No rights reserved — synthetic, not a real person | 512px. Used for face detection, embedding, and `person` object detection. |
| `face_b.jpg` | thispersondoesnotexist.com (StyleGAN) | No rights reserved — synthetic, not a real person | 512px. A *different* synthetic person from `face_a` (cross-person embedding test). |
| `dog.jpg` | Wikimedia Commons — `File:Golden-retriever-dog-1362597631o6g.jpg` | CC0 | 640px. Object detection → `dog`. |
| `bicycle.jpg` | Wikimedia Commons — `File:Man riding a bicycle in a snowstorm in Quebec city, Quebec, Canada.jpg` | CC0 | 640px. Object detection → `bicycle` (+ `person`). |

The AI-generated faces avoid any real-person privacy concern (aligned with the
privacy-first vision) while still exercising the real SCRFD/ArcFace pipeline.

## audio/

| File | Source | License | Notes |
|---|---|---|---|
| `speech_hello.wav` | Synthesized locally with macOS `say`, re-encoded to 16 kHz mono PCM via ffmpeg | No third-party rights | Spoken text: *"Hello world. The quick brown fox jumps over the lazy dog."* Used by transcription (known words), audio-event detection (→ `Speech`), and waveform (real amplitude). |

## Regenerating

Images were fetched from the sources above and downscaled with
`vips thumbnail … 512`/`640`. The speech clip:

```sh
say -o /tmp/s.aiff "Hello world. The quick brown fox jumps over the lazy dog."
ffmpeg -i /tmp/s.aiff -ac 1 -ar 16000 -acodec pcm_s16le audio/speech_hello.wav
```

## Running the real-inference tests locally

The ONNX-based tests (face/object/audio) need an **ONNX Runtime 1.25.x** shared
library matching `onnxruntime_go` (see `internal/testsupport/onnxtest`). On a
host without it installed system-wide, point the suite at one:

```sh
export ALCOVES_ONNXRUNTIME_LIB=/path/to/libonnxruntime.dylib   # or .so
export ALCOVES_MODELS_PATH=/path/to/model/cache                # optional; else downloads
go test ./internal/services/{facedetection,objectdetection,audiodetection}/...
```

Transcription additionally needs `whisper-cli` on PATH (or
`$ALCOVES_WHISPER_BINARY`); the `tiny` model downloads on first use (or set
`$ALCOVES_WHISPER_MODELS_DIR` to a cache). Waveform/audio/transcription tests
need `ffmpeg`. Any missing dependency causes the affected tests to **skip**, not
fail.
