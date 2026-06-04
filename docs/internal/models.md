# ML models

Comparison of every model the worker downloads, with current pick highlighted
and concrete upgrade candidates. All numbers assume CPU-only inference on a
commodity x86_64 Linux pod (no GPU, ~8 GB RAM ceiling) — the production
worker's actual constraints.

Last reviewed: May 2026.

Defaults — and override env vars — live in
[`backend/internal/config/config.go`](../backend/internal/config/config.go).
**Transcription model and audio-tagger are now admin-editable at runtime**
via the Inference Models card on `/admin`; the env-var defaults only seed
fresh installs. The selectors persist into `app_settings.settings` (JSONB);
see
[`backend/internal/services/settings/settings.go`](../backend/internal/services/settings/settings.go)
+
[`backend/internal/services/transcribe/whisper_models.go`](../backend/internal/services/transcribe/whisper_models.go)
+
[`backend/internal/services/audiodetection/registry.go`](../backend/internal/services/audiodetection/registry.go)
for the allow-lists.

Self-hosted asset URLs default to `https://s3.rustyguts.net/models` and can
be swapped per-deployment via Helm `models.*` values
([helm/alcoves/values.yaml](../helm/alcoves/values.yaml)).
See [publishing-models.md](publishing-models.md) for the rclone push flow
when adding a new model to the bucket — the
[`scripts/upload-whisper-models.sh`](../scripts/upload-whisper-models.sh) and
[`scripts/export-audio-tagger.py`](../scripts/export-audio-tagger.py)
scripts wrap that flow for the inference artifacts.

## 1. Transcription (whisper.cpp)

Used by the `transcribe` worker (`backend/internal/services/transcribe`).
Pulled at runtime from `ALCOVES_WHISPER_MODEL_BASE_URL` /
`ALCOVES_WHISPER_MODEL`.

| Model                       | Size MB | RAM peak GB | Realtime (CPU) | WER (LS clean / other) | Languages | Notes                                       |
| --------------------------- | ------- | ----------- | -------------- | ---------------------- | --------- | ------------------------------------------- |
| ggml-tiny                   | 75      | ~0.4        | ~50×           | 7.5 / 16               | 99        | Fastest, weak accuracy                      |
| base                        | 142     | ~0.5        | ~32×           | 5.0 / 12               | 99        | Fast fallback for low-RAM hosts             |
| small                       | 466     | ~1.0        | ~16×           | 3.4 / 7.6              | 99        | Mid-tier                                    |
| medium                      | 1500    | ~2.5        | ~6×            | 3.0 / 6.0              | 99        | Strong accuracy within homelab memory limits |
| **large-v3 (current)**      | **3100**| **~3.9**    | **~1×**        | **2.7 / 5.2**          | **99**    | **Default — best WER; needs ≥4 GB RAM in the worker pod** |
| large-v3-q5_0               | 1080    | ~1.3        | ~3×            | 2.9 / 5.4              | 99        | Reasonable accuracy/size                    |
| large-v3-turbo-q5_0         | 574     | ~0.9        | ~10×           | 3.0 / 5.5              | 99        | 8× faster than v3, near-v3 WER — viable on capable CPU/GPU |
| large-v3-turbo-q4_0         | 470     | ~0.8        | ~12×           | 3.2 / 5.8              | 99        | Smallest near-SOTA                          |
| distil-large-v3.5-q5        | ~600    | ~1.0        | ~15×           | 3.0 / 5.6              | EN only   | Faster than turbo, English only             |

