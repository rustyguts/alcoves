# Publishing models to s3.rustyguts.net

Workflow for mirroring an upstream ML model into the Alcoves model bucket.
Workers fetch from `https://s3.rustyguts.net/models/<file>` at runtime
(see [`docs/models.md`](models.md) and
[`backend/internal/config/config.go`](../backend/internal/config/config.go)).

## Prereqs

- `rclone` ≥ 1.60 with a remote named `rustyguts` (S3, endpoint
  `https://s3.rustyguts.net`). Verify:

  ```bash
  rclone listremotes | grep rustyguts
  rclone lsd rustyguts:models
  ```

- Push credentials. List access alone is not enough — confirm with a no-op:

  ```bash
  echo test | rclone rcat rustyguts:models/.write-check && \
    rclone delete rustyguts:models/.write-check
  ```

- `curl` + `sha256sum` for verification.

## Bucket layout

Flat. One object per file, no prefixes. Current contents:

```
audioset_class_labels_indices.csv   14 KB
det_10g.onnx                        17 MB   face detection
ggml-base.bin                      142 MB   whisper base
panns_cnn14.onnx                   313 MB   audio events
panns_labels.json                  8.8 KB
w600k_r50.onnx                     167 MB   face recognition
yolo26x_fp16.onnx                  107 MB   object detection
```

Naming rule: keep the upstream filename so swap-in is trivial. If multiple
quants of the same family ship, prefix with the family
(`whisper-large-v3-turbo-q5_0.bin`, not `model.bin`).

## Publish flow

### 1. Fetch upstream

```bash
mkdir -p /tmp/alcoves-models && cd /tmp/alcoves-models

# Example: whisper large-v3-turbo q5_0
curl -fL -o whisper-large-v3-turbo-q5_0.bin \
  https://huggingface.co/Pomni/whisper-large-v3-turbo-ggml-allquants/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

Use the upstream URL listed in
[`models/README.md`](../models/README.md) when one exists; otherwise add a
new row there in the same PR.

### 2. Verify integrity

```bash
sha256sum whisper-large-v3-turbo-q5_0.bin
# Compare against upstream-published checksum (HF model card / repo SHA).
# If upstream doesn't publish one, record the sha you observed in models/README.md.
```

### 3. Push to bucket

```bash
# Single file
rclone copy whisper-large-v3-turbo-q5_0.bin rustyguts:models/ \
  --progress --s3-chunk-size=64M --s3-upload-concurrency=4

# Whole directory
rclone copy /tmp/alcoves-models/ rustyguts:models/ \
  --progress --s3-chunk-size=64M --transfers=2
```

Flags worth knowing:

- `--s3-chunk-size=64M` — multipart chunk size. Default 5M is slow for
  100MB+ ONNX files.
- `--s3-upload-concurrency=4` — parallel chunks per file.
- `--transfers=2` — parallel files; keep low to avoid saturating uplink.
- `--checksum` — re-upload only if SHA differs (slow but correct for re-syncs).
- `--dry-run` — preview without writing.

### 4. Verify object is live

```bash
rclone ls rustyguts:models/ | grep whisper-large-v3-turbo-q5_0
curl -sI https://s3.rustyguts.net/models/whisper-large-v3-turbo-q5_0.bin \
  | head -5
# Expect: HTTP/1.1 200, Content-Length matches local file size.
```

### 5. Wire it into Alcoves

For env-driven URLs (whisper, audio detect labels): set in deployment env or
helm `models.*` values.

```bash
ALCOVES_WHISPER_MODEL=large-v3-turbo-q5_0
ALCOVES_WHISPER_MODEL_BASE_URL=https://s3.rustyguts.net/models
```

For hardcoded URLs (object detect, face detect/recog): edit
`backend/internal/services/objectdetection/models.go` and
`backend/internal/services/facedetection/models.go` constants. Lift to
config when a real swap lands — see
[`docs/models.md`](models.md#how-to-swap).

Workers re-download on next restart and cache under
`ALCOVES_WHISPER_MODELS_DIR` / `ALCOVES_MODELS_PATH`.

### 6. Update repo metadata

Same PR as the wire-in:

- Update [`models/README.md`](../models/README.md) — add row, upstream URL,
  size, sha if recorded.
- Update [`docs/models.md`](models.md) — bump the comparison table + the
  "current" highlighting if this is a default swap.

## Removing a model

Stale models stay free in S3, but cost listing noise. Drop with:

```bash
rclone delete rustyguts:models/<filename>
```

Only delete after every deployment has been migrated — workers re-fetch on
miss and a 404 will crash the worker boot.

## Troubleshooting

- **403 on push:** credential lacks `s3:PutObject` on `models/`. Read-only
  key, not the publisher key.
- **Slow upload (<5 MB/s):** raise `--s3-chunk-size=64M` and
  `--s3-upload-concurrency=4`. Default chunk size is the usual culprit on
  100MB+ files.
- **`Content-Length: 0` after push:** upload stalled mid-multipart and
  rclone abandoned the parts. Re-run `rclone copy` — it resumes.
- **Worker still pulls old model:** model cache lives in the pod volume
  (`ALCOVES_WHISPER_MODELS_DIR` / `ALCOVES_MODELS_PATH`). Either use a new
  filename (preferred — caches don't collide) or clear the cache dir on
  worker restart.
