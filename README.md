<p align="center">
  <h1 align="center">Alcoves</h1>
  <p align="center">
    A self-hosted, collaborative file library. Own your data.
  </p>
  <p align="center">
    <a href="https://github.com/rustyguts/alcoves/issues">Report Bug</a>
    &middot;
    <a href="https://github.com/rustyguts/alcoves/issues">Request Feature</a>
  </p>
</p>

---

Alcoves is an open-source, self-hosted alternative to Google Drive. It gives you full control over your files and data while providing a clean, modern interface for organizing, sharing, and managing documents with your team.

No vendor lock-in. No subscriptions. Just your files, on your server.

## Features

- **Self-hosted** &mdash; Run it on your own hardware or VPS. Your data never leaves your infrastructure.
- **Collaborative libraries** &mdash; Create shared libraries and invite team members as admins or viewers.
- **File management** &mdash; Upload, rename, organize folders, soft-delete, and restore files.
- **Resumable uploads** &mdash; Large file uploads use the TUS protocol so uploads survive network interruptions.
- **Image & video proxy** &mdash; On-the-fly image transforms and video transcoding with Redis-backed caching.
- **AI-powered search** &mdash; Automatic face detection and object recognition via ONNX Runtime.
- **User accounts** &mdash; Built-in registration and authentication with session-based encrypted cookies.
- **OAuth** &mdash; Sign in with Google (optional).
- **Modern UI** &mdash; Clean, responsive dashboard with dark mode support.
- **Docker-ready** &mdash; Single `docker compose` command to get up and running.

## Tech Stack