**Status:** default switched to `large-v3` on 2026-05-13 (alongside the
runtime model selector — admins can swap from `/admin` → Inference Models
without a redeploy). Rationale: the homelab pod has the RAM headroom after
the `-mc 0` + Silero VAD changes dropped peak working set, and large-v3
posts the lowest WER (2.7/5.2 vs. medium's 3.0/6.0). Override per-deploy
with `ALCOVES_WHISPER_MODEL=medium` (or smaller) on RAM-constrained hosts,
or `ALCOVES_WHISPER_MODEL=large-v3-turbo-q5_0` on capable hardware that
wants faster wall-clock at near-v3 accuracy. The earlier
`large-v3-turbo-q5_0` attempt (2026-04-25 → 2026-04-26) was rolled back
because it ran far below its benchmarked 10× realtime on the production
CPU and the kernel OOM-killed whisper-cli on long videos at the old 8Gi
limit; that is no longer an issue at the current 10Gi limit with
`-mc 0` + VAD active.

**Repetition-loop fix history (2026-04-27).** `-mc 0` + `-sns` alone are
insufficient on long non-speech audio (game streams, music-heavy
recordings, silence). The model still hallucinates a phrase, the next
chunk re-hallucinates the same phrase from the encoder context, and the
output collapses into "phrase × N" loops (reproduced on a 25-min Age of
Empires 4 capture: 122/122 cues = "That's you lay there on timbre."). The
working fix is **Silero VAD preprocessing** (added in whisper.cpp v1.7.6,
we run v1.8.4): the decoder only sees regions Silero classifies as
speech, so no decoder pass = no hallucination. After enabling VAD on the
same sample the output landed at 139 segments / 125 unique = 90% unique;
the residual repeats are real game-music vocal loops in the source. VAD
is wired through `ALCOVES_WHISPER_VAD_MODEL` (default `silero-v6.2.0`)
and `ALCOVES_WHISPER_MODEL_BASE_URL`. Set the env to `""` to disable;
not recommended.

## 2. Audio event detection (AudioSet 527-class)

Used by the `audiodetection` worker
(`backend/internal/services/audiodetection`). Active model is admin-selectable
from the registry in
[`registry.go`](../backend/internal/services/audiodetection/registry.go); the
worker resolves the spec on each task and constructs the download URL by
appending the registry filename to `$ALCOVES_AUDIO_DETECT_MODEL_BASE_URL`
(default `https://s3.rustyguts.net/models`). Labels CSV is shared across the
whole registry (every model targets the same AudioSet 527-class label space).
Input is mono float32 PCM at the spec's sample rate (16 kHz for CED, 32 kHz
for PANN + EfficientAT).

| Model                              | Size MB | mAP (AS-2M) | CPU 10 s window | License    | Sample rate | Notes                                |
| ---------------------------------- | ------- | ----------- | --------------- | ---------- | ----------- | ------------------------------------ |
| PANNs CNN14 (legacy)               | 313     | 0.431       | ~250 ms         | Apache-2.0 | 32 kHz      | Old baseline. Rollback option.       |
| EfficientAT mn04_as                | 5       | 0.432       | ~80 ms          | MIT        | 32 kHz      | Same mAP as CNN14 at ~80× smaller.   |
| **EfficientAT mn10_as (default)**  | **20**  | **0.471**   | **~150 ms**     | **MIT**    | **32 kHz**  | **+9% mAP vs CNN14, faster on CPU.** |
| EfficientAT mn40_as_ext            | 280     | 0.487       | ~600 ms         | MIT        | 32 kHz      | Same disk class as CNN14, +5.6 mAP.  |
| CED-Tiny                           | 22      | 0.481       | ~250 ms         | Apache-2.0 | 16 kHz      | Transformer; CPU parity with mn10.   |
| CED-Small                          | 85      | 0.496       | ~450 ms         | Apache-2.0 | 16 kHz      | Best mid-range quality.              |
| CED-Base (premium)                 | 330     | 0.500       | ~700 ms         | Apache-2.0 | 16 kHz      | SOTA-class; same disk as CNN14.      |

**Status:** default switched from PANN CNN14 → **EfficientAT mn10_as** on
2026-05-12. Rationale: ~16× smaller, ~40% faster on CPU, +9% mAP. The
resource-constrained-devices evaluation paper (arXiv 2509.14049) singled
out the MobileNetV3 family for the best size/latency/quality tradeoff;
mn10_as sits at the sweet spot. PANN CNN14 stays in the registry so any
admin can roll back from `/admin` → Inference Models without a code
change. CED-Base is the "premium quality" entry for deploys with RAM
headroom — `pann_cnn14` and `ced_base` occupy the same disk class but
CED-Base beats CNN14 by 16% mAP.

**Preprocessing.** PANN consumes raw 32 kHz float32 PCM directly; EfficientAT
and CED consume log-mel features but the ONNX files we ship bundle the
mel transform into the graph (see
[`scripts/export-audio-tagger.py`](../scripts/export-audio-tagger.py)) so
the worker pipeline is identical for every registry entry — feed raw PCM,
get a 527-element probability vector back. The ffmpeg `-ar` flag is set
per-spec at the worker (16 kHz vs 32 kHz).

**Re-running detection after a swap.** New tagger applies to *future*
detection jobs only. Bulk-rerun existing files via the per-library
settings page → "Re-process audio events" (calls `BulkAudioDetect`),
which enqueues one detection task per file at the new model. The
existing `audio_detections` rows for each file are deleted in the same
transaction that inserts the new run's rows, so there's never a mixed
state — the `audio_detect_model` column on `files` reflects the model
that produced the rows currently in `audio_detections`.

## 3. Object detection (COCO 80-class)

