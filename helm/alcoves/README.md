# Alcoves Helm chart

Self-hosted Alcoves on Kubernetes — SvelteKit (SSR) frontend + Go API +
dedicated worker pool for ffmpeg / whisper.cpp / ONNX jobs, all from **one
unified image**.

## Two ways to deploy

The chart supports two deployment modes (`deploymentMode`):

| Mode | What you get | Best for |
|---|---|---|
| `distributed` (default) | Three workloads — `frontend` (SvelteKit, `web` role), `api` (`api` role), `worker` (`worker` role) — that scale independently | Multi-node clusters, larger libraries, isolating heavy ML/transcode work from request latency |
| `standalone` | ONE pod running the image's `all` role (frontend + API + worker supervised together) | Single-node clusters (k3s, homelab): no ReadWriteMany storage requirement, minimal moving parts |

Every workload pulls the same image (`ghcr.io/rustyguts/alcoves`) and selects
its role via container `args`, so upgrading is a single `image.tag` bump.

## Prerequisites

- Kubernetes 1.27+; an ingress controller (nginx tested) and cert-manager (or another TLS source) if you enable the ingress.
- **PostgreSQL with `pgvector`** reachable from the cluster (CloudNativePG, Crunchy Postgres, RDS, …). The chart does not deploy Postgres.
- **Dragonfly** or any Redis-compatible service for the Asynq job queue. Not deployed by the chart either.
- Storage:
  - `distributed` + `storage.driver=local` → a **ReadWriteMany** PVC (NFS, CephFS, Longhorn RWX, …) — the api and worker pods share `/app/data`.
  - `standalone` + `storage.driver=local` → any PVC, `ReadWriteOnce` is fine.
  - `storage.driver=s3` → an S3-compatible bucket (no PVC created). Check the release notes before relying on S3 — server-side support is still being wired up.

## Layout

```
helm/alcoves/
├── Chart.yaml
├── values.yaml             # all defaults + inline docs
├── values.schema.json      # validated on install/upgrade
├── examples/
│   ├── standalone.yaml     # single-pod homelab install
│   └── production.yaml     # split workloads, RWX, external secrets, PDBs
└── templates/
    ├── _helpers.tpl        # names, labels, validation
    ├── _env.tpl            # shared backend + frontend env blocks
    ├── frontend/           # Deployment, Service, HPA, PDB (distributed)
    ├── api/                # Deployment, Service, HPA, PDB (distributed)
    ├── worker/             # Deployment, HPA, PDB (distributed; no Service)
    ├── standalone/         # Deployment, Service, PDB (standalone)
    ├── ingress.yaml        # /api → API, /.well-known/oauth-* → API (MCP), rest → frontend
    ├── secret.yaml         # chart-managed credentials (skipped if all external)
    ├── pvc.yaml            # data volume; kept on uninstall by default
    ├── networkpolicy.yaml  # optional
    ├── serviceaccount.yaml
    ├── tests/              # `helm test` smoke checks
    └── NOTES.txt
```

## Install

```bash
# 1. namespace
kubectl create namespace alcoves

# 2. secrets (recommended: pre-created, referenced via existing* values)
kubectl -n alcoves create secret generic alcoves-session \
  --from-literal=sessionSecret="$(openssl rand -base64 48)"
kubectl -n alcoves create secret generic alcoves-database \
  --from-literal=url='postgres://alcoves:secret@postgres:5432/alcoves?sslmode=require'

# 3. start from the example closest to your setup
cp helm/alcoves/examples/production.yaml my-values.yaml   # or standalone.yaml
$EDITOR my-values.yaml

# 4. install
helm install alcoves helm/alcoves -n alcoves -f my-values.yaml \
  --set existingSessionSecret=alcoves-session \
  --set database.existingSecret=alcoves-database

# 5. smoke-test
helm test alcoves -n alcoves
```

The chart fails fast at render time if required values are missing
(session secret, database) or contradictory (e.g. MCP OAuth without the MCP
HTTP transport, multi-replica standalone on an RWO volume).

