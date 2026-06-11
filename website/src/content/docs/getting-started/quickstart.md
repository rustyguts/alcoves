---
title: Quickstart
description: Run Alcoves with Docker Compose — the published image plus PostgreSQL and a job queue.
---

The fastest way to run Alcoves is Docker Compose: the published all-in-one
image, PostgreSQL (with pgvector), and Dragonfly (a Redis-compatible queue for
background jobs).

## Prerequisites

- **Docker** with **Docker Compose** (v2)
- An x86_64 machine. 8 GB of RAM is comfortable; the biggest consumer is
  transcription, and you can pick a smaller whisper model in the admin panel
  if memory is tight. No GPU is needed.

## 1. Create a compose file

Save this as `docker-compose.yml` in an empty directory:

```yaml
services:
  alcoves:
    image: ghcr.io/rustyguts/alcoves:0.28.0 # pin to the latest release
    ports:
      - '3000:3000'
    environment:
      - ALCOVES_BASE_URL=http://localhost:3000
      - ALCOVES_SESSION_SECRET=${ALCOVES_SESSION_SECRET:?set in .env}
      - ALCOVES_DATABASE_URL=postgres://postgres:postgres@postgres:5432/alcoves
      - ALCOVES_QUEUE_HOST=dragonfly
      - ALCOVES_QUEUE_PORT=6379
    volumes:
      - alcoves_data:/app/data
    depends_on:
      - postgres
      - dragonfly
    restart: unless-stopped

  postgres:
    image: pgvector/pgvector:pg18
    environment:
      - POSTGRES_DB=alcoves
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - postgres_data:/var/lib/postgresql
    restart: unless-stopped

  dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly:latest
    restart: unless-stopped

volumes:
  alcoves_data:
  postgres_data:
```

Then generate a session secret (used to encrypt login cookies) into a `.env`
file next to it:

```sh
echo "ALCOVES_SESSION_SECRET=$(openssl rand -base64 48)" > .env
```

## 2. Start it

```sh
docker compose up -d
```

The one Alcoves container runs the whole stack: the web UI, the Go API, and
the background worker. Database migrations apply automatically on startup.
Check it's up:

```sh
curl http://localhost:3000/api/health
# {"mode":"all","status":"ok"}
```

## 3. Open the app

Visit **http://localhost:3000** and register an account. The first account
becomes the instance **owner** — the only role that can open the admin panel,
the job-queue dashboard, registration policy, and ML model selection.

Upload a few photos or a short video and watch the library fill in:
thumbnails appear first, then faces, labels, and transcripts as the
background jobs finish. Models download on first use, so the very first
detection or transcription job takes longer than the rest.

## Putting it on the internet

The compose file above binds plain HTTP on one port, which is fine on your own
machine. For a real deployment, put a reverse proxy with TLS in front, set
`ALCOVES_BASE_URL` to the public URL, and set `ALCOVES_ENV=production`. The
[deployment guide](/self-hosting/deploying-alcoves/) covers reverse-proxy
settings (uploads and video streaming need a couple of specific ones), the
Helm chart for Kubernetes, and the rest of the operational details.

## Hacking on Alcoves instead?

The repository's own `docker-compose.yml` runs the **development** stack — hot
reload for both the Go backend and the SvelteKit frontend, plus seeded demo
data (sample users, libraries, photos, transcripts) so every feature has
something to show:

```sh
git clone https://github.com/rustyguts/alcoves.git
cd alcoves
docker compose up
```

Then log in at http://localhost:3000 as `test@alcoves.io` / `password123`
(the seeded owner account — the demo data means you do *not* register a first
account here).

## Next steps

- [Configuration](/getting-started/configuration/) — the environment variables that matter.
- [Deploying Alcoves](/self-hosting/deploying-alcoves/) — production setups, Helm, operations.
- [Privacy & local AI](/concepts/privacy-and-local-ai/) — what runs locally and what doesn't.