Used by the `objectdetection` worker. Hardcoded URL in
`backend/internal/services/objectdetection/models.go`. Input fixed at 640×640.

| Model                 | Size MB (FP16) | mAP@50-95 | CPU 640px        | Notes                                        |
| --------------------- | -------------- | --------- | ---------------- | -------------------------------------------- |
| YOLO26n               | ~5             | 40.9      | 25–35 ms         | Edge / tiny                                  |
| YOLO26s               | ~22            | 47–48     | 50–70 ms         | CPU sweet spot                               |
| **YOLO26m**           | **~50**        | **51.5**  | **120–160 ms**   | **2× throughput vs current at -3.5 mAP**     |
| YOLO26l               | ~87            | 53.4      | 220–280 ms       |                                              |
| **YOLO26x (current)** | **107**        | **~55.0** | **400–500 ms**   | **Top accuracy, slowest**                    |
| YOLO11x               | ~110           | 54.7      | 600+ ms          | Superseded by YOLO26                         |
| RT-DETRv3-l           | ~140           | 54.6      | 800+ ms          | DETR transformer; CPU-unfriendly             |
| DEIM-D-FINE-l         | ~120           | 54.7      | 600+ ms          | Same family, same caveat                     |

**Recommendation:** drop YOLO26x → **YOLO26m** for ~2× CPU throughput at the
cost of 3.5 mAP. Keep YOLO26x only if every accuracy point is product-critical.

## 4. Face detection (WIDER FACE)

Used by the `facedetection` worker. Hardcoded URL for `det_10g.onnx`.

| Model                    | Size MB | WIDER AP (E / M / H)        | CPU 640px       | ONNX           | Notes                              |
| ------------------------ | ------- | --------------------------- | --------------- | -------------- | ---------------------------------- |
| SCRFD-500MF              | ~1.5    | 90.6 / 88.1 / 68.5          | ~28 ms          | Yes            | Smallest                           |
| SCRFD-2.5G               | ~3      | 93.78 / 92.16 / 77.87       | 4–15 ms         | Yes            | Lightweight                        |
| **SCRFD-10G (current)**  | **17**  | **95.16 / 93.87 / 83.05**   | **25–40 ms**    | **Yes**        | **Baseline, det_10g.onnx**         |
| SCRFD-34G                | ~40     | 96.06 / 94.92 / 85.29       | 70–100 ms       | Yes            | +2 hard AP at ~3× cost             |
| YOLOv8n-face             | ~6      | ~94.5 / 92.5 / 80.5         | ~25 ms          | Community      | Comparable to SCRFD-2.5G           |
| YOLOv8m-face             | ~50     | ~96.0 / 94.5 / 84.5         | ~70 ms          | Yes            | Roughly SCRFD-34G class            |
| YOLOv11-face m           | ~40     | 96.1 / 94.7 / 84.7          | ~60 ms          | Community      | Slight edge over v8m               |
| RetinaFace-R50           | ~110    | 96.5 / 95.6 / 90.4          | 150–250 ms      | Yes            | Best hard AP, expensive            |
| MediaPipe FaceDetector   | ~2      | not WIDER-graded (close-range) | ~5 ms        | TFLite only    | Wrong tool for crowd photos        |

**Recommendation:** keep SCRFD-10G. Move to SCRFD-34G only if hard-set recall
on dense scenes becomes a complaint — same input/output shape, drop-in.

## 5. Face recognition / embedding

Used by the `facedetection` worker. Hardcoded URL for `w600k_r50.onnx`.
ArcFace R50 trained on WebFace600K, 512-dim embedding.

| Model                              | Size MB | IJB-C TAR@1e-4 / LFW | Dim | CPU/face       | Notes                          |
| ---------------------------------- | ------- | -------------------- | --- | -------------- | ------------------------------ |
| buffalo_s (R18)                    | ~16     | ~93.5 / 99.5         | 512 | ~10 ms         | Fastest, weakest               |
| **w600k_r50 (current)**            | **167** | **97.25 / 99.83**    | **512** | **30–50 ms** | **Baseline**                   |
| antelopev2 glintr100 (R100 + Glint360K) | ~261 | 97.32 / 99.85   | 512 | 70–100 ms      | +0.07 IJB-C at 2× cost         |
| webface_r100 PartialFC             | ~261    | ~97.5 / 99.86        | 512 | 70–100 ms      | Best public R100               |
| ArcFace R200 PartialFC             | ~530    | ~97.7 / 99.87        | 512 | 150–200 ms     | Diminishing returns, heavy     |
| MixFaceNet-XS / S                  | 3–7     | 95–96 / 99.6         | 512 | 5–15 ms        | Mobile-class, weaker           |
| TopoFR / TransFace R100 (2025)     | ~260    | ~97.6 / 99.87        | 512 | 80–100 ms      | Marginal IJB-C gain            |

