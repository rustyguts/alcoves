# Deployment & Operations (Docker, Helm, CI/CD)

This document describes how Alcoves is **built, shipped, and run** — from the
root multi-stage `Dockerfile` and the local `docker-compose.yml` development
stack, through the production Helm chart, to the GitHub Actions CI/CD pipeline
and the release-please automation that cuts versions.

Alcoves is a self-hosted collaborative media library composed of two long-lived
processes plus two external data stores. The Go binary is a **pure API** — it
does not embed or serve the frontend. Understanding the runtime topology is the
prerequisite for everything else in this doc.

---

## 1. Runtime topology

```
                          ┌────────────────────────────────────────┐
   browser ──────────────▶│        reverse proxy / ingress         │
                          │  /api/**  + /s/**  ──▶ Go API :3001     │
                          │  /        (+ SSR /s/**) ──▶ Nuxt :3000  │
                          └───────────────┬─────────────┬──────────┘
                                          │             │
                            ┌─────────────▼──┐   ┌──────▼───────────┐
                            │ Nuxt 4 Nitro   │   │ Go API (Echo)    │
                            │ :3000          │   │ :3001            │
                            │ (frontend SSR  │   │ ALCOVES_MODE=    │
                            │  scoped /s/**) │   │ all|api|worker   │
                            └────────────────┘   └───┬──────────┬───┘
                                                     │          │
                                       ┌─────────────▼──┐  ┌────▼──────────────┐
                                       │ PostgreSQL 18  │  │ Dragonfly (Redis) │
                                       │ + pgvector     │  │ Asynq queue +     │
                                       │ :5432          │  │ activity pub/sub  │
                                       └────────────────┘  │ :6389 (dev)       │
                                                           └───────────────────┘
```

| Process | Port | Role |
|---|---|---|
| Nuxt 4 Nitro server | 3000 | Renders the UI. SSR is scoped to `/s/**` (public moment share pages) only; everything else is client-rendered. Proxies `/api/**` + `/s/**` to the Go API in dev. |
| Go API (Echo) | 3001 | All HTTP endpoints under `/api/**` plus the async worker pool. |
| PostgreSQL 18 + pgvector | 5432 | System of record. pgvector is required from migration `00001` (512-dim face embeddings, HNSW index in `00019`). |
| Dragonfly (Redis-compatible) | 6389 (dev) / 6379 (prod default) | Backs the Asynq job queue and the cross-process activity pub/sub bus. |

**Routing contract:** put both processes behind one reverse proxy. Route the
path prefixes `/api/**` and `/s/**` to the Go service on `:3001`; route
everything else (`/`, including the SSR share landing pages) to the Nuxt Nitro
server on `:3000`. In dev, Nuxt's own Nitro proxy does this for you (`/api` →
`$ALCOVES_API_URL`, default `http://localhost:3001`, with `ws:true` for the
WebSocket hub).

**`ALCOVES_MODE`** selects the Go binary's behavior from one image:

- `all` (default) — registers all HTTP routes **and** runs the Asynq worker pool.
- `api` — HTTP routes only, no worker goroutine.
- `worker` — Asynq worker only; no HTTP route registration except
  `/api/health` and `/api/version`; the activity WebSocket hub is not created.

**Migrations run at API startup.** `database.RunMigrations` applies all pending
Goose migrations (embedded via `migrations.FS`) before any handler is
registered. Rolling out a new image version automatically applies schema
changes; `kubectl rollout restart deploy/<name>-api` is the upgrade trigger.

---

## 2. The root `Dockerfile` (backend image)

The repo-root `Dockerfile` is a **multi-stage** build producing a single slim
Go API image. The frontend has its own `Dockerfile`; this one is backend-only.

### Stage 1 — `backend-build` (`golang:1.26-bookworm`)

- **System deps:** `libvips-dev` (for `govips`/libvips image processing),
  `ffmpeg` (video/audio probe + transcode + PCM extraction), `cmake`,
  `build-essential`, `pkg-config`, `libgomp1` (OpenMP for ONNX).
- **ONNX Runtime v1.24.1:** downloaded from GitHub releases, architecture-aware
  (`arm64` → `aarch64`, else `x64`), installed to `/usr/local/lib` +
  `/usr/local/include`, `.so` stripped, `ldconfig` run.
- **Air** hot-reload (`go install github.com/air-verse/air@latest`) — only used
  by the dev container, not the production image.
