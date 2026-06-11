---
title: "Deploying Alcoves"
description: "Docker images, Helm chart, environment variables, and operational tips for running Alcoves in production."
---

Alcoves ships as a **single Docker image** that runs the whole stack — the Go
API, the async worker, and the SvelteKit frontend — plus two external data
stores (PostgreSQL and Dragonfly). This page covers everything an operator needs
to run a production instance: the runtime topology, the Helm chart, environment
variables, ingress configuration, and the most important operational gotchas.

:::tip
Looking to get started quickly? The [Quickstart](/getting-started/quickstart/)
guide gets a full local stack running with a single `docker compose up`.
:::

---

## Runtime topology

A production Alcoves deployment runs **two processes** (the SvelteKit SSR
server and the Go API/worker) plus two external data stores. Both processes
live inside the **same image** — the container's entrypoint supervises them
together:

```
                      ┌──────────────────────────────────────────┐
   browser ──────────▶│        reverse proxy / ingress           │
                      │  /api/**          ──▶  Go API   :3001     │
                      │  /  (everything else, incl. /s/**) ─▶ SvelteKit :3000 │
                      └─────────────┬───────────────┬────────────┘
                                    │               │
              ┌─────────────────────┴───────────────┴─────────────────────┐
              │           one container (ghcr.io/rustyguts/alcoves)        │
              │  ┌────────────────────┐      ┌────────────────────────┐    │
              │  │  SvelteKit (Bun)   │      │  Go API/worker (Echo)  │    │
              │  │  :3000             │      │  :3001                 │    │
              │  │  UI + SSR          │ ───▶ │  ALCOVES_MODE=         │    │
              │  │  + /api proxy      │      │  all | api | worker    │    │
              │  └────────────────────┘      └──────┬───────┬─────────┘    │
              └─────────────────────────────────────┼───────┼─────────────┘
                                                    │       │
                                   ┌────────────────▼──┐  ┌─▼──────────────────┐
                                   │  PostgreSQL 18     │  │  Dragonfly (Redis) │
                                   │  + pgvector        │  │  Asynq job queue + │
                                   │  :5432             │  │  activity pub/sub  │
                                   └───────────────────┘  └────────────────────┘
```

| Process | Default port | Role |
|---|---|---|
| SvelteKit (adapter-node, run under Bun) | 3000 | Serves and SSRs the whole UI (including `/s/**` public share pages) and proxies same-origin `/api/**` to the Go API. |
| Go API (Echo) | 3001 | All `/api/**` HTTP endpoints and the async worker pool. |
| PostgreSQL 18 + pgvector | 5432 | System of record. pgvector is required from the first migration (512-dim face embeddings). |
| Dragonfly (Redis-compatible) | 6379 prod / 6389 dev | Backs the Asynq job queue and the cross-process activity pub/sub bus. |

**Single container:** the image's default `all` role runs both processes in
one container — it still needs PostgreSQL, the queue, and a session secret to
boot (the [Quickstart](/getting-started/quickstart/) has a ready-made Compose
file). SvelteKit serves the UI on `:3000` and proxies `/api/**` to the
co-located Go API on `127.0.0.1:3001`, so a single published port is enough to
get going.