**Recommendation:** keep `w600k_r50`. The R100 upgrade is 2× CPU and 1.5×
download for 0.07 percentage points of IJB-C — won't be felt at product level.

## Suggested upgrade path (one line each)

- **Transcription:** default `large-v3`; admin can pick any allow-list
  entry from `/admin` → Inference Models at runtime (no deploy needed).
  Per-pod RAM ceiling dictates which variant is viable; admin UI shows
  the RAM peak inline. Drop to `medium` or `large-v3-q5_0` on
  RAM-constrained hosts.
- **Audio events:** default **EfficientAT mn10_as**. Premium: switch to
  `ced_base` for SOTA quality (~330 MB, 16% better mAP than CNN14).
  Constrained: `efficientat_mn04` matches CNN14 mAP at ~80× smaller.
- **Object detection:** drop YOLO26x → YOLO26m for ~2× CPU throughput at
  -3.5 mAP, or keep 26x if accuracy is hard-required.
- **Face detection:** keep SCRFD-10G; SCRFD-34G only for dense-crowd recall.
- **Face recognition:** keep `w600k_r50`; R100 not worth 2× CPU on this
  hardware budget.

## How to swap

**Recommended (transcription, audio tagger):** sign in as an owner, open
`/admin` → Inference Models, pick the model from the dropdown. Persists
in `app_settings`; takes effect on the next worker task (no restart).

**Env-var fallback** (used when `app_settings.whisper_model` /
`audio_detect_model` are empty — fresh installs and tests):

```bash
# Whisper — admin selector overrides this at runtime.
ALCOVES_WHISPER_MODEL=large-v3
ALCOVES_WHISPER_LANGUAGE=auto
ALCOVES_WHISPER_MODEL_BASE_URL=https://s3.rustyguts.net/models

# Audio detection — URL is composed from base + registry filename.
ALCOVES_AUDIO_DETECT_MODEL_BASE_URL=https://s3.rustyguts.net/models
ALCOVES_AUDIO_DETECT_LABELS_URL=https://s3.rustyguts.net/models/audioset_class_labels_indices.csv
```

For object/face models the URLs are still hardcoded in
`objectdetection/models.go` + `facedetection/models.go`. Lift those to config
when an actual swap lands.

The first job after a swap re-downloads + caches the new file under
`ALCOVES_WHISPER_MODELS_DIR` / `ALCOVES_MODELS_PATH`. Old model files stay
on disk so rollbacks are instant.

## References

- [whisper.cpp models README](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)
- [Pomni/whisper-large-v3-turbo-ggml-allquants](https://huggingface.co/Pomni/whisper-large-v3-turbo-ggml-allquants)
- [distil-whisper/distil-large-v3.5](https://huggingface.co/distil-whisper/distil-large-v3.5)
- [Whisper quantization study (arXiv 2503.09905)](https://arxiv.org/html/2503.09905v1)
- [MLPerf Whisper benchmark](https://mlcommons.org/2025/09/whisper-inferencev5-1/)
- [PANNs paper (arXiv 1912.10211)](https://arxiv.org/abs/1912.10211)
- [AudioSet benchmark 2026 leaderboard](https://www.codesota.com/audio/classification)
- [MIT/ast-finetuned-audioset](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593)
- [CNN audio tagging eval (arXiv 2509.14049)](https://arxiv.org/pdf/2509.14049)
- [YOLO26 paper (arXiv 2509.25164)](https://arxiv.org/html/2509.25164v4)
- [YOLO evolution overview (arXiv 2510.09653)](https://arxiv.org/html/2510.09653v3)
- [Ultralytics YOLO26 docs](https://docs.ultralytics.com/models/yolo26/)
- [SCRFD InsightFace](https://insightface.ai/scrfd)
- [SCRFD paper (arXiv 2105.04714)](https://arxiv.org/pdf/2105.04714)
- [InsightFace model_zoo](https://github.com/deepinsight/insightface/blob/master/model_zoo/README.md)
- [InsightFace arcface_torch](https://github.com/deepinsight/insightface/blob/master/recognition/arcface_torch/README.md)
- [immich-app/antelopev2](https://huggingface.co/immich-app/antelopev2)
- [lindevs/yolov8-face](https://github.com/lindevs/yolov8-face)
- [akanametov/yolo-face](https://github.com/akanametov/yolo-face)