- **`git config --global --add safe.directory /app`** — avoids the git
  dubious-ownership error when the host repo is bind-mounted (UID mismatch),
  which would otherwise break the VCS stamp used by `/api/version`.
- **Build-arg ldflag injection** for the version endpoint:
  ```
  -X github.com/alcoves/alcoves-backend/internal/version.commit=$COMMIT_SHA
  -X github.com/alcoves/alcoves-backend/internal/version.buildTime=$BUILD_TIME
  -X github.com/alcoves/alcoves-backend/internal/version.appVersion=$APP_VERSION
  ```
  These three args (`COMMIT_SHA`, `BUILD_TIME`, `APP_VERSION`) are passed by CI.
  A local `go run` produces `"version":"dev"` because no ldflags are set.
- **Compile:** `CGO_ENABLED=1 GOOS=linux go build -o /alcoves ./cmd/server`
  (CGO is mandatory — libvips and ONNX are C libraries).

### Stage 2 — `whisper-build` (`debian:bookworm-slim`)

- Shallow-clones `ggerganov/whisper.cpp` at `ARG WHISPER_VERSION=v1.8.4`.
- CMake Release build with **AVX/AVX2/FMA/F16C enabled, AVX-512 disabled,
  `-march=x86-64-v3`** — a broad-compatibility CPU baseline.
- Outputs `whisper-cli` plus shared libs `libwhisper.so*`, `libggml*.so*`.
- Whisper **models are not bundled** — the transcribe worker downloads GGML
  weights on demand from `ALCOVES_WHISPER_MODEL_BASE_URL`.

### Stage 3 — final image (`debian:bookworm-slim`)

- **Runtime deps:** `libvips42`, `ffmpeg`, `libgomp1`, `tzdata`,
  `ca-certificates`.
- Copies `libonnxruntime*` from stage 1 and `whisper-cli` + whisper/ggml shared
  libs from stage 2.
- Creates an `onnxruntime.so` symlink and runs `ldconfig`.
- **`ENV LD_LIBRARY_PATH=/usr/local/lib`** — required because the Go ONNX
  bindings call `dlopen("onnxruntime.so")` with a bare name, and
  `onnxruntime.so` is not a SONAME so the ldconfig cache doesn't resolve it.
- `EXPOSE 3001`, `ENTRYPOINT ["/app/alcoves"]`.

---

## 3. Frontend Dockerfiles

There are two:

- **`frontend/Dockerfile`** — production image. Builds the Nuxt app
  (`bun run build` → `.output/`) and runs the Nitro server
  (`node .output/server/index.mjs`) on `:3000`. Built and pushed as the
  `…-frontend` image by `publish.yml`. Nitro preset is `"bun"`.
- **`frontend/Dockerfile.dev`** — dev container. Runs `bun run dev` (Nuxt dev
  server with HMR) on `:3000`. Used by `docker-compose.yml`.

Bun installs with the **hoisted linker** (`bunfig.toml` pins
`linker = "hoisted"`). This is mandatory — Bun's default symlink layout
triggers an ELOOP loop in Nitro's dependency-trace step at build time.

---

## 4. Local development: `docker-compose.yml`

Four services for the full local stack. `docker compose up` brings up
everything; `docker compose up -d postgres dragonfly` brings up infra only.

| Service | Image / build | Port | Notes |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg18` | 5432 (internal) | `POSTGRES_DB=alcoves`. Health check: `pg_isready`. |
| `dragonfly` | `dragonflydb/dragonfly:latest` | `6389:6379` | Args include `--default_lua_flags=allow-undeclared-keys`. Health check: `redis-cli ping`. |
| `backend` | `build: ./backend` | `3001:3001` | Air hot-reload. Mounts `.git:ro` (for `vcs.revision`), `./data`, and caches `go_mod_cache` + `go_build_cache`. Sets `LD_LIBRARY_PATH=/usr/local/lib`. `ALCOVES_MODE` from `.env`. |
| `frontend` | `build: ./frontend/Dockerfile.dev` | `3000:3000` | `bun run dev`. `ALCOVES_API_URL=http://backend:3001`. Named `frontend_node_modules` volume; **anonymous volumes shadow `/app/.nuxt` and `/app/.output`** so host build artifacts never leak into the container. Runs as `${UID:-1000}:${GID:-1000}` with `HOME=/tmp`. Health check: `bun -e fetch(...)`. |

**Startup ordering** is enforced by health checks:

- `backend` waits for `postgres: service_healthy` **and**
  `dragonfly: service_healthy`.
- `frontend` waits for `backend`.

**Named volumes:** `postgres_data`, `go_mod_cache`, `go_build_cache`,
`frontend_node_modules`. The `frontend_node_modules` volume starts empty, so the
frontend container runs `bun install` at first startup.

### `backend/.air.toml`

Drives the backend hot-reload loop inside the dev container:

- `cmd`: `go build -tags dev -o ./tmp/main ./cmd/server` (note the `dev` build tag).
- Watches `*.go` and `*.toml`; excludes `tmp/`, `vendor/`, `data/`, `migrations/`.
- `delay = 1000ms`, `clean_on_exit = true`.

---

## 5. The `.env.example` surface

`.env.example` is the canonical reference for all `ALCOVES_*` variables. Copy it
to `.env` for local dev. Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `ALCOVES_MODE` | `all` | `all` / `api` / `worker` |
| `ALCOVES_ENV` | `development` | `development` or `production` (controls dev-only CORS localhost origins) |
| `ALCOVES_BASE_URL` | `http://localhost:5173` | Public URL; drives OAuth redirect URIs, share links, and the primary CORS origin |
| `ALCOVES_DATABASE_URL` | `postgres://postgres:postgres@localhost:5455/alcoves` | PostgreSQL DSN (must have pgvector) |
| `ALCOVES_SESSION_SECRET` | dev placeholder | **Required**, ≥32 bytes; AES-GCM cookie key. Generate with `openssl rand -base64 32`. The only hard-required field — `config.Load()` errors without it. |
| `ALCOVES_QUEUE_HOST` / `ALCOVES_QUEUE_PORT` / `ALCOVES_QUEUE_PASSWORD` | `localhost:6389` | Dragonfly/Redis for Asynq |
| `ALCOVES_STORAGE_DRIVER` | `local` | `local` or `s3` |
| `ALCOVES_STORAGE_PATH` / `ALCOVES_AVATAR_STORAGE_PATH` / `ALCOVES_CACHE_STORAGE_PATH` | `./data/...` | Local-driver roots |
| `ALCOVES_S3_BUCKET` / `_REGION` / `_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_FORCE_PATH_STYLE` / `_FILES_PREFIX` / `_AVATARS_PREFIX` / `_CACHE_PREFIX` | — | S3 driver |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` / `_SECRET` | — | Google OAuth; `GoogleAuthEnabled` is auto-derived from a non-empty client ID. Frontend probes `GET /api/auth/providers`. |
| `ALCOVES_EXTRA_CORS_ORIGINS` | — | Comma list of extra allowed origins |
| `ALCOVES_MODELS_PATH` | `./data/.models` | ONNX model cache dir |
| `ALCOVES_WHISPER_MODEL` | `large-v3` | Boot-time fallback; admin UI overrides at runtime |
| `ALCOVES_WHISPER_LANGUAGE` | `auto` | |
| `ALCOVES_WHISPER_VAD_MODEL` | `silero-v6.2.0` | Silero VAD; empty disables |
| `ALCOVES_WHISPER_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | GGML model downloads |
| `ALCOVES_WHISPER_MODELS_DIR` | `./data/.whisper` | Whisper model cache dir |
| `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` | `https://s3.rustyguts.net/models` | Audio-tagger ONNX downloads |
| `ALCOVES_AUDIO_DETECT_LABELS_URL` | `…/audioset_class_labels_indices.csv` | AudioSet label CSV |
| `ALCOVES_AUDIO_DETECT_WINDOW_SEC` / `_THRESHOLD` / `_TOP_K` | `10.0` / `0.2` / `5` | Audio tagger tuning |
| `ALCOVES_FACE_DETECTION_MIN_SCORE`, `_FACE_RECOGNITION_MAX_DISTANCE`, `_MIN_FACES`, `_NEIGHBOR_LOOKUP` | tuning | Face pipeline thresholds |
| `ALCOVES_OBJECT_DETECTION_MIN_SCORE`, `_MAX_DETECTIONS`, `_NMS_THRESHOLD` | tuning | Object pipeline thresholds |

**Frontend (Nuxt) env vars:**

