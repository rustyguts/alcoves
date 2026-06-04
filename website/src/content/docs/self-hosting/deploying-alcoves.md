---
title: "Deploying Alcoves"
description: "Docker images, Helm chart, environment variables, and operational tips for running Alcoves in production."
---

Alcoves ships as two Docker images — a Go API backend and a Nuxt frontend — plus
two external data stores. This page covers everything an operator needs to run a
production instance: the runtime topology, the Helm chart, environment variables,
ingress configuration, and the most important operational gotchas.

:::tip
Looking to get started quickly? The [Quickstart](/getting-started/quickstart/)
guide gets a full local stack running with a single `docker compose up`.
:::

---

## Runtime topology

A production Alcoves deployment has four moving parts:

```
                      ┌──────────────────────────────────────────┐
   browser ──────────▶│         reverse proxy / ingress          │
                      │  /api/**  + /s/**  ──▶  Go API  :3001    │
                      │  /        (everything else) ──▶  Nuxt :3000 │
                      └─────────────┬───────────────┬────────────┘
                                    │               │
                       ┌────────────▼─────┐  ┌──────▼──────────────┐
                       │  Nuxt 4 (Nitro)  │  │  Go API (Echo)      │
                       │  :3000           │  │  :3001              │
                       │  UI + SSR share  │  │  ALCOVES_MODE=      │
                       │  pages (/s/**)   │  │  all | api | worker │
                       └──────────────────┘  └──────┬───────┬──────┘
                                                    │       │
                                   ┌────────────────▼──┐  ┌─▼──────────────────┐
                                   │  PostgreSQL 18     │  │  Dragonfly (Redis) │
                                   │  + pgvector        │  │  Asynq job queue + │
                                   │  :5432             │  │  activity pub/sub  │
                                   └───────────────────┘  └────────────────────┘
```

| Process | Default port | Role |
|---|---|---|
| Nuxt 4 (Nitro) | 3000 | Serves the UI. SSR is scoped to `/s/**` (public share pages); all other routes are client-rendered. |
| Go API (Echo) | 3001 | All `/api/**` HTTP endpoints and the async worker pool. |
| PostgreSQL 18 + pgvector | 5432 | System of record. pgvector is required from the first migration (512-dim face embeddings). |
| Dragonfly (Redis-compatible) | 6379 prod / 6389 dev | Backs the Asynq job queue and the cross-process activity pub/sub bus. |

**Routing contract:** put both processes behind one reverse proxy. Route `/api/**`
and `/s/**` to the Go service on `:3001`; route everything else (including SSR
share landing pages) to the Nuxt server on `:3000`.

### `ALCOVES_MODE` — one image, three roles

The Go API and worker ship as a single binary. Set `ALCOVES_MODE` to select behavior:

| Mode | What runs |
|---|---|
| `all` (default) | HTTP routes **and** the Asynq worker pool. Simplest option for small instances. |
| `api` | HTTP routes only — no worker goroutine. Scale the web tier independently. |
| `worker` | Asynq worker only. No full HTTP registration (health + version probes remain). The activity WebSocket hub is not created. |

Splitting into separate `api` and `worker` deployments lets you give the
CPU/RAM-hungry ML workloads their own resources without affecting request latency.

### Automatic schema migrations

Database migrations run automatically at API startup before any handler is
registered. Deploying a new image version applies all pending schema changes
without a separate migration step. Trigger a rolling upgrade with
`kubectl rollout restart deploy/<name>-api`.

---

## Docker images

Two images are published to GitHub Container Registry on every tagged release:

| Image | Source | Purpose |
|---|---|---|
| `ghcr.io/rustyguts/alcoves:<version>` | root `Dockerfile` | Go API binary with libvips, ffmpeg, ONNX Runtime, and whisper.cpp |
| `ghcr.io/rustyguts/alcoves-frontend:<version>` | `frontend/Dockerfile` | Nuxt Nitro server (production build) |

Tags follow semver: `0.x.y`, `0.x`, and `latest` (from `main`).

### What is inside the backend image

The backend image bundles all runtime dependencies for CPU-only ML inference:

- **libvips** — image transforms, thumbnails, and proxy resizing
- **ffmpeg** — video transcoding, thumbnail extraction, and audio waveform generation
- **ONNX Runtime v1.24.1** — face detection/recognition and COCO object detection
- **whisper.cpp** — speech-to-text transcription (AVX/AVX2/FMA baseline; no AVX-512 requirement)

