---
title: Architecture overview
description: How the Nuxt frontend and the Go (Echo / GORM / Asynq) backend fit together, and how heavy work flows through the async queue.
---

Alcoves is two deployable units that meet at a reverse proxy: a **Nuxt 4
frontend** on its own Nitro server, and a **Go API backend**. The Go binary is a
pure API — it does not embed or serve the frontend.

This page is the map; the rest of the section drills into each subsystem —
[backend](/architecture/backend-architecture-go/),
[frontend](/architecture/frontend-architecture/),
[database & migrations](/architecture/database-schema-and-migrations/),
[media processing](/architecture/media-processing-pipeline/),
[storage backends](/architecture/storage-backends/), and
[ML models & runtime](/architecture/ml-models-runtime/).

## Topology

```
                ┌─────────────────────┐
   browser ───► │   Reverse proxy     │
                └─────────┬───────────┘
                          │  /api/**, /s/**
        ┌─────────────────┴────────────────┐
        ▼                                   ▼
┌───────────────┐                  ┌──────────────────┐
│ Nuxt (Nitro)  │                  │  Go API (Echo)    │
│  :3000        │                  │  :3001            │
└───────────────┘                  └────────┬─────────┘
                                            │
                         ┌──────────────────┼───────────────────┐
                         ▼                  ▼                    ▼
                  ┌────────────┐    ┌──────────────┐    ┌────────────────┐
                  │ PostgreSQL │    │  Dragonfly    │    │ Local / S3      │
                  │  (GORM)    │    │  (Asynq queue)│    │ blob storage    │
                  └────────────┘    └──────────────┘    └────────────────┘
```

In production both servers sit behind one reverse proxy; the proxy routes
`/api/**` and `/s/**` (public share pages) to Go and everything else to Nuxt.

## Backend (Go)

- **Echo** HTTP framework, **GORM** over PostgreSQL, **Asynq** for async jobs
  backed by Dragonfly/Redis.
- **Modes** (`ALCOVES_MODE`): `all`, `api`, or `worker` — the same binary runs
  the request path, the workers, or both.
- Session auth via an **AES-GCM encrypted cookie**; library access is enforced by
  middleware before any handler runs.
- Heavy work — transcoding, hashing, and all ML inference — is pushed onto the
  queue with status / progress / version columns so it never blocks a request and
  can be safely re-triggered.

## Frontend (Nuxt 4)

- Nuxt 4 (Vue 3) with the Nuxt UI v4 module, on its own Nitro server.
- SSR is scoped to `/s/**` (public moment share pages); all other routes are
  client-rendered to avoid SSR-time backend coupling.
- An isomorphic fetch wrapper forwards the session cookie on SSR and uses a
  Nitro proxy on the client.

## The async pipeline

When a file lands, the API enqueues work rather than doing it inline:

1. **Ingest** — SHA-256 hash and dedup (derived/trashed files ignored).
2. **Media** — thumbnails, video proxy transcodes, audio waveforms.
3. **ML** — CPU-only ONNX models for faces, objects, audio events, plus
   whisper.cpp transcription.
4. **Index** — results become searchable and drive the activity feed.

This async-by-default design is what keeps the request path fast and the system
[degradable](/concepts/privacy-and-local-ai/): if an optional dependency is
missing, Alcoves falls back instead of failing.
