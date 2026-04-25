# Alcoves model assets

Binary model files that Alcoves loads at runtime. Staged here so you can push
them to a single HuggingFace repo you control, then set the corresponding env
vars below to pull from that repo instead of upstream sources.

## Files

| File | Size | Purpose | Current upstream |
|------|------|---------|------------------|
| `ggml-base.bin` | 142M | whisper.cpp base multilingual — transcription | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin` |
| `yolo26x_fp16.onnx` | 107M | YOLO26x FP16 — object detection | `https://huggingface.co/onnx-community/yolo26x-ONNX/resolve/main/onnx/model_fp16.onnx` |
| `det_10g.onnx` | 17M | InsightFace buffalo_l — face detection | `https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/det_10g.onnx` |
| `w600k_r50.onnx` | 167M | InsightFace buffalo_l — face recognition | `https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/w600k_r50.onnx` |
| `panns_cnn14.onnx` | 313M | PANNs CNN14 — audio event detection | `https://huggingface.co/kevin-atx/screenpipe-panns-cnn14/resolve/main/panns_cnn14.onnx` |
| `panns_labels.json` | 8.8K | AudioSet 527 class labels (array) for PANNs | `https://huggingface.co/kevin-atx/screenpipe-panns-cnn14/resolve/main/panns_labels.json` |
| `audioset_class_labels_indices.csv` | 15K | AudioSet labels CSV (index,mid,display_name) — alternate format | `https://raw.githubusercontent.com/qiuqiangkong/audioset_tagging_cnn/master/metadata/class_labels_indices.csv` |

## Override env vars

Once the files are mirrored on your own HF repo, set these (examples):

```
ALCOVES_WHISPER_MODEL_BASE_URL=https://huggingface.co/<you>/alcoves-models/resolve/main
ALCOVES_AUDIO_DETECT_MODEL_URL=https://huggingface.co/<you>/alcoves-models/resolve/main/panns_cnn14.onnx
ALCOVES_AUDIO_DETECT_LABELS_URL=https://huggingface.co/<you>/alcoves-models/resolve/main/panns_labels.json
```

For YOLO26x + face models the download URLs are currently hard-coded in
`backend/internal/services/objectdetection/models.go` and
`backend/internal/services/facedetection/models.go`. Swap those constants (or
lift them to config) once your HF repo is published.

These binary files are git-ignored by `.gitignore` so the repo stays small.
