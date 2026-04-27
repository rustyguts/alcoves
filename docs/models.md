# ML models

Comparison of every model the worker downloads, with current pick highlighted
and concrete upgrade candidates. All numbers assume CPU-only inference on a
commodity x86_64 Linux pod (no GPU, ~8 GB RAM ceiling) — the production
worker's actual constraints.

Last reviewed: April 2026.

Defaults — and override env vars — live in
[`backend/internal/config/config.go`](../backend/internal/config/config.go).
Self-hosted asset URLs default to `https://s3.rustyguts.net/models` and can
be swapped per-deployment via Helm `models.*` values
([helm/alcoves/values.yaml](../helm/alcoves/values.yaml)).
See [publishing-models.md](publishing-models.md) for the rclone push flow
when adding a new model to the bucket.

## 1. Transcription (whisper.cpp)

Used by the `transcribe` worker (`backend/internal/services/transcribe`).
Pulled at runtime from `ALCOVES_WHISPER_MODEL_BASE_URL` /
`ALCOVES_WHISPER_MODEL`.

| Model                       | Size MB | RAM peak GB | Realtime (CPU) | WER (LS clean / other) | Languages | Notes                                       |
| --------------------------- | ------- | ----------- | -------------- | ---------------------- | --------- | ------------------------------------------- |
| ggml-tiny                   | 75      | ~0.4        | ~50×           | 7.5 / 16               | 99        | Fastest, weak accuracy                      |
| **base (current)**          | **142** | **~0.5**    | **~32×**       | **5.0 / 12**           | **99**    | **Default — fast on commodity CPU, reliable on long files** |
| small                       | 466     | ~1.0        | ~16×           | 3.4 / 7.6              | 99        | Mid-tier                                    |
| medium-q5_0                 | 515     | ~1.5        | ~6×            | 3.0 / 6.0              | 99        | <1 GB ceiling                               |
| large-v3                    | 3100    | ~3.3        | ~1×            | 2.7 / 5.2              | 99        | Slow on CPU                                 |
| large-v3-q5_0               | 1080    | ~1.3        | ~3×            | 2.9 / 5.4              | 99        | Reasonable accuracy/size                    |
| large-v3-turbo-q5_0         | 574     | ~0.9        | ~10×           | 3.0 / 5.5              | 99        | 8× faster than v3, near-v3 WER — but on commodity CPU still ~0.5x realtime under load, OOM-killed on long jobs |
| large-v3-turbo-q4_0         | 470     | ~0.8        | ~12×           | 3.2 / 5.8              | 99        | Smallest near-SOTA                          |
| distil-large-v3.5-q5        | ~600    | ~1.0        | ~15×           | 3.0 / 5.6              | EN only   | Faster than turbo, English only             |

**Status:** rolled back to `base` on 2026-04-26. `large-v3-turbo-q5_0` was set
as default on 2026-04-25, but on the production CPU it ran far below its
benchmarked 10× realtime (closer to 0.5×) and the kernel OOM-killed
whisper-cli on long videos. `base` is materially less accurate but finishes
reliably. Override per-deploy with `ALCOVES_WHISPER_MODEL=large-v3-turbo-q5_0`
on hardware that can sustain the larger model.

## 2. Audio event detection (AudioSet 527-class)

Used by the `audiodetection` worker
(`backend/internal/services/audiodetection`). Pulled from
`ALCOVES_AUDIO_DETECT_MODEL_URL` + `ALCOVES_AUDIO_DETECT_LABELS_URL`. Input
must be 32 kHz mono float32 PCM.

| Model                              | Size MB | mAP   | CPU latency / 10 s | ONNX                      | Classes | Notes                                |
| ---------------------------------- | ------- | ----- | ------------------ | ------------------------- | ------- | ------------------------------------ |
| **PANNs CNN14 (current)**          | **313** | **0.431** | **~250 ms**    | **Yes (official)**        | **527** | **Baseline**                         |
| PANNs Wavegram-Logmel-CNN14        | ~340    | 0.439 | ~400 ms            | Convertible               | 527     | Marginal mAP gain, more compute      |
| AST (MIT ast-finetuned-audioset)   | ~340    | 0.485 | 600–900 ms         | Workable via Optimum      | 527     | Strongest off-the-shelf transformer  |
| BEATs iter3                        | ~360    | 0.486 | 500–700 ms         | Manual export only        | 527     | DIY conversion required              |
| BEATs iter3+                       | ~360    | 0.501 | ~700 ms            | Manual export             | 527     | Top of the iter3 family              |
| EAT-base                           | ~360    | 0.487 | 400–500 ms         | Manual export             | 527     | Best mAP/CPU tradeoff if exported    |
| SSLAM (ICLR 2025)                  | ~400    | 0.502 | unmeasured         | Reference impl only       | 527     | SOTA on paper, no ONNX yet           |

**Recommendation:** stay on PANNs CNN14. Only invest engineering time in
exporting **EAT-base to ONNX** if mAP becomes a product blocker — best
quality/CPU tradeoff with finite effort, but requires custom conversion work.

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

- **Transcription:** stay on `base`. The 2026-04-25 swap to
  `whisper-large-v3-turbo-q5_0` was rolled back on 2026-04-26 after OOM-kills
  + sub-realtime throughput on the production CPU. Re-evaluate once we have
  hardware that can sustain it (or switch to GPU inference); until then,
  per-deploy opt-in via `ALCOVES_WHISPER_MODEL=large-v3-turbo-q5_0`.
- **Audio events:** stay on PANNs CNN14; only invest in EAT-base ONNX export
  if mAP becomes a product blocker.
- **Object detection:** drop YOLO26x → YOLO26m for ~2× CPU throughput at
  -3.5 mAP, or keep 26x if accuracy is hard-required.
- **Face detection:** keep SCRFD-10G; SCRFD-34G only for dense-crowd recall.
- **Face recognition:** keep `w600k_r50`; R100 not worth 2× CPU on this
  hardware budget.

## How to swap

Every model URL can be overridden without rebuilding the backend image:

```bash
# Whisper — default is `base`; opt into the bigger turbo model per-deploy
ALCOVES_WHISPER_MODEL=large-v3-turbo-q5_0
ALCOVES_WHISPER_MODEL_BASE_URL=https://s3.rustyguts.net/models

# Audio detection
ALCOVES_AUDIO_DETECT_MODEL_URL=https://s3.rustyguts.net/models/eat_base.onnx
ALCOVES_AUDIO_DETECT_LABELS_URL=https://s3.rustyguts.net/models/audioset_class_labels_indices.csv
```

For object/face models the URLs are still hardcoded in
`objectdetection/models.go` + `facedetection/models.go`. Lift those to config
when an actual swap lands.

The first job after a model URL change re-downloads + caches the file under
`ALCOVES_WHISPER_MODELS_DIR` / `ALCOVES_MODELS_PATH`, so existing pods can
hot-swap on next worker restart.

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
