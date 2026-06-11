---
title: Architecture overview
description: How the SvelteKit frontend and the Go (Echo / GORM / Asynq) backend fit together, and how heavy work flows through the async queue.
---

Alcoves is two deployable units that meet at a reverse proxy: a **SvelteKit
frontend** (server-rendered, running under Bun) and a **Go API backend**. The
Go binary is a pure API — it does not embed or serve the frontend.

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
              /api/**     │     everything else (incl. /s/**)
        ┌─────────────────┴────────────────┐
        ▼                                   ▼
┌──────────────────┐               ┌───────────────┐
│  Go API (Echo)   │  ◄─SSR/proxy─ │  SvelteKit    │
│  :3001           │               │  :3000        │
└────────┬─────────┘               └───────────────┘
         │
         ├──────────────────┬───────────────────┐
         ▼                  ▼                    ▼
  ┌────────────┐    ┌──────────────┐    ┌────────────────┐
  │ PostgreSQL │    │  Dragonfly    │    │ Blob storage   │
  │  (GORM)    │    │  (Asynq queue)│    │ (local disk)   │
  └────────────┘    └──────────────┘    └────────────────┘
```

In production both servers sit behind one reverse proxy. The proxy routes
`/api/**` to the Go API and everything else — including the public share pages
at `/s/**` — to SvelteKit. The SvelteKit server also carries an in-process
`/api` proxy to the Go API, so a single-port setup still works; routing
`/api/**` directly at the Go API is preferred because it keeps video `Range`
streaming and resumable uploads untouched.

## Backend (Go)

- **Echo** HTTP framework, **GORM** over PostgreSQL, **Asynq** for async jobs
  backed by Dragonfly/Redis.
- **Modes** (`ALCOVES_MODE`): `all`, `api`, or `worker` — the same binary runs
  the request path, the workers, or both.
- Session auth via an **AES-GCM encrypted cookie**; library access is enforced
  by middleware before any handler runs.
- Heavy work — transcoding, hashing, and all ML inference — is pushed onto the
  queue with status / progress / version columns so it never blocks a request
  and can be safely re-triggered.

## Frontend (SvelteKit)

- SvelteKit with Svelte 5 runes, Skeleton UI, and Tailwind, built with
  `adapter-node` and served by Bun.
- **Server-rendered by default**: every page SSRs against the Go API (never
  the database) and hydrates in the browser. Share pages emit correct Open
  Graph tags for link embeds.
- Server-side fetches forward the session cookie to the Go API; in the
  browser, binary content and the activity WebSocket can bypass the SvelteKit
  proxy entirely via `PUBLIC_API_ORIGIN`.

## The async pipeline

When a file lands, the API enqueues work rather than doing it inline:

1. **Ingest** — SHA-256 hash and dedup (derived/trashed files ignored).
2. **Media** — thumbnails, video proxy transcodes, audio waveforms.
3. **ML** — CPU-only ONNX models for faces, objects, audio events, plus
   whisper.cpp transcription.
4. **Index** — results become searchable and drive the activity feed.

Files are usable as soon as they upload; analysis fills in behind them. The
queue is weighted so quick, interactive work (image transforms, thumbnails)
is never starved by long-running transcodes or transcription.