:::note
Whisper and audio-tagger models are **not bundled** in the image. They are
downloaded on first use from the URL configured by
`ALCOVES_WHISPER_MODEL_BASE_URL`. Expect the first transcription job to take
longer as the selected model is fetched and cached.
:::

### Version probe

The running backend exposes its embedded version at `GET /api/version`:

```json
{"version": "0.5.2", "commit": "abc1234", "buildTime": "…", "mode": "all"}
```

A locally-built binary returns `"version": "dev"` because ldflags are not injected during `go run`.

---

## Environment variables

Copy `.env.example` from the repo and fill in your values. All variables are
prefixed `ALCOVES_`.

### Required

| Variable | Description |
|---|---|
| `ALCOVES_SESSION_SECRET` | AES-GCM key for encrypted session cookies. **Must be ≥ 32 bytes.** The API refuses to start without this. Generate with `openssl rand -base64 32`. |
| `ALCOVES_DATABASE_URL` | PostgreSQL connection string. Must point to a pgvector-enabled database. |

:::caution
`ALCOVES_SESSION_SECRET` is the only hard requirement. Rotating it invalidates
every active session. Never reuse the example value from `.env.example` in
production.
:::

### Core runtime

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_MODE` | `all` | `all`, `api`, or `worker` |
| `ALCOVES_ENV` | `development` | `development` or `production`. Controls CORS — localhost origins are only allowed in `development`. |
| `ALCOVES_BASE_URL` | `http://localhost:3000` | Public-facing URL. Drives OAuth redirect URIs, share links, and the primary CORS origin. **Keep this accurate in production.** |

### Queue

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_QUEUE_HOST` | `localhost` | Dragonfly/Redis host |
| `ALCOVES_QUEUE_PORT` | `6389` | Port (default is `6379` in most Redis setups) |
| `ALCOVES_QUEUE_PASSWORD` | _(empty)_ | Optional queue password |

### Storage

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_STORAGE_DRIVER` | `local` | `local` or `s3` |
| `ALCOVES_STORAGE_PATH` | `./data` | Root path for uploaded files (local driver) |
| `ALCOVES_AVATAR_STORAGE_PATH` | `./data/avatars` | Override path for user avatars |
| `ALCOVES_CACHE_STORAGE_PATH` | `./data/.cache` | Override path for derived/cached media |

For S3-compatible storage, set `ALCOVES_STORAGE_DRIVER=s3` and provide:

| Variable | Description |
|---|---|
| `ALCOVES_S3_BUCKET` | Bucket name |
| `ALCOVES_S3_REGION` | Region |
| `ALCOVES_S3_ENDPOINT` | Custom endpoint URL (for S3-compatible providers) |
| `ALCOVES_S3_ACCESS_KEY_ID` | Access key ID |
| `ALCOVES_S3_SECRET_ACCESS_KEY` | Secret access key |
| `ALCOVES_S3_FORCE_PATH_STYLE` | Set to `true` for MinIO and similar |
| `ALCOVES_S3_FILES_PREFIX` / `_AVATARS_PREFIX` / `_CACHE_PREFIX` | Optional key prefixes per scope |

### OAuth (optional)

| Variable | Description |
|---|---|
| `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

The frontend probes `GET /api/auth/providers` at runtime, so the Google sign-in
button appears automatically once these are set.

### ML model settings

Model settings are **boot-time fallbacks**. Admins can override the whisper
model, language, and audio-tagger selection at runtime from the admin panel
(persisted in the database). Workers read admin settings first and fall back to
env vars on a fresh install.

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_MODELS_PATH` | `./data/.models` | ONNX model cache directory |
| `ALCOVES_WHISPER_MODEL` | `large-v3` | Default whisper model; overridable in admin |
| `ALCOVES_WHISPER_LANGUAGE` | `auto` | Default transcription language |
| `ALCOVES_WHISPER_VAD_MODEL` | `silero-v6.2.0` | Voice activity detection model; empty disables it |
| `ALCOVES_WHISPER_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Where to download GGML whisper weights |
| `ALCOVES_WHISPER_MODELS_DIR` | `./data/.whisper` | Whisper model cache directory |
| `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Where to download audio-tagger ONNX models |

