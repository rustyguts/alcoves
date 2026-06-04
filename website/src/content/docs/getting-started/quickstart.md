---
title: Quickstart
description: Get a full Alcoves stack — frontend, API, Postgres, and the job queue — running locally with Docker Compose.
---

This guide gets a complete Alcoves instance running locally: the Nuxt frontend,
the Go API + worker, PostgreSQL, and Dragonfly (a Redis-compatible queue).

:::note[Sample doc]
This is a starter quickstart. Commands mirror the repo's
[deployment & operations](https://github.com/rustyguts/alcoves/blob/main/docs/deployment-and-operations.md)
guide — check there for the authoritative, full reference.
:::

## Prerequisites

- **Docker** and **Docker Compose** (v2)
- ~8 GB of free RAM (the CPU-only ML models are the ceiling)
- Git

## 1. Clone and configure

```sh
git clone https://github.com/rustyguts/alcoves.git
cd alcoves
cp .env.example .env
```

Open `.env` and set a real session secret before anything else:

```sh
# Generate an AES-GCM key (must be ≥ 32 bytes)
openssl rand -base64 32
```

Paste the result into `ALCOVES_SESSION_SECRET`.

## 2. Start the stack

```sh
docker compose up
```

This brings up four services:

| Service     | Port   | Purpose                                  |
| ----------- | ------ | ---------------------------------------- |
| Frontend    | `3000` | Nuxt (Nitro) server                      |
| Backend API | `3001` | Go API + worker (`ALCOVES_MODE=all`)     |
| PostgreSQL  | `5432` | Primary database (Goose migrations)      |
| Dragonfly   | `6389` | Redis-compatible async job queue (Asynq) |

Goose migrations run automatically on startup, so the schema is ready the first
time the API boots.

## 3. Open the app

Visit **http://localhost:3000** and register the first account. The first user
becomes the instance **owner** — the only role that can reach the admin panel,
the job queue dashboard, registration policy, and ML-model selection.

:::tip
The AI features (faces, objects, audio events, transcription) run **asynchronously**.
Upload a few photos or a short video, then watch the job queue in the admin
panel work through detection — no GPU required.
:::

## 4. Infrastructure only (optional)

To run Postgres and Dragonfly in Docker but the apps from source:

```sh
docker compose up -d postgres dragonfly
```

Then start each side from its own directory:

```sh
# Backend (from backend/)
go run cmd/server/main.go

# Frontend (from frontend/)
bun install
bun run dev
```

## Next steps

- [Configuration](/getting-started/configuration/) — every `ALCOVES_*` knob.
- [Architecture](/concepts/architecture/) — how the pieces fit together.
- [Privacy & local AI](/concepts/privacy-and-local-ai/) — how inference stays on your box.