| Variable | Default | Purpose |
|---|---|---|
| `ALCOVES_API_URL` | `http://localhost:3001` | Go backend URL for the Nitro dev proxy / SSR backend calls. Exposed as `runtimeConfig.apiUrl`. |
| `NUXT_PUBLIC_API_ORIGIN` | `""` | Browser-side API origin. When set, the client absolutizes API URLs and sends `credentials: "include"` — used in production so browsers stream video/images/downloads **directly** from the API, bypassing Nitro (which can corrupt HTTP `Range` responses). |
| `NITRO_HOST` / `NITRO_PORT` | `0.0.0.0` / `3000` | Server bind address |

**Model settings are boot-time fallbacks only.** Admins override the whisper
model, language, and audio-tagger selection at runtime via `/admin → Inference
Models` (persisted in the single-row `app_settings` table). Workers read admin
settings first and fall back to env on a fresh install.

---

## 6. Helm chart (`helm/alcoves/`)

Helm 3 chart, `apiVersion: v2`, `type: application`. Chart `version` and
`appVersion` both mirror `/VERSION` (release-please keeps them in sync via
`extra-files`). The chart does **not** deploy Postgres or Dragonfly — operators
supply their own.

**Prerequisites:** Kubernetes 1.27+, an nginx ingress controller, cert-manager
(or other TLS source), pgvector-enabled Postgres, a Redis-compatible queue, and
either an RWX PVC or S3.

### Workloads

| Template | Resource(s) | Enabled by |
|---|---|---|
| `backend-api.yaml` | `Deployment` + `Service` (ClusterIP) | `backend.api.enabled` |
| `backend-worker.yaml` | `Deployment` (no Service) | `backend.worker.enabled` |
| `frontend.yaml` | `Deployment` + `Service` (ClusterIP) | `frontend.enabled` |
| `ingress.yaml` | `Ingress` | `ingress.enabled` |
| `pvc.yaml` | `PersistentVolumeClaim` | local driver + PV enabled + no existing claim |
| `secret.yaml` | `Secret` (Opaque) | always |
| `serviceaccount.yaml` | `ServiceAccount` | `serviceAccount.create` |

The **split API/worker** design uses one image for both deployments;
`ALCOVES_MODE` selects behavior. The API deployment handles HTTP; the worker
deployment handles CPU/RAM-intensive Asynq jobs (ffmpeg, whisper.cpp, ONNX
inference).

#### Backend API (`ALCOVES_MODE=api`)

- Port `backend.api.port` (default 3001), named `http`.
- Liveness probe: `GET /api/health` (`initialDelaySeconds: 20`,
  `periodSeconds: 30`).
- Readiness probe: `GET /api/health` (`initialDelaySeconds: 5`,
  `periodSeconds: 5`).
- Resources: requests `200m / 512Mi`, limits `2 CPU / 2Gi`.
- **Default replicas: 2.**
- Mounts the PVC at `/app/data` when `storage.driver=local`.

#### Backend worker (`ALCOVES_MODE=worker`)

- Same image as the API, no Service.
- Default replicas: 1.
- Resources: requests `2 CPU / 4Gi`, **no CPU limit**, memory limit `10Gi`.
  The missing CPU limit is deliberate — whisper.cpp + ffmpeg + ONNX are bursty
  compute-heavy workloads where CFS throttling hurts latency more than it helps
  isolation. (whisper medium alone needs ~2.5 GB RAM; concurrent ffmpeg + ONNX
  can spike past 4 GB.)
- Mounts the **same PVC** as the API at `/app/data` — both pods must read/write
  the same files, which is why the PVC must be RWX when either replica count > 1.

#### Frontend (Nuxt Nitro)

- Port `frontend.port` (default 3000).
- Env: `NITRO_HOST=0.0.0.0`, `NITRO_PORT`,
  `ALCOVES_API_URL=http://<api-service>:<port>` (in-cluster SSR target), and
  `NUXT_PUBLIC_API_ORIGIN` (browser-side origin for direct binary streaming).
- Liveness/readiness probes: `GET /`.
- Resources: requests `100m / 256Mi`, limits `1 CPU / 512Mi`.
- Default replicas: 2.

### Ingress routing

- `/api` → backend-api service (prefix match).
- `/` → frontend service (prefix match, catch-all including SSR `/s/**`).
- **TUS/range-friendly annotations** (default): `proxy-body-size: 0` (unlimited),
  `proxy-read-timeout: 3600`, `proxy-send-timeout: 3600`, `proxy-buffering: off`,
  `proxy-request-buffering: off` — required for TUS resumable uploads and video
  HTTP `Range` requests.