Fine-tuning thresholds (sensible defaults, adjust if needed):

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_FACE_DETECTION_MIN_SCORE` | — | Minimum confidence for a detected face |
| `ALCOVES_FACE_RECOGNITION_MAX_DISTANCE` | — | Embedding distance threshold for clustering faces into people |
| `ALCOVES_OBJECT_DETECTION_MIN_SCORE` | — | Minimum confidence for a detected object |
| `ALCOVES_OBJECT_DETECTION_MAX_DETECTIONS` | — | Cap on detected objects per image |
| `ALCOVES_AUDIO_DETECT_WINDOW_SEC` | `10.0` | Audio analysis window size |
| `ALCOVES_AUDIO_DETECT_THRESHOLD` | `0.2` | Minimum confidence for an audio event tag |
| `ALCOVES_AUDIO_DETECT_TOP_K` | `5` | Maximum audio tags per window |

### Frontend variables

These are set on the Nuxt server, not the Go API:

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_API_URL` | `http://localhost:3001` | Go backend URL for the Nitro dev proxy and SSR fetches. Set to the in-cluster API service address in production. |
| `NUXT_PUBLIC_API_ORIGIN` | _(empty)_ | **Important in production.** When set, browsers fetch binary content (video, images, downloads) directly from this origin instead of through Nitro. Nitro can corrupt HTTP `Range` responses, so setting this avoids seekable-video and download issues. |
| `NITRO_HOST` / `NITRO_PORT` | `0.0.0.0:3000` | Override the Nitro server bind address |

:::caution
Set `NUXT_PUBLIC_API_ORIGIN` in any production deployment where the frontend
and API are behind the same reverse proxy. Without it, browsers route binary
requests through Nitro, which can corrupt `Range` responses and break
video seeking.
:::

---

## Helm chart

The Helm chart (`helm/alcoves/`) deploys Alcoves to Kubernetes. It does
**not** deploy PostgreSQL or Dragonfly — operators supply their own.

### Prerequisites

- Kubernetes 1.27+
- An nginx ingress controller
- cert-manager or another TLS source
- pgvector-enabled PostgreSQL
- A Redis-compatible queue (Dragonfly recommended)
- Either an RWX-capable `PersistentVolumeClaim` or S3-compatible storage

### Workloads

The chart deploys three separate workloads from two images:

| Workload | Mode | Default replicas | Purpose |
|---|---|---|---|
| `backend-api` | `api` | 2 | Serves all HTTP requests |
| `backend-worker` | `worker` | 1 | Runs Asynq jobs (ML inference, ffmpeg, transcription) |
| `frontend` | — | 2 | Nuxt Nitro server |

The API and worker use the **same image** — `ALCOVES_MODE` selects behavior.
This means rolling out a new version is a single image bump for both.

### Resource allocation

The worker deployment deliberately has **no CPU limit** and a generous memory
limit (default `10Gi`). This is intentional: whisper large-v3 needs ~3.9 GB of
RAM, and concurrent ffmpeg + ONNX inference can spike well past 4 GB. CFS CPU
throttling hurts ML workload latency more than it helps isolation.

| Workload | CPU request | CPU limit | Memory request | Memory limit |
|---|---|---|---|---|
| `backend-api` | `200m` | `2` | `512Mi` | `2Gi` |
| `backend-worker` | `2` | _(none)_ | `4Gi` | `10Gi` |
| `frontend` | `100m` | `1` | `256Mi` | `512Mi` |

### Ingress routing

The chart's ingress routes by path prefix:

- `/api` → backend-api service
- `/` → frontend service (catch-all, including SSR share pages at `/s/**`)

Default ingress annotations enable TUS resumable uploads and seekable video out
of the box:

```yaml
nginx.ingress.kubernetes.io/proxy-body-size: "0"         # unlimited — required for TUS uploads
nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
nginx.ingress.kubernetes.io/proxy-buffering: "off"
nginx.ingress.kubernetes.io/proxy-request-buffering: "off"
```

:::caution
Do not remove or override `proxy-buffering: off` and
`proxy-request-buffering: off`. They are load-bearing for both TUS resumable
uploads and HTTP `Range` requests used by the video player.
:::

TLS is enabled by default (`ingress.tls.enabled: true`), with a default
`secretName` of `alcoves-tls`. Wire this to cert-manager or your own
certificate provider.

### Storage: RWX PVC vs S3

For the local storage driver, the chart creates a `PersistentVolumeClaim` that
both the API and worker pods mount at `/app/data`:

```yaml
persistentVolume:
  enabled: true
  size: 200Gi
  storageClass: ""      # use cluster default
  accessModes:
    - ReadWriteMany     # required when API or worker replicaCount > 1
```

:::caution
With `replicaCount > 1` for either the API or worker, the PVC **must** be
`ReadWriteMany`. Both pods read and write the same uploaded files, ML model
cache, and derived thumbnails/waveforms through this volume. Using `ReadWriteOnce`
with multiple replicas will cause failures.
:::

