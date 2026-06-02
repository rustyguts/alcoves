# AI: Face Recognition & Object Detection

Alcoves runs two image-ML pipelines over the photos in your libraries. Both are
**CPU-only**, run asynchronously on the job queue, and surface their results
directly in the library UI:

- **Face recognition** — finds faces in your images, computes a face embedding
  for each one, and automatically clusters them into **people**. Browse a
  library's *People* tab, rename people, pick a cover photo, split a
  mis-grouped face into its own person, or merge two people that are the same
  person.
- **Object detection** — labels the contents of each image using the
  **COCO-80** class set (person, car, dog, laptop, …). The *Objects* tab shows a
  table of labels and how many photos contain each one, and these labels also
  power global search.

Both pipelines are **opt-in per library** and **off by default**. They are
toggled from **Library → Settings**, which flips
`faceRecognitionEnabled` / `objectDetectionEnabled` on the library. Turning a
toggle *on* backfills the existing images in the library; turning it *off*
deletes the derived data.

---

## User-facing experience

### Enabling / disabling

In **Library → Settings** (`app/pages/libraries/[id]/settings.vue`):

- **Facial Recognition toggle** — `PATCH /api/libraries/:id { faceRecognitionEnabled: true }`.
  Enabling queues face-detection jobs for every existing image. Disabling shows
  a confirm modal, then `PATCH { faceRecognitionEnabled: false }` and deletes all
  face/person data for the library.
- **Object Detection toggle** — same pattern with `objectDetectionEnabled`.
- **Reprocess** buttons — *Face recognition* reprocess →
  `POST /api/libraries/:id/face-recognition/reprocess`; *Object detection*
  reprocess → `POST /api/libraries/:id/object-detection/reprocess`. Both delete
  all existing detections and re-enqueue every image.

The **People** and **Objects** tabs only appear in `LibraryTabs.vue` when the
corresponding flag is enabled.

### People

- **`/libraries/:id/people`** (`people/index.vue`) — a grid of 160×160 person
  cards, each showing a face thumbnail, a face-count badge, and a name. Only
  people with `face_count > 0` are listed.
  - **Click** toggles selection; **double-click** opens the person detail page;
    **right-click** opens the rename modal.
  - Selecting **≥ 2** people reveals **Merge Selected** →
    `POST /api/libraries/:id/people/merge`.
  - Rename (blank clears the name) → `PATCH /api/libraries/:id/people/:personId { name }`.
- **`/libraries/:id/people/:personId`** (`people/[personId].vue`) — a grid of
  every face crop attributed to that person. Per-face context menu:
  - **Update cover photo** → `PATCH …/people/:personId { coverFaceDetectionId }`.
  - **New person** (split) → `POST …/people/:personId/faces/:faceId/split`; if
    the source person becomes empty it redirects back to the people list.
  - Clicking a face opens `<FilePreview>` for the originating image file.

### Objects

- **`/libraries/:id/objects`** (`objects.vue`) — a read-only table of YOLO label
  → photo count, plus a total-detections badge. Data:
  `GET /api/libraries/:id/objects/labels`.
- Object labels also feed **global search**: `GET /api/search?q=` matches files by
  `object_detections.label`, annotating results with `matchedLabels[]` and a
  `matchReason` of `object` or `name+object`.

---

## How it works

Both pipelines are pure backend service packages (`backend/internal/services/…`)
with no HTTP routes of their own. They are wired into the Asynq worker mux in
`backend/cmd/server/main.go` and invoked by handlers in
`backend/internal/handlers/`. Workers run when `ALCOVES_MODE=all` (default) or
`ALCOVES_MODE=worker`.

### Detection enqueue gating

A detection job is only enqueued when the owning library has the matching flag
set. On upload (both the streaming `FileHandler.Upload` and TUS
`finishUpload`), if the file MIME is `image/*`:

- `library.face_recognition_enabled` → `faceSvc.EnqueueFaceDetection` (`face:detect`)
- `library.object_detection_enabled` → `objSvc.EnqueueObjectDetection` (`object:detect`)

When a flag is toggled on, `LibraryHandler.Update` fires a goroutine that calls
`faceSvc.EnqueueExistingImages` / `objSvc.EnqueueExistingImages`, which
`LEFT JOIN` the detections table to find unprocessed, non-trashed images and
enqueue one job each.

---

### Face recognition pipeline — `services/facedetection/`

Asynq task type: **`face:detect`**. Payload: `{ fileId, libraryId }`.
Task retention: 24h. `TaskHandler.processFile`:

1. **Guards** — file must exist, not be trashed, and be `image/*`.
2. **Idempotency** — skip if `face_detections` rows already exist for the file.
3. **Detection (SCRFD)** — `det_10g.onnx`. `DetectFaces` (`detect.go`):
   - Load via libvips (`vips.NewImageFromBuffer`) + `AutoRotate()` (EXIF).
   - Preprocess: resize longest side to **640px** (aspect-preserved), pad
     bottom/right with black (top-left aligned, matching InsightFace), normalize
     CHW float32 `(pixel - 127.5) / 128.0`.
   - Run the 9-output session; **decode per stride** (8/16/32) into distance-format
     bboxes + 5-point landmarks; **NMS** at IoU 0.4; map coords back by `detScale`.
   - Filter: min 20px face, aspect ratio 0.3–3.0, cap 256 faces.
4. **Embedding (ArcFace)** — `w600k_r50.onnx`, 512-dim. `ComputeEmbedding`
   (`recognize.go`): estimate a 2D Procrustes **similarity transform** from the
   detected landmarks to the canonical ArcFace 112×112 reference points,
   bilinear-warp to a 112×112 aligned crop, normalize `(pixel - 127.5) / 127.5`,
   run inference, then **L2-normalize** the 512-dim vector in place.
5. **Quality score** — `ComputeFaceQuality` (`quality.go`) returns 0.0–1.0 from
   size (30%), detection confidence (30%), landmark geometry (25%), and aspect
   (15%). Stored as `quality_score` (0–100); detection confidence stored as
   `confidence` (0–100).
6. **Persist** — INSERT into `face_detections` via raw SQL (the `embedding`
   column is `$12::vector`, not a GORM field).
7. **Cluster** — `AssignFaceUsingCorePoint`, optionally `ReconcileNewPerson`
   (see below).
8. **Thumbnail** — crop a square with 30% padding around the larger face
   dimension, clamp to bounds, resize to 300×300, export WebP q80, store at
   `{libraryID}/faces/{detectionID}.webp` in cache storage.

Errors on an individual face are logged and skipped; the rest of the image
continues.

#### Clustering — `clustering.go`

`AssignFaceUsingCorePoint(db, config, libraryID, faceDetectionID, embedding)`:

1. **kNN query** — pgvector **HNSW** cosine-distance (`<=>`) inside a transaction
   with `SET LOCAL hnsw.ef_search = 40`; retrieves `NeighborLookup` nearest
   neighbours that already have a `person_id`.
2. **Vote** — count votes per person within `MatchCandidateDistance`; pick the
   person with the lowest distance `≤ MaxDistance` and `≥ 1` vote.
3. **New person (evidence rule)** — if no match, count *unassigned* faces within
   `MaxDistance`. If `count + 1 ≥ MinFaces`, create a `people` row, bulk-assign
   all nearby unassigned faces, and set its cover photo.
4. Otherwise return no result — the face is left unassigned until more evidence
   accumulates.

`ReconcileNewPerson(db, config, libraryID, sourcePersonID)` — auto-merge:
samples the top-5 highest-quality embeddings of a freshly created person, queries
HNSW for the 10 closest faces belonging to *different* persons within
`AutoMergeDistance`, votes by person, and if a target accrues
`≥ AutoMergeMinEvidence` votes it moves all of the source person's faces to the
target and deletes the source.

#### FaceConfig & thresholds — `config.go`

| Field | Env var | `.env.example` default | Notes |
|---|---|---|---|
| `MinScore` | `ALCOVES_FACE_DETECTION_MIN_SCORE` | `0.28` | SCRFD detection threshold |
| `MaxDistance` | `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE` | `0.42` | cosine match gate |
| `NeighborLookup` | `ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP` | `80` | kNN candidates |
| `MinFaces` | `ALCOVES_FACE_RECOGNITION_MIN_FACES` | `3` | min cluster size for a new person |
| `ModelsPath` | `ALCOVES_MODELS_PATH` | `./data/.models` | ONNX cache dir |

Derived at construction: `MatchCandidateDistance = MaxDistance * 1.5` (wide net
for the neighbour query), `AutoMergeDistance = MaxDistance * 0.85` (strict
auto-merge), `AutoMergeMinEvidence = MinFaces`.

> Note: `config.Config` ships slightly different code-level defaults
> (`MinScore 0.5`, `MaxDistance 0.6`, `MinFaces 2`); the values above are the
> tuned defaults shipped in `.env.example`.

#### Service API — `service.go`

```go
EnqueueFaceDetection(libraryID, fileID string) error
EnqueueExistingImages(libraryID string) (int, error)
DeleteLibraryData(libraryID string) error
ReprocessLibrary(libraryID string) (int, error)   // delete + re-enqueue
DeleteFaceDataForFiles(libraryID string, fileIDs []string) error
EnsureModels() error
NewTaskHandler() *TaskHandler
```