**Routing contract (production):** front the container with one reverse proxy.
Route `/api/**` to the Go API on `:3001` and everything else (including the SSR
share pages at `/s/**`) to the SvelteKit server on `:3000`. Routing `/api/**`
straight to `:3001` — rather than through the SvelteKit proxy — is what keeps
video `Range` streaming intact (see
[Direct browser streaming](#direct-browser-streaming-in-production)).
Publishing `:3001` from the same container makes this possible without a second
image.

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

## Docker image

A single unified image is published to GitHub Container Registry on every tagged
release:

| Image | Source | Purpose |
|---|---|---|
| `ghcr.io/rustyguts/alcoves:<version>` | root `Dockerfile` | The whole stack — Go API/worker (libvips, ffmpeg, ONNX Runtime, whisper.cpp) **and** the SvelteKit frontend, plus the Bun runtime that serves it |

Tags follow semver: `0.x.y`, `0.x`, and `latest` (from `main`).

### One image, four roles

The container's entrypoint takes a role argument (the image `CMD`, overridable via
`docker run … <role>` or a Kubernetes `args`):

| Role | What runs |
|---|---|
| `all` (default) | SvelteKit (`:3000`) **and** the Go API+worker (`:3001`), supervised together. The simplest way to run everything in one container. |
| `web` | Only the SvelteKit server (UI + SSR). |
| `api` | Only the Go HTTP API (`ALCOVES_MODE=api`). |
| `worker` | Only the Go Asynq worker (`ALCOVES_MODE=worker`). |

The single-role modes exist so the same image can back split deployments — see the
[Helm chart](#helm-chart), whose distributed mode runs `web`, `api`, and `worker`
as three separate workloads from this one image (and whose standalone mode runs
the `all` role in a single pod).

### What is inside the image

The image bundles all runtime dependencies for CPU-only ML inference plus the
frontend:

- **libvips** — image transforms, thumbnails, and proxy resizing
- **ffmpeg** — video transcoding, thumbnail extraction, and audio waveform generation
- **ONNX Runtime v1.26.0** — face detection/recognition and COCO object detection
- **whisper.cpp** — speech-to-text transcription (AVX/AVX2/FMA baseline; no AVX-512 requirement)
- **Bun + the SvelteKit adapter-node build** — serves and SSRs the UI

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

These are set on the SvelteKit server, not the Go API:

| Variable | Default | Description |
|---|---|---|
| `INTERNAL_API_URL` | `http://localhost:3001` | Go backend URL for the SvelteKit `/api` proxy and SSR fetches. Set to the in-cluster API service address in production (the unified image defaults it to `http://127.0.0.1:3001` for the `all` role). |
| `PUBLIC_API_ORIGIN` | _(empty)_ | **Important in production.** When set, browsers fetch binary content (video, images, downloads) and the activity WebSocket directly from this origin instead of through the SvelteKit proxy — avoiding `Range`-response buffering issues and offloading streaming. |
| `FRONTEND_HOST` / `FRONTEND_PORT` | `0.0.0.0:3000` | adapter-node bind address |
| `FRONTEND_PROTOCOL_HEADER` / `FRONTEND_HOST_HEADER` | `x-forwarded-proto` / `x-forwarded-host` | Derive the request origin from the reverse proxy (required for form POSTs unless `FRONTEND_ORIGIN` is set) |
| `FRONTEND_BODY_SIZE_LIMIT` | `Infinity` | Must stay unbounded or TUS upload chunks proxied through SvelteKit are rejected |
| `PUBLIC_GOOGLE_AUTH_ENABLED` | _(empty)_ | `true` shows the Google sign-in button (set alongside the backend OAuth credentials) |
| `PUBLIC_MAP_TILE_URL` / `PUBLIC_MAP_TILE_ATTRIBUTION` | OpenStreetMap | Self-host map tiles to keep tile requests off third-party servers |
| `PUBLIC_SENTRY_DSN` | _(empty)_ | Browser-side error reporting |

:::caution
Set `PUBLIC_API_ORIGIN` in any production deployment where the frontend and
API are behind the same reverse proxy. Without it, browsers route binary
requests through the SvelteKit proxy, which buffers `Range` responses and
degrades video seeking — and the activity feed falls back from WebSocket to
polling.
:::

---

## Helm chart

The Helm chart (`helm/alcoves/`) deploys Alcoves to Kubernetes. It does
**not** deploy PostgreSQL or Dragonfly — operators supply their own. Values
are validated by a bundled `values.schema.json` plus render-time checks, so
missing/contradictory configuration fails at `helm install`, not at pod boot.

### Prerequisites

- Kubernetes 1.27+
- An ingress controller (nginx tested) and cert-manager or another TLS source, if you enable the ingress
- pgvector-enabled PostgreSQL
- A Redis-compatible queue (Dragonfly recommended)
- Storage: a PVC (`ReadWriteMany` for distributed mode) or S3-compatible storage

### Deployment modes

`deploymentMode` selects the topology — both run the **one unified image**,
with each workload picking a role via container `args`:

| Mode | Workloads | Best for |
|---|---|---|
| `distributed` (default) | `frontend` (`web`, 2 replicas), `backend-api` (`api`, 2), `backend-worker` (`worker`, 3) | Multi-node clusters; isolating heavy ML/transcode work from request latency |
| `standalone` | One pod running the `all` role (SvelteKit + API + worker supervised together) | Single-node clusters (k3s, homelab) — works with a plain `ReadWriteOnce` PVC |

Rolling out a new version is a single `image.tag` bump either way. Start from
the matching example: `helm/alcoves/examples/standalone.yaml` or
`helm/alcoves/examples/production.yaml`.

### Resource allocation

The worker deliberately has **no CPU limit** and a generous memory limit:
whisper large-v3 needs ~4–5 GB of RAM and each worker pod runs two jobs at
once, so concurrent ffmpeg + ONNX inference can spike well past 8 GB. CFS CPU
throttling hurts ML workload latency more than it helps isolation. Scale
throughput by adding worker replicas, not by raising per-pod concurrency.

| Workload | CPU request | CPU limit | Memory request | Memory limit |
|---|---|---|---|---|
| `backend-api` | `200m` | `2` | `512Mi` | `2Gi` |
| `backend-worker` | `2` | _(none)_ | `4Gi` | `12Gi` |
| `frontend` | `100m` | `1` | `256Mi` | `512Mi` |

Every workload also exposes `nodeSelector`, `tolerations`, `affinity`,
`topologySpreadConstraints`, `priorityClassName`, `updateStrategy`,
`podDisruptionBudget`, and (in distributed mode) `autoscaling` for an HPA.

### Ingress routing

The chart's ingress routes by path prefix:

- `/api` → the Go API service (TUS uploads, streaming, MCP)
- `/.well-known/oauth-*` → the Go API (only when `mcp.oauth.enabled` — these
  OAuth discovery documents live at the site root)
- `/` → the SvelteKit service (catch-all, including SSR share pages at `/s/**`)

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
certificate provider. The chart warns at install time if `baseUrl` and
`ingress.host` disagree.

### Storage: PVC vs S3

For the local storage driver, the chart creates a `PersistentVolumeClaim`
mounted at `/app/data` by every backend pod:

```yaml
storage:
  persistentVolume:
    enabled: true
    retain: true        # keep the PVC (your data!) on helm uninstall
    size: 200Gi
    storageClass: ""    # use cluster default
    accessModes:
      - ReadWriteMany   # distributed mode; standalone works with ReadWriteOnce
    existingClaim: ""   # or bring your own
```

:::caution
In distributed mode the api and worker pods share this volume, so it **must**
be `ReadWriteMany` unless the scheduler can co-locate every pod on one node.
The chart prints a warning when no RWX access mode is configured — if your
cluster has no RWX storage class, use `deploymentMode: standalone` instead.
:::

The PVC is annotated `helm.sh/resource-policy: keep` by default
(`storage.persistentVolume.retain`), so `helm uninstall` does **not** delete
your files.

Switch to S3 by setting `storage.driver: s3` and providing bucket credentials
inline or via an existing secret. No PVC is created in S3 mode. (Check the
release notes before relying on S3 — server-side support is still being wired
up.)

### Secrets and credentials

Inline credentials land in a single chart-managed Secret (`<release>-app`);
pods carry a checksum annotation so changing a credential rolls them. Every
credential can instead come from a pre-existing Secret (external-secrets,
SOPS, …) — when all of them do, the chart creates no Secret at all:

| Credential | `values.yaml` key | Existing secret ref (key) |
|---|---|---|
| Session secret | `sessionSecret` | `existingSessionSecret` (`sessionSecret`) |
| Database URL | `database.url` | `database.existingSecret` (`url`) |
| Queue password | `queue.password` | `queue.existingSecret` (`password`) |
| Google OAuth | `oauth.google.clientId` / `clientSecret` | `oauth.google.existingSecret` (`clientId`, `clientSecret`) |
| S3 credentials | `storage.s3.accessKeyId` / `secretAccessKey` | `storage.s3.existingSecret` (`accessKeyId`, `secretAccessKey`) |
| MCP signing secret (optional) | `mcp.signingSecret` | — |

A session secret and a database URL are required — the chart refuses to render
without them. Configuring Google OAuth also sets
`PUBLIC_GOOGLE_AUTH_ENABLED` on the frontend so the sign-in button appears.

Use `extraEnv` / `extraEnvFrom` (backend pods) and `frontend.extraEnv` to pass
additional environment variables without forking the chart:

```yaml
extraEnv:
  - name: ALCOVES_FACE_DETECTION_MIN_SCORE
    value: "0.85"
  - name: ALCOVES_AUDIO_DETECT_THRESHOLD
    value: "0.25"
```

### Optional features

- **MCP over HTTP** — `mcp.httpEnabled: true` exposes the MCP server at
  `/api/mcp` (PAT bearer auth); `mcp.oauth.enabled: true` adds the OAuth 2.1
  flow used by remote connectors and wires the discovery endpoints through the
  ingress.
- **Sentry** — `sentry.backendDsn` / `sentry.frontendDsn` /
  `sentry.tracesSampleRate`.
- **NetworkPolicy** — `networkPolicy.enabled: true` restricts inbound traffic
  to the app's HTTP ports.
- **Smoke tests** — `helm test <release>` probes `/api/health`, `/api/version`,
  and the frontend through the deployed Services.

### Upgrading

Rolling out a new version restarts the workloads; the API pods apply pending
migrations before serving traffic. Workload names and selectors are stable
across chart versions, so upgrades roll in place:

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

Set `PUBLIC_API_ORIGIN` so browsers fetch video and large files (and the
activity WebSocket) directly from the API instead of routing through the
SvelteKit server. Without it, every binary response is proxied and buffered by
SvelteKit, which hurts `Range`-request streaming, and the notifications socket
degrades to polling. The Helm chart defaults it to `baseUrl`.

### Shared storage is mandatory for multi-replica

The API and worker pods both read and write `/app/data` (or the equivalent S3
prefix). With more than one replica for either, shared storage is not optional —
use an RWX PVC or S3.

### Worker memory sizing

The Helm default of `12Gi` memory for the worker reflects real production
peaks with two concurrent jobs per pod. If you reduce this, expect the worker
to OOM-kill during large transcription or concurrent ffmpeg + ONNX jobs.

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
