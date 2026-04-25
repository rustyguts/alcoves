# Alcoves Helm chart

Self-hosted Alcoves on Kubernetes — Nuxt frontend + Go API + dedicated worker
deployment for ffmpeg / whisper.cpp / ONNX jobs.

## Layout

```
helm/alcoves/
├── Chart.yaml
├── values.yaml             # all defaults + inline docs
├── values.example.yaml     # production-style overrides to copy from
└── templates/
    ├── _helpers.tpl
    ├── _envvars.tpl        # shared backend env block
    ├── secret.yaml         # session/db/queue/oauth/s3 (when not using existing-secret refs)
    ├── serviceaccount.yaml
    ├── pvc.yaml            # data volume when storage.driver=local
    ├── backend-api.yaml    # api Deployment + Service
    ├── backend-worker.yaml # worker Deployment (no service)
    ├── frontend.yaml       # Nuxt Deployment + Service
    ├── ingress.yaml        # /api → api, everything else → frontend
    └── NOTES.txt
```

## Prerequisites

- Kubernetes 1.27+ with an ingress controller (nginx tested) and cert-manager (or another TLS source).
- **PostgreSQL with `pgvector`** reachable from the cluster (CloudNativePG, Crunchy Postgres, RDS, etc.). The chart does not deploy Postgres.
- **Dragonfly** or any Redis-compatible service for the asynq job queue.
- A storage backend:
  - `ReadWriteMany` PVC (NFS, CephFS, Longhorn RWX, etc.) for `storage.driver=local`, **or**
  - S3-compatible bucket for `storage.driver=s3`.
- Container images for backend + frontend pushed to a registry the cluster can pull from.

## Build + push images

```bash
# from repo root
docker build -t ghcr.io/yourorg/alcoves-backend:v0.1.0 .
docker build -t ghcr.io/yourorg/alcoves-frontend:v0.1.0 ./frontend
docker push ghcr.io/yourorg/alcoves-backend:v0.1.0
docker push ghcr.io/yourorg/alcoves-frontend:v0.1.0
```

The backend image bakes in `ffmpeg`, ONNX Runtime, and `whisper-cli` (whisper.cpp). Models (Whisper, PANNs, YOLO, InsightFace) are *not* baked in — they auto-download to `/app/data/.whisper` and `/app/data/.models` on first job from the URLs in `values.yaml > models`.

## Install

```bash
# 1. namespace
kubectl create namespace alcoves

# 2. provide secrets
kubectl -n alcoves create secret generic alcoves-database \
  --from-literal=url='postgres://alcoves:secret@postgres:5432/alcoves?sslmode=require'

kubectl -n alcoves create secret generic alcoves-session \
  --from-literal=sessionSecret="$(openssl rand -base64 48)"

# 3. customize values
cp helm/alcoves/values.example.yaml my-values.yaml
$EDITOR my-values.yaml          # set baseUrl, images, ingress host, replicas, etc.

# 4. install
helm install alcoves helm/alcoves \
  -n alcoves \
  -f my-values.yaml \
  --set database.existingSecret=alcoves-database \
  --set existingSessionSecret=alcoves-session
```

`--dry-run --debug` to preview rendered manifests.

## Upgrade

```bash
helm upgrade alcoves helm/alcoves -n alcoves -f my-values.yaml \
  --set database.existingSecret=alcoves-database \
  --set existingSessionSecret=alcoves-session
```

DB migrations (goose) run automatically at API pod startup. Roll the api deployment to apply schema changes:

```bash
kubectl -n alcoves rollout restart deploy/alcoves-api
```

## Architecture notes

- **Backend split** — `backend.api.replicaCount` runs `ALCOVES_MODE=api` (HTTP only). `backend.worker.replicaCount` runs `ALCOVES_MODE=worker` (asynq job processor only). They share env + PVC. ffmpeg / whisper / ONNX jobs land on workers so the API stays responsive.
- **Storage sharing** — when `storage.driver=local`, both api and worker pods mount the same PVC at `/app/data`. The PVC must be `ReadWriteMany` if either deployment has `replicaCount > 1`.
- **Direct API streaming** — the frontend deployment sets `NUXT_PUBLIC_API_ORIGIN` to `baseUrl` (or `frontend.publicApiOrigin` if you split api onto its own host). Browsers read this and stream video / images / downloads directly from the API service, bypassing Nuxt Nitro. Backend CORS is wide open (echoes origin + credentials).
- **SSR** — only `/s/**` (public moment shares) is server-rendered. Other routes ship as a SPA. Both go to the frontend service; the api service handles `/api/*`.
- **Ingress streaming tuning** — `proxy-buffering: off` + large bodies are required for video range requests + tus uploads through nginx-ingress.

## Common overrides

```bash
# Use S3-compatible storage instead of a PVC
helm upgrade alcoves helm/alcoves -n alcoves -f my-values.yaml \
  --set storage.driver=s3 \
  --set storage.s3.bucket=alcoves-prod \
  --set storage.s3.region=us-east-1 \
  --set storage.s3.endpoint=https://s3.example.com \
  --set storage.s3.existingSecret=alcoves-s3

# Turn off public sharing pod (single-tenant private deploy)
helm upgrade ... --set frontend.replicaCount=1 --set backend.api.replicaCount=1

# Pin model URLs to your private mirror
helm upgrade ... \
  --set models.whisperModelBaseUrl=https://models.internal/whisper \
  --set models.audioDetectModelUrl=https://models.internal/panns_cnn14.onnx \
  --set models.audioDetectLabelsUrl=https://models.internal/audioset_labels.csv
```

## Verify

```bash
kubectl -n alcoves get pods,svc,ingress
kubectl -n alcoves logs -l app.kubernetes.io/component=backend-api -f
kubectl -n alcoves logs -l app.kubernetes.io/component=backend-worker -f
curl -I https://alcoves.example.com/api/health
```

## Uninstall

```bash
helm uninstall alcoves -n alcoves
# PVC is retained by default — delete manually if you want the data gone.
kubectl -n alcoves delete pvc alcoves-data
```