## Configuration highlights

All values are documented inline in [values.yaml](values.yaml). The
non-obvious ones:

- **`baseUrl`** — the URL users type into their browser. Drives OAuth
  callbacks, share links, CORS, and (with MCP OAuth) the OAuth issuer. The
  chart warns at install time if it disagrees with `ingress.host`.
- **`frontend.publicApiOrigin`** — browsers stream video/images/downloads and
  the activity WebSocket directly from the API at this origin, bypassing the
  SvelteKit proxy. Defaults to `baseUrl` (correct when one ingress fronts
  both); set explicitly if the API lives on its own domain.
- **`oauth.google.*`** — configuring Google credentials also sets
  `PUBLIC_GOOGLE_AUTH_ENABLED` on the frontend so the sign-in button shows up.
- **`mcp.httpEnabled` / `mcp.oauth.*`** — expose the MCP server at `/api/mcp`
  (PAT bearer auth), optionally with the OAuth 2.1 flow used by remote
  connectors. The ingress automatically routes the `/.well-known/oauth-*`
  discovery endpoints to the API when OAuth is on.
- **`storage.persistentVolume.retain`** (default `true`) — the data PVC is
  annotated `helm.sh/resource-policy: keep`, so `helm uninstall` does NOT
  delete your files.
- **`extraEnv` / `extraEnvFrom`** — escape hatches into the backend pods for
  tuning vars (`ALCOVES_FACE_DETECTION_MIN_SCORE`, …) without forking the
  chart; `frontend.extraEnv` is the frontend-side equivalent.
- **`models.*`** — model download URLs default to the public bucket on
  `s3.rustyguts.net`. Point them at a private mirror if egress matters.
- **Scheduling** — every workload exposes `nodeSelector`, `tolerations`,
  `affinity`, `topologySpreadConstraints`, `priorityClassName`,
  `updateStrategy`, `podDisruptionBudget`, and (distributed mode)
  `autoscaling` (HPA).

### Secrets

Every credential can come from a pre-existing Secret instead of values:

| Credential | Inline value | Existing secret (key) |
|---|---|---|
| Session secret | `sessionSecret` | `existingSessionSecret` (`sessionSecret`) |
| Database URL | `database.url` | `database.existingSecret` (`url`) |
| Queue password | `queue.password` | `queue.existingSecret` (`password`) |
| Google OAuth | `oauth.google.clientId`/`clientSecret` | `oauth.google.existingSecret` (`clientId`, `clientSecret`) |
| S3 credentials | `storage.s3.accessKeyId`/`secretAccessKey` | `storage.s3.existingSecret` (`accessKeyId`, `secretAccessKey`) |

Inline values land in one chart-managed Secret; pods that consume it carry a
checksum annotation, so changing a credential rolls them automatically.

### Worker sizing (distributed mode)

Each worker pod runs Asynq at concurrency 2, so scale throughput **out**
(`backend.worker.replicaCount`) rather than up. Memory defaults
(request 4Gi / limit 12Gi, no CPU limit) are sized for two concurrent heavy
jobs (whisper large ≈ 4–5GB each); see the comments in `values.yaml` before
changing them. On SIGTERM, Asynq re-queues in-flight jobs, so worker pods are
safe to reschedule.

## Upgrade

```bash
helm upgrade alcoves helm/alcoves -n alcoves -f my-values.yaml
```

Database migrations (goose) run automatically when the API pods start — no
separate migration step. The chart keeps workload names and selectors stable,
so upgrades from previous chart versions roll in place.

> Switching `deploymentMode` replaces the workloads (different names) — fine
> for the stateless pods, but plan a brief outage and keep the same PVC.

## Verify

```bash
kubectl -n alcoves get pods,svc,ingress
helm test alcoves -n alcoves
curl -I https://alcoves.example.com/api/health
```

## Uninstall

```bash
helm uninstall alcoves -n alcoves
# The data PVC is kept by default (storage.persistentVolume.retain).
# Only if you want the data gone:
kubectl -n alcoves delete pvc alcoves-data
```
