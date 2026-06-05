---
title: "Face recognition & object detection"
description: "How Alcoves automatically organizes your photos by people and objects using CPU-only, local AI — no cloud required."
---

Alcoves can automatically recognize the people in your photos and label what those photos contain — all processed locally on your server, with no data ever sent to a cloud service. Two separate AI pipelines handle this: **face recognition**, which groups photos by the people in them, and **object detection**, which identifies the things those photos contain.

Both features are opt-in, run in the background on the job queue, and can be enabled or disabled independently for each library.

:::note
Face recognition and object detection are image-only features. Video files, audio, and documents are not processed by these pipelines.
:::

---

## Face recognition

When enabled, Alcoves scans every image in a library, detects faces, and automatically groups them into **people** — named collections of face crops from across your library. You can browse, name, merge, and curate these groups from the **People** tab in any library.

### What you can do

**Browse the People tab** — a grid of everyone Alcoves has recognized in your library, showing a face thumbnail, a count of photos they appear in, and their name (if you've assigned one).

**Name people** — right-click a person card to rename them. Leave the name blank to clear it. Names are per-library.

**Merge people** — select two or more person cards, then choose **Merge Selected**. Alcoves reassigns all the face crops to a single person. Use this when the same individual has been split into separate groups.

**Split a face** — open a person's detail page to see every face crop attributed to them. If a face doesn't belong, use the context menu on that crop to move it to a **new person**. If the original person becomes empty after the split, you're redirected back to the people list.

**Change a cover photo** — on a person's detail page, use the context menu on any face crop to make it the cover image shown on the people grid.

**Click any face crop** to open the full source image.

:::tip
The People tab only appears in the library navigation when face recognition is enabled. Objects is an advanced owner feature and is not in the sidebar — reach it from **Library → Settings → Object Detection → View Objects**.
:::

### How faces are recognized

Alcoves uses two ONNX models to recognize faces:

1. **SCRFD** (`det_10g.onnx`) detects face bounding boxes and five facial landmarks in each image.
2. **ArcFace** (`w600k_r50.onnx`) computes a 512-dimensional face embedding for each detected face — a numerical fingerprint of the face's appearance.

The embedding is stored alongside the face's bounding box, detection confidence, and a quality score (factoring in size, confidence, landmark geometry, and aspect ratio).

**Clustering** groups embeddings into people using a k-nearest-neighbor search powered by [pgvector](https://github.com/pgvector/pgvector) with an HNSW index. When a new face is processed:

- Alcoves queries for nearby embeddings that already belong to a known person and votes on the best match.
- If the closest match is within the distance threshold, the face is assigned to that person.
- If no match is found but enough unassigned nearby faces exist (the minimum cluster size), Alcoves creates a new person and bulk-assigns them all.
- After a new person is created, Alcoves checks whether it should be automatically merged into an existing person whose embeddings are very close — preventing duplicates created by lighting or angle variation.

Faces that don't yet have enough neighbors to form a cluster remain unassigned until more evidence accumulates as additional images are processed.

### Tuning face recognition

| Environment variable | Default | What it controls |
|---|---|---|
| `ALCOVES_FACE_DETECTION_MIN_SCORE` | `0.28` | Minimum detection confidence to keep a face |
| `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE` | `0.42` | Cosine distance threshold for matching a face to a known person |
| `ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP` | `80` | Number of nearest neighbors to query when matching |
| `ALCOVES_FACE_RECOGNITION_MIN_FACES` | `3` | Minimum number of matching faces needed to form a new person |
| `ALCOVES_MODELS_PATH` | `./data/.models` | Where ONNX model files are cached on disk |

Lower `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE` if the same person is appearing in multiple separate groups (stricter matching). Raise it if one person is being split into too many groups (looser matching). Raise `ALCOVES_FACE_RECOGNITION_MIN_FACES` if you want Alcoves to wait for more evidence before creating a new person.

:::caution
Disabling face recognition for a library **deletes all face and person data** for that library, including any names you've assigned. A confirmation prompt is shown before this happens. Enabling it again processes all images from scratch.
:::

---

## Object detection

When enabled, Alcoves labels the contents of each image using the **COCO-80** class set — 80 common categories including person, car, dog, laptop, chair, and more. The **Objects** tab shows a table of every label found in the library and how many photos contain it.

Object labels also power global search: searching for "dog" or "car" returns photos where Alcoves detected that object, alongside any filename matches.

### What you can do

**Browse detected objects** — from **Library → Settings → Object Detection**, click **View Objects** to open a read-only table showing each detected label and the number of photos in the library that contain it, sorted by frequency.

**Search by object** — use the global search bar to find photos by what's in them. Search results annotate matches with the labels that matched and why.

### How object detection works

Alcoves uses **YOLO** (`yolo26x_fp16.onnx`) to detect objects. Each image is resized to 640×640, run through the model, and the 300 output proposals are filtered by confidence score, then stored with their label, bounding box, and confidence.

The COCO-80 label set covers everyday objects: people, vehicles, animals, furniture, food, electronics, and more.

### Tuning object detection

| Environment variable | Default | What it controls |
|---|---|---|
| `ALCOVES_OBJECT_DETECTION_MIN_SCORE` | `0.25` | Minimum confidence to keep a detection |
| `ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS` | `100` | Maximum detections stored per image |
| `ALCOVES_MODELS_PATH` | `./data/.models` | Where ONNX model files are cached on disk |

---

## Enabling and disabling

Both features are controlled per library in **Library → Settings**.

- Toggle **Facial Recognition** or **Object Detection** on to enable it. Alcoves immediately queues detection jobs for every existing image in the library and processes new uploads automatically.
- Toggle off to disable. All derived data for that feature is deleted after confirmation.
- **Reprocess** buttons are available for each feature. Reprocessing deletes all existing detections and re-queues every image — useful if you've changed model thresholds or want a clean run.

---

## Model files

Alcoves downloads ONNX model files automatically the first time a worker needs them. The files are stored in `ALCOVES_MODELS_PATH` (default `./data/.models`) and reused on subsequent runs.

| Model | Purpose | Size |
|---|---|---|
| `det_10g.onnx` | Face detection (SCRFD) | ~17 MB |
| `w600k_r50.onnx` | Face recognition (ArcFace) | ~167 MB |
| `yolo26x_fp16.onnx` | Object detection (YOLO) | ~107 MB |

Downloads are atomic — written to a temporary file then renamed — with automatic retries on failure. Workers will block on first use if the model isn't yet downloaded; the server pre-fetches models in the background at startup to minimize this delay.

:::note
Make sure `ALCOVES_MODELS_PATH` is on a volume with enough space (~300 MB) and is writable by the server process. In Docker or Kubernetes deployments, mount a persistent volume at this path so models survive container restarts.
:::

---

## Privacy

All inference runs locally on your server using CPU-only ONNX Runtime — no images, embeddings, or labels leave your instance. There are no API calls to external AI services, and no model telemetry. The models themselves are downloaded once from a fixed URL and cached locally.