- TLS via `ingress.tls.enabled`, default `secretName: alcoves-tls`.

### Storage: RWX PVC vs S3

- **`pvc.yaml`** is created only for `storage.driver=local` when
  `persistentVolume.enabled` and no `existingClaim`. Defaults:
  `storageClass: ""` (cluster default), `accessModes: [ReadWriteMany]`,
  `size: 200Gi`. Must be RWX when API or worker `replicaCount > 1` (they share
  it).
- **S3 driver** (`storage.driver=s3`) injects `ALCOVES_S3_*` env vars and needs
  no PVC.

The local driver injects fixed in-pod paths:
`ALCOVES_STORAGE_PATH=/app/data`, `ALCOVES_AVATAR_STORAGE_PATH=/app/data/avatars`,
`ALCOVES_CACHE_STORAGE_PATH=/app/data/.cache`,
`ALCOVES_MODELS_PATH=/app/data/.models`,
`ALCOVES_WHISPER_MODELS_DIR=/app/data/.whisper`.

### Secrets (`secret.yaml` + `_envvars.tpl`)

The chart manages one generated Secret (`<fullname>-app`) for non-delegated
credentials. Each secret type supports an `existingSecret` reference to pull
from a pre-existing K8s Secret instead:

| Credential | Values key | Existing-secret delegation |
|---|---|---|
| Session secret | `sessionSecret` | `existingSessionSecret` → key `sessionSecret` |
| Database URL | `database.url` | `database.existingSecret` → key `url` |
| Queue password | `queue.password` | `queue.existingSecret` → key `password` |
| Google OAuth | `oauth.google.clientId/clientSecret` | `oauth.google.existingSecret` → keys `clientId`, `clientSecret` |
| S3 credentials | `storage.s3.accessKeyId/secretAccessKey` | `storage.s3.existingSecret` → keys `accessKeyId`, `secretAccessKey` |

`sessionSecret` is **required** — Helm fails (`required`) if both
`sessionSecret` and `existingSessionSecret` are empty.

The `alcoves.backendEnv` helper in `_envvars.tpl` is included by both
`backend-api.yaml` and `backend-worker.yaml`. It injects all env vars (storage
paths differ by driver), wires secrets via `secretKeyRef`, and appends any
`extraEnv` list entries verbatim — the escape hatch for tuning face-detection
thresholds, model paths, etc. without chart changes.

Template helpers in `_helpers.tpl` include `alcoves.fullname`,
`alcoves.api.fullname` / `worker.fullname` / `frontend.fullname`,
`alcoves.labels` / `selectorLabels`, `alcoves.backend.image` /
`frontend.image` (tag defaults to `Chart.AppVersion`), `alcoves.appSecretName`,
and `alcoves.publicApiOrigin` (falls back to `baseUrl`).

---

## 7. CI/CD (`.github/workflows/`)

### `ci.yml` — test gate (PRs + push to `main`)

Three parallel jobs:

**`backend-test`** (ubuntu-latest, 20m timeout)
- Service container: `pgvector/pgvector:pg18` on `5455:5432`, db `alcoves_test`.
- Env: `ALCOVES_DATABASE_URL=postgres://…@localhost:5455/alcoves_test`,
  `ALCOVES_SESSION_SECRET`, `ALCOVES_STORAGE_DRIVER=local`.
- Steps: checkout → `setup-go` (version from `backend/go.mod`) → install
  `libvips-dev` + libheif plugins → install ONNX Runtime v1.24.1 (same
  arch-aware logic as the Dockerfile) → `go mod download` → `go vet ./...` →
  `go build ./...` → `go test ./... -race -count=1 -p 1`.
- **`-p 1` is critical:** it forces sequential package execution. The
  `internal/handlers` and `internal/services/files` integration tests share the
  same test Postgres and `TRUNCATE` the same tables; running them in parallel
  causes FK violations / deadlocks.

**`unit-and-coverage`** (ubuntu-latest, 20m, working dir `frontend`)
- `setup-bun@v2` → `bun install --frozen-lockfile` → `bun run lint` →
  `bun run typecheck` → `bun run test:unit:coverage` → `bun run coverage:summary`
  → upload `coverage/` as `coverage-report`.

**`e2e`** (ubuntu-latest, 30m, **4-shard matrix**, `fail-fast: false`)
- Services: postgres on `5455:5432` + dragonfly on `6389:6379`, full backend env.
- `bunx playwright install --with-deps chromium` →
  `bunx playwright test --shard=$shard/4` → upload `playwright-report/` per shard.