`DeleteFaceDataForFiles` (used by file purge) recomputes each affected person's
`face_count`, promotes a new cover face, deletes orphaned people whose count
falls to 0, and cleans the per-detection cache keys.

---

### Object detection pipeline — `services/objectdetection/`

Asynq task type: **`object:detect`**. Payload: `{ fileId, libraryId }`.
`TaskHandler.processFile`:

1. **Guards** — file exists, not trashed, `image/*`.
2. **Idempotency** — skip if `object_detections` count `> 0` for the file.
3. **Detection (YOLO26x)** — `yolo26x_fp16.onnx`. `DetectObjects` (`detect.go`):
   - Load via libvips, `AutoRotate`, **direct resize to 640×640** (no
     letterboxing, per the YOLO26x preprocessor); flatten alpha onto grey
     `(114,114,114)`; CHW float32 normalized to `[0,1]`.
   - Inputs `["pixel_values"]`; outputs `["logits", "pred_boxes"]` —
     `logits [1,300,80]` (raw, pre-sigmoid), `pred_boxes [1,300,4]` normalized
     `[cx,cy,w,h]`.
   - Apply **sigmoid** to logits, **argmax** the class per proposal, decode boxes
     to pixel coords, filter `score < MinScore`, sort descending, cap at
     `MaxDetections`.
   - **NMS-free**: YOLO26x's 300 proposals are already deduplicated, so although
     `NMSThreshold` is stored in config it is not applied.
4. **Persist** — one `models.ObjectDetection` per detection
   (`confidence = round(score*100)`); label from `COCOLabels[80]` (`labels.go`,
   indices 0–79: person … toothbrush). No embedding, no thumbnail.

#### ObjectConfig & thresholds — `config.go`

| Field | Env var | Default |
|---|---|---|
| `MinScore` | `ALCOVES_OBJECT_DETECTION_MIN_SCORE` | `0.25` |
| `MaxDetections` | `ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS` | `100` |
| `NMSThreshold` | `ALCOVES_OBJECT_DETECTION_NMS_THRESHOLD` | `0.45` (stored, unused) |
| `ModelsPath` | `ALCOVES_MODELS_PATH` | `./data/.models` |

#### Service API — `service.go`

```go
EnqueueObjectDetection(libraryID, fileID string) error
EnqueueExistingImages(libraryID string) (int, error)
DeleteLibraryData(libraryID string) error
ReprocessLibrary(libraryID string) (int, error)
DeleteObjectDataForFiles(libraryID string, fileIDs []string) error
EnsureModels() error
NewTaskHandler() *TaskHandler
```

---

### Shared ONNX model loading

Both services (`models.go`) use the same on-demand download + lazy-load pattern:

- **Hard-coded model URLs** (not env-configurable, unlike audio detection):
  - SCRFD detection: `https://s3.rustyguts.net/models/det_10g.onnx` (17 MB)
  - ArcFace recognition: `https://s3.rustyguts.net/models/w600k_r50.onnx` (167 MB)
  - YOLO26x: `https://s3.rustyguts.net/models/yolo26x_fp16.onnx` (107 MB)
- **Download** — `EnsureModelsDownloaded(modelsPath)`: stat check (must be
  `> 1 MB`), write to `{dest}.tmp` then **atomic `os.Rename`**, up to **6 retries**
  with **exponential backoff capped at 30s** (1s, 2s, 4s, 8s, 16s, 30s), rejects
  5xx/network errors as transient and rejects **HTML responses** (a Git-LFS
  pointer guard).
- **ONNX env** — `ort.InitializeEnvironment()` is called once per package via
  `sync.Once`.
- **Sessions** — the worker lazily loads each ONNX session once per process via
  `sync.Once`. ArcFace input/output names are probed across 9 known combinations
  with a live dummy inference; the YOLO26x graph is validated with a dummy
  640×640 inference at load time.

On startup (`mode=all|worker`), `main.go` pre-fetches both services' models in a
background goroutine via `EnsureModels()` — non-fatal; a worker otherwise blocks
on first-job download.

---

### Handlers

#### People — `handlers/people.go` (`PeopleHandler{db, storageSvc, faceSvc}`)

Routes on `/api/libraries`:

| Method | Path | Behavior |
|---|---|---|
| GET | `/:id/people` | List people with `face_count > 0`, ordered by name then count |
| PATCH | `/:id/people/:personId` | Set `name` and/or cover face detection ID |
| GET | `/:id/people/:personId/faces` | JOIN `face_detections`+`files`: box coords, image dims, confidence per face |
| GET | `/:id/people/:personId/thumbnail` | Serve `{libraryId}/faces/{faceDetectionId}.webp` from cache |
| POST | `/:id/people/:personId/faces/:faceId/split` | Move face to a new `Person`; decrement old count; re-pick cover |
| POST | `/:id/people/merge` | Reassign all faces from the other N-1 people to the first; sum counts; inherit name; delete sources |
| POST | `/:id/face-recognition/reprocess` | `faceSvc.ReprocessLibrary` |