| Layer         | Technology                                                    |
| ------------- | ------------------------------------------------------------- |
| Backend       | [Go](https://go.dev) + [Echo](https://echo.labstack.com)      |
| ORM           | [GORM](https://gorm.io) + PostgreSQL 18 (pgvector)            |
| Migrations    | [Goose](https://github.com/pressly/goose)                     |
| Job Queue     | [Asynq](https://github.com/hibiken/asynq) + Dragonfly (Redis) |
| Image         | [govips](https://github.com/davidbyttow/govips) (libvips)     |
| AI            | [ONNX Runtime](https://onnxruntime.ai) — face & object detect |
| Frontend      | Vue 3 + Vite SPA                                              |
| UI            | [Nuxt UI v4](https://ui.nuxt.com) + Tailwind CSS v4 + DaisyUI |
| Auth          | Session-based (AES-GCM encrypted cookies)                     |
| Uploads       | [TUS](https://tus.io) resumable upload protocol               |
| Deployment    | Docker / Docker Compose                                       |

## Quick Start

### Using Docker Compose (Recommended)

The fastest way to run Alcoves is with Docker Compose, which starts the Go backend, PostgreSQL, and Dragonfly.

**1. Clone the repository**

```bash
git clone https://github.com/rustyguts/alcoves.git
cd alcoves
```

**2. Configure environment**

```bash
cp .env.example .env
# Edit .env and set ALCOVES_SESSION_SECRET to a random 32+ character string
```

**3. Start the services**

```bash
docker compose up -d
```

**4. Open the app**

Navigate to [http://localhost:3001](http://localhost:3001) and register your first account. The first user to register is automatically granted the **owner** role.

### Using the Container Image

If you already have a PostgreSQL and Dragonfly (Redis) instance, you can run the Alcoves container directly.

```bash
docker run -d \
  --name alcoves \
  -p 3001:3001 \
  -e ALCOVES_DATABASE_URL="postgres://user:password@your-db-host:5432/alcoves?sslmode=disable" \
  -e ALCOVES_SESSION_SECRET="your-secret-key-at-least-32-characters-long" \
  -e ALCOVES_QUEUE_HOST="your-redis-host" \
  -v alcoves_data:/app/data \
  ghcr.io/rustyguts/alcoves:latest
```

Then open [http://localhost:3001](http://localhost:3001).

### Docker Compose (Production)

For production deployments, create a `docker-compose.prod.yml`:

```yaml
services:
  app:
    image: ghcr.io/rustyguts/alcoves:latest
    environment:
      - ALCOVES_DATABASE_URL=postgres://postgres:change-me@postgres:5432/alcoves?sslmode=disable
      - ALCOVES_SESSION_SECRET=change-me-to-a-random-string-at-least-32-chars
      - ALCOVES_QUEUE_HOST=dragonfly
    volumes:
      - alcoves_data:/app/data
    ports:
      - 3001:3001
    depends_on:
      postgres:
        condition: service_healthy
      dragonfly:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: pgvector/pgvector:pg18
    environment:
      - POSTGRES_DB=alcoves
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=change-me
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly:latest
    command: ["dragonfly", "--default_lua_flags=allow-undeclared-keys"]
    restart: unless-stopped

volumes:
  alcoves_data:
  postgres_data:
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Configuration

Alcoves is configured via environment variables:

| Variable                      | Description                                | Default                                                          |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `ALCOVES_MODE`                | Runtime mode: `all`, `api`, or `worker`    | `all`                                                            |
| `ALCOVES_DATABASE_URL`        | PostgreSQL connection string               | `postgres://postgres:postgres@localhost:5432/alcoves?sslmode=disable` |
| `ALCOVES_SESSION_SECRET`      | AES-GCM key for sessions (min 32 chars)    | Dev default (insecure)                                           |
| `ALCOVES_STORAGE_DRIVER`      | Storage backend driver (`local` or `s3`)   | `local`                                                          |
| `ALCOVES_STORAGE_PATH`        | Directory for uploaded file storage        | `./data`                                                         |
| `ALCOVES_AVATAR_STORAGE_PATH` | Optional avatar storage override           | `{ALCOVES_STORAGE_PATH}/avatars`                                 |
| `ALCOVES_CACHE_STORAGE_PATH`  | Optional proxy cache storage override      | `{ALCOVES_STORAGE_PATH}/.cache`                                  |
| `ALCOVES_QUEUE_HOST`          | Dragonfly/Redis host                       | `localhost`                                                      |
| `ALCOVES_QUEUE_PORT`          | Dragonfly/Redis port                       | `6379`                                                           |
| `ALCOVES_BASE_URL`            | Public-facing URL (required for OAuth)     | —                                                                |

> **Important:** Always set `ALCOVES_SESSION_SECRET` to a unique, random value in production.

### OAuth (Google)

To enable Google sign-in, set:

- `ALCOVES_OAUTH_GOOGLE_CLIENT_ID`
- `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET`
- `ALCOVES_BASE_URL` (used as the OAuth redirect base)

### Storage Backend Selection

- **Local storage** (default): set `ALCOVES_STORAGE_DRIVER=local` and optionally tune local paths.
- **S3 storage**: set `ALCOVES_STORAGE_DRIVER=s3` and provide S3 settings below.

| S3 Variable                    | Description                                                                | Default                  |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------ |
| `ALCOVES_S3_BUCKET`            | S3 bucket for files/avatars/cache objects                                  | none (required for `s3`) |
| `ALCOVES_S3_REGION`            | AWS region (or S3-compatible region)                                       | none (required for `s3`) |
| `ALCOVES_S3_ENDPOINT`          | Optional custom endpoint for S3-compatible providers (e.g. MinIO)          | empty                    |
| `ALCOVES_S3_ACCESS_KEY_ID`     | Optional static access key ID (otherwise use runtime IAM/role credentials) | empty                    |
| `ALCOVES_S3_SECRET_ACCESS_KEY` | Optional static secret access key                                          | empty                    |
| `ALCOVES_S3_FORCE_PATH_STYLE`  | Use path-style URLs for compatibility (e.g. MinIO)                         | `false`                  |
| `ALCOVES_S3_FILES_PREFIX`      | Object prefix for uploaded files                                           | `files`                  |
| `ALCOVES_S3_AVATARS_PREFIX`    | Object prefix for avatars                                                  | `avatars`                |
| `ALCOVES_S3_CACHE_PREFIX`      | Object prefix for transformed media cache                                  | `cache`                  |

See `.env.example` for the full list and defaults.

## Development

### Prerequisites

- [Go](https://go.dev) (1.21+)
- [Bun](https://bun.sh) (for the frontend)
- [Docker](https://www.docker.com/) (for PostgreSQL + Dragonfly)

### Setup

```bash
# Clone the repo
git clone https://github.com/rustyguts/alcoves.git
cd alcoves

# Start infrastructure (Postgres + Dragonfly)
docker compose up -d postgres dragonfly

# Start the Go backend (port 3001)
cd backend
go run cmd/server/main.go

# In a second terminal — start the frontend dev server (port 5173)
cd frontend
bun install
bun run dev
```

The frontend dev server proxies `/api/*` to the Go backend and is available at [http://localhost:5173](http://localhost:5173).

Alternatively, start everything with Docker Compose (including Air hot-reload for the backend):

```bash
docker compose up
# Add --profile frontend to also start the Vite dev server in Docker
docker compose --profile frontend up
```

### Backend Commands

Run from the `backend/` directory:

| Command                                    | Description                        |
| ------------------------------------------ | ---------------------------------- |
| `go run cmd/server/main.go`                | Start the API server               |
| `go build -o bin/alcoves cmd/server/main.go` | Build production binary          |
| `go test ./...`                            | Run all backend tests              |
| `go test ./internal/handlers/... -v`       | Run handler tests verbosely        |

### Frontend Commands

Run from the `frontend/` directory:

| Command                    | Description                             |
| -------------------------- | --------------------------------------- |
| `bun run dev`              | Start Vite dev server with hot reload   |
| `bun run build`            | Create production build                 |
| `bun run typecheck`        | TypeScript type checking                |
| `bun run lint`             | Run linter (OXlint)                     |
| `bun run fmt`              | Format code (OXfmt)                     |
| `bun run test:unit`        | Run unit tests (Vitest)                 |
| `bun run test:e2e`         | Run end-to-end tests (Playwright)       |

## Project Structure

```
alcoves/
├── backend/                    # Go API server
│   ├── cmd/server/             # Entry point (main.go)
│   ├── internal/
│   │   ├── handlers/           # HTTP request handlers
│   │   ├── middleware/         # Auth & access-control middleware
│   │   ├── models/             # GORM entity definitions
│   │   ├── services/           # Business logic (auth, storage, image/video proxy, AI)
│   │   └── spa/                # Embeds compiled frontend for single-binary deploy
│   └── migrations/             # Goose SQL migrations
├── frontend/                   # Vue 3 + Vite SPA
│   ├── app/
│   │   ├── components/         # Vue components
│   │   ├── composables/        # Shared composables (useAuth, useApiFetch, etc.)
│   │   ├── layouts/            # Page layouts
│   │   ├── pages/              # File-based routing
│   │   └── utils/              # Shared utilities
│   ├── shared/types/           # API response type definitions
│   └── test/                   # Unit (Vitest) + E2E (Playwright) tests
├── docker-compose.yml          # Development environment
└── Dockerfile                  # Multi-stage Docker build
```

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests, all input is appreciated.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source. See the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with [Go](https://go.dev), [Echo](https://echo.labstack.com), [GORM](https://gorm.io), [Vue 3](https://vuejs.org), [Vite](https://vitejs.dev), [Nuxt UI](https://ui.nuxt.com), [Tailwind CSS](https://tailwindcss.com), [Asynq](https://github.com/hibiken/asynq), and [PostgreSQL](https://www.postgresql.org).