- All four shards run to completion even if one fails.

### `publish.yml` — image build & push (GHCR)

Triggers on push to `main`/`dev`, semver tags (`v*`), PRs (build only, no push),
and `release: published`.

- Registry: `ghcr.io`. **Matrix builds two images in parallel:**
  `ghcr.io/<repo>` (backend, from root `Dockerfile`) and
  `ghcr.io/<repo>-frontend` (from `frontend/Dockerfile`).
- Tags via `docker/metadata-action@v6`: short SHA, branch name,
  semver `{{version}}`, semver `{{major}}.{{minor}}`.
- Build args: `COMMIT_SHA=${{ github.sha }}`, `BUILD_TIME` (from commit/release
  timestamp), `APP_VERSION=$(cat VERSION)` — these feed the version ldflags.
- Push only when `github.event_name != 'pull_request'`.
- Permissions: `contents: read`, `packages: write`.

### `release-please.yml` + `release-please-config.json`

Runs on push to `main` via `googleapis/release-please-action@v4`. Token:
`RELEASE_PLEASE_TOKEN` (a fine-grained PAT is preferred so the tag it pushes
re-triggers `publish.yml`; with the fallback `GITHUB_TOKEN`, the Docker build
won't auto-fire on the tag).

`release-please-config.json` highlights:

- `release-type: simple` — manages a plain-text `VERSION` file, not a
  language-specific manifest.
- `bump-minor-pre-major: true` + `bump-patch-for-minor-pre-major: false` —
  `feat:` always bumps minor (`0.x.0`), never falls through to patch.
- `include-v-in-tag: true` — tags are `v0.x.y`. `include-component-in-tag: false`.
- Root package `.`: `version-file: VERSION`,
  `extra-files: [helm/alcoves/Chart.yaml]` (both kept in sync).
- Changelog sections: `feat→Added`, `fix→Fixed`, `perf→Performance`,
  `refactor→Changed`, `revert→Reverted`, `docs→Documentation`, `test→Tests`,
  `build→Build`, `ci→CI`. `chore` and `style` are **hidden** — no CHANGELOG
  entry and no Release PR on their own.

### End-to-end release workflow

1. Land Conventional-Commit commits to `main` →
   `release-please.yml` opens/updates a single Release PR titled
   `chore(main): release 0.x.y`.
2. The Release PR diff touches: `/VERSION`, `helm/alcoves/Chart.yaml` (both
   `version` and `appVersion`), `.release-please-manifest.json`, `CHANGELOG.md`.
   You may hand-edit the CHANGELOG section before merging.
3. Merge the Release PR → release-please creates the annotated `v0.x.y` tag +
   a GitHub Release.
4. The tag push triggers `publish.yml` → builds `ghcr.io/<repo>:0.x.y` and
   `:0.x` for **both** backend and frontend images.
5. The running backend surfaces the embedded version at `GET /api/version`
   (`{version, commit, buildTime, dirty, mode}`); a local `go run` returns
   `"version":"dev"`.

**Bump policy:** `feat:` → minor; `fix:` / `perf:` / `refactor:` / `docs:` /
`test:` / `build:` / `ci:` → patch; `chore:` / `style:` are hidden. Never bumps
to `1.0.0` while pre-1.0 (alpha). Force a specific version with a
`Release-As: 0.x.y` commit footer.

> **Do not** hand-edit `/VERSION`, `/CHANGELOG.md`, or
> `helm/alcoves/Chart.yaml` versions in feature PRs — release-please owns them.
> The plain-text `/VERSION` at the repo root is the single runtime source of truth.

---

## 8. The `/api/health` and `/api/version` endpoints

Both are always registered (even in `worker` mode) and are public (exempted in
`AuthMiddleware`):

- `GET /api/health` → `{"status":"ok","mode":"<mode>"}` — used by Helm
  liveness/readiness probes and the compose health check.
- `GET /api/version` → `{version, commit, buildTime, dirty, mode}` — version
  from ldflags; falls back to `runtime/debug.ReadBuildInfo()` VCS stamps
  (`vcs.revision`, `vcs.time`, `vcs.modified`) when ldflags are unset.

---

## 9. `scripts/factory.sh` — the automation loop

`scripts/factory.sh` is the "Software Factory" loop that drives autonomous work:

- Polls **GitHub Project Board #4** (owner `rustyguts`) every `POLL_INTERVAL`
  seconds (default 30) for issues whose `status == "Ready"`.
- Uses `gh project item-list … --format json` and selects the first Ready issue
  with `jq -c '[...] | first // empty'`.
- When one is found, it dispatches
  `claude --dangerously-skip-permissions --print "/turn-off-the-lights"` from
  the repo root. `claude` runs directly (not in a subshell) so stdout/stderr
  stream live to the terminal.
- Handles `INT`/`TERM` gracefully. Requires an authenticated `gh` CLI plus `jq`.

The `/turn-off-the-lights` workflow it invokes is defined in
`turn-off-the-lights.md` at the repo root.

### Related model-publishing scripts

- `scripts/upload-whisper-models.sh` — mirrors GGML whisper models + Silero VAD
  to `s3.rustyguts.net/models/` via `rclone` (idempotent; supports subset
  upload and `DRY_RUN=1`). Model IDs must stay in sync with
  `backend/internal/services/transcribe/whisper_models.go`.
- `scripts/export-audio-tagger.py` (+ `.requirements.txt`) — exports EfficientAT
  and CED checkpoints to ONNX (opset 17) with the mel-spectrogram baked in, so
  the Go worker feeds raw mono PCM directly. Output filenames must match
  `backend/internal/services/audiodetection/registry.go`.

---

## 10. Operational notes & gotchas

- **First job blocks on model download.** ONNX models (face, object) are
  pre-fetched in a background goroutine at startup (non-fatal warning on
  failure), but a worker that hasn't finished downloading will block the first
  job that needs that model. Whisper and audio-tagger models download lazily on
  first use.
- **Worker memory headroom.** The Helm worker default of `10Gi` memory and no
  CPU limit reflects real peaks: whisper large-v3 needs ~3.9 GB, and concurrent
  ffmpeg + ONNX can push well past 4 GB. Don't add a CPU limit casually.
- **Shared PVC is mandatory for multi-replica.** API and worker pods both mount
  `/app/data`; with `replicaCount > 1` the PVC must be `ReadWriteMany`.
- **Range requests + TUS need buffering off.** The ingress annotations
  (`proxy-buffering: off`, `proxy-request-buffering: off`, `proxy-body-size: 0`)
  are load-bearing for resumable uploads and seekable video.
- **Direct browser streaming.** Set `NUXT_PUBLIC_API_ORIGIN` in production so
  browsers fetch binary content straight from the API and bypass Nitro, which
  can mangle `Range` responses.
- **CORS is an explicit allowlist.** `buildCORSOrigins` derives the primary
  origin from `ALCOVES_BASE_URL`, appends `ALCOVES_EXTRA_CORS_ORIGINS`, and adds
  localhost variants only when `ALCOVES_ENV=development`. `AllowCredentials:
  true` is safe only because the list is never reflected — keep
  `ALCOVES_BASE_URL` accurate in production.

---

## Related code

| Area | Path |
|---|---|
| Backend image | `Dockerfile` |
| Frontend images | `frontend/Dockerfile`, `frontend/Dockerfile.dev` |
| Local dev stack | `docker-compose.yml` |
| Backend hot-reload | `backend/.air.toml` |
| Env reference | `.env.example` |
| Config loader | `backend/internal/config/config.go` |
| Entry point + mode wiring | `backend/cmd/server/main.go` |
| Migrations (Goose) | `backend/migrations/*.sql`, `backend/migrations/embed.go` |
| Version ldflags | `backend/internal/version/version.go` |
| Auth / CORS middleware | `backend/internal/middleware/auth.go`, `library_access.go` |
| Helm chart | `helm/alcoves/Chart.yaml`, `helm/alcoves/values.yaml`, `helm/alcoves/templates/**` |
| Helm env/secret helpers | `helm/alcoves/templates/_envvars.tpl`, `_helpers.tpl`, `secret.yaml` |
| CI test gate | `.github/workflows/ci.yml` |
| Image publish | `.github/workflows/publish.yml` |
| Release automation | `.github/workflows/release-please.yml`, `release-please-config.json` |
| Version source of truth | `VERSION` |
| Factory loop | `scripts/factory.sh` |
| Model publishing | `scripts/upload-whisper-models.sh`, `scripts/export-audio-tagger.py` |
| Frontend Nitro/SSR config | `frontend/nuxt.config.ts`, `frontend/bunfig.toml` |