#### Objects — `handlers/objects.go` (`ObjectsHandler{db, objSvc}`)

| Method | Path | Behavior |
|---|---|---|
| POST | `/:id/object-detection/reprocess` | `objSvc.ReprocessLibrary` |
| GET | `/:id/objects/labels` | `SELECT label, COUNT(DISTINCT file_id) … GROUP BY label ORDER BY count DESC, label ASC` |

All `/api/libraries/:id/*` routes are guarded by `LibraryAccessMiddleware`:
GET requires viewer+, mutating methods require admin/owner.

---

### Data model

**`face_detections`** (migration `00001`; HNSW index `00019`):

`id`, `file_id`, `library_id`, `box_x/y/width/height`, `image_width/height`,
`confidence` (0–100), `quality_score` (0–100), `embedding vector(512)`
(pgvector, raw-SQL only), `person_id` (nullable), `created_at`. Migration
`00019` adds `face_detections_embedding_hnsw_idx` via
`CREATE INDEX CONCURRENTLY … USING hnsw (embedding vector_cosine_ops)` with
`m = 16, ef_construction = 64` (runs `-- +goose NO TRANSACTION`).

**`people`** (migration `00001`):

`id`, `library_id`, `name` (nullable), `cover_face_detection_id` (nullable),
`face_count`, timestamps. Indexed on `(library_id, name)`.

**`object_detections`** (migration `00002`):

`id`, `file_id`, `library_id`, `label`, `confidence` (0–100),
`box_x/y/width/height`, `image_width/height`. Indexed on `(library_id, label)`
for label-filtered search. Migration `00002` also adds
`object_detection_enabled` to `libraries` (`face_recognition_enabled` lives on
`libraries` from `00001`).

---

### Frontend pieces

| File | Role |
|---|---|
| `app/composables/useLibraryPeople.ts` | People state: `people`, `selectedPeople`, `fetchPeople`, `renamePerson`, `mergePeople` (>=2 required), `loadFaces`, `splitFaceAsNewPerson`, `getPersonThumbnailUrl` (cache-busted by `coverFaceDetectionId ?? updatedAt`) |
| `app/pages/libraries/[id]/people/index.vue` | People grid + select/merge + rename modal |
| `app/pages/libraries/[id]/people/[personId].vue` | Per-person face grid; cover/split context menu; `<FilePreview>` |
| `app/pages/libraries/[id]/objects.vue` | Read-only label -> photo-count table |
| `app/pages/libraries/[id]/settings.vue` | Face/object enable toggles + reprocess buttons |
| `app/components/LibraryTabs.vue` | Shows People/Objects tabs only when the flags are enabled |
| `app/api/index.ts` | `api.people.*` (incl. `thumbnailUrl` builder, `reprocess` -> `/face-recognition/reprocess`) and `api.objects.*` (`labels`, `reprocess` -> `/object-detection/reprocess`) |

Types live in `frontend/shared/types/api.ts`: `LibraryPerson`
(`{ id, libraryId, name|null, faceCount, coverFaceDetectionId|null, … }`),
`PersonFace` (`{ id, fileId, fileName, boxX/Y/Width/Height, imageWidth/Height,
confidence, … }`), and `ObjectLabel` (`{ label, fileCount }`).

---

## Related code

- `backend/internal/services/facedetection/` — `service.go`, `worker.go`,
  `models.go`, `detect.go`, `recognize.go`, `quality.go`, `clustering.go`,
  `config.go`, `bulk.go`, `cleanup.go`
- `backend/internal/services/objectdetection/` — `service.go`, `worker.go`,
  `models.go`, `detect.go`, `labels.go`, `config.go`
- `backend/internal/handlers/people.go`, `backend/internal/handlers/objects.go`
- `backend/internal/handlers/search.go` — object-label search
- `backend/internal/handlers/library.go` — toggle-driven enqueue;
  `backend/internal/handlers/file.go` + `tus.go` — upload-time enqueue
- `backend/internal/config/config.go` — `ALCOVES_FACE_*` / `ALCOVES_OBJECT_*` env
- `backend/migrations/00001_*`, `00002_*`, `00019_*`
- `frontend/app/composables/useLibraryPeople.ts`,
  `frontend/app/pages/libraries/[id]/people/*`,
  `frontend/app/pages/libraries/[id]/objects.vue`