Switch to S3 by setting `storage.driver: s3` and providing your bucket
credentials in `values.yaml` or via an existing secret. No PVC is created in S3 mode.

### Secrets and credentials

The chart generates a single Kubernetes Secret (`<release>-app`) for
credentials. Every secret supports delegation to a pre-existing Secret so you
can use an external secret manager:

| Credential | `values.yaml` key | Existing secret key |
|---|---|---|
| Session secret | `sessionSecret` | `existingSessionSecret` |
| Database URL | `database.url` | `database.existingSecret` |
| Queue password | `queue.password` | `queue.existingSecret` |
| Google OAuth | `oauth.google.clientId` / `clientSecret` | `oauth.google.existingSecret` |
| S3 credentials | `storage.s3.accessKeyId` / `secretAccessKey` | `storage.s3.existingSecret` |

`sessionSecret` is required — the chart fails if both `sessionSecret` and
`existingSessionSecret` are empty.

Use `extraEnv` in `values.yaml` to pass additional environment variables (such
as ML tuning thresholds) without forking the chart:

```yaml
extraEnv:
  - name: ALCOVES_FACE_DETECTION_MIN_SCORE
    value: "0.85"
  - name: ALCOVES_AUDIO_DETECT_THRESHOLD
    value: "0.25"
```

### Upgrading

Rolling out a new version restarts both the API and worker deployments. The API
pod applies pending migrations before serving traffic. A safe upgrade sequence:

```sh
helm upgrade alcoves helm/alcoves/ --set image.tag=0.x.y
# or with kubectl after updating values.yaml:
kubectl rollout restart deploy/alcoves-api deploy/alcoves-worker
```

---

## Health and readiness probes

Both probes hit the same endpoint, which is always registered regardless of
`ALCOVES_MODE`:

```
GET /api/health
→ {"status": "ok", "mode": "api"}
```

Liveness probe: `initialDelaySeconds: 20`, `periodSeconds: 30`
Readiness probe: `initialDelaySeconds: 5`, `periodSeconds: 5`

The version endpoint is also always available:

```
GET /api/version
→ {"version": "0.5.2", "commit": "abc1234", "buildTime": "…", "mode": "api"}
```

---

## CORS and `ALCOVES_BASE_URL`

Alcoves uses an explicit CORS allowlist, not wildcard origins.
`ALCOVES_BASE_URL` is the primary allowed origin. Additional origins can be
added with `ALCOVES_EXTRA_CORS_ORIGINS` (comma-separated). Localhost variants
are added automatically in `development` mode only.

Keep `ALCOVES_BASE_URL` accurate. The `AllowCredentials: true` CORS setting is
safe only because the origin list is never reflected dynamically.

---

## Operational notes

### First job blocks on model download

ONNX models for face detection and object detection are pre-fetched in a
background goroutine at startup. A worker that has not finished downloading will
block the first job that needs that model. Whisper and audio-tagger models
download lazily on first use. Plan for the first few jobs after a fresh
deployment to run slower than steady-state.

### Direct browser streaming in production

Set `NUXT_PUBLIC_API_ORIGIN` so browsers fetch video and large files directly
from the API instead of routing through the Nuxt server. Without it, Nitro acts
as a passthrough for binary responses — and Nitro can corrupt HTTP `Range`
responses, breaking video seeking and download resumption.

### Shared storage is mandatory for multi-replica

The API and worker pods both read and write `/app/data` (or the equivalent S3
prefix). With more than one replica for either, shared storage is not optional —
use an RWX PVC or S3.

### Worker memory sizing

The Helm default of `10Gi` memory for the worker reflects real production peaks.
If you reduce this, expect the worker to OOM-kill during large transcription or
concurrent ffmpeg + ONNX jobs.

---

## Release cadence

Alcoves is **alpha** (`0.x.y`). Releases are cut automatically by
release-please whenever Conventional Commit PRs land on `main`:

- `feat:` → minor bump (`0.x.0`)
- `fix:` / `perf:` / `refactor:` / `docs:` → patch bump (`0.x.y+1`)
- `chore:` / `style:` → hidden; no release PR

Images are built and pushed to GHCR on every tagged release with both the full
semver tag (`0.x.y`) and the minor alias (`0.x`). Pin to a full semver tag in
production to avoid unexpected updates.

---

## Related pages

- [Quickstart](/getting-started/quickstart/) — get a local stack running in minutes
- [Configuration](/getting-started/configuration/) — full environment variable reference
