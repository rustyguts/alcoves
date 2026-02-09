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
- **File management** &mdash; Upload, rename, organize, soft-delete, and restore files.
- **User accounts** &mdash; Built-in registration and authentication with role-based access control.
- **Modern UI** &mdash; Clean, responsive dashboard with collapsible sidebar and dark mode support.
- **Docker-ready** &mdash; Single `docker compose` command to get up and running.

## Tech Stack

| Layer      | Technology                                              |
| ---------- | ------------------------------------------------------- |
| Framework  | [Nuxt 4](https://nuxt.com) + Vue 3                      |
| UI         | [Nuxt UI v4](https://ui.nuxt.com) + Tailwind CSS v4     |
| Database   | PostgreSQL 18 + [Drizzle ORM](https://orm.drizzle.team) |
| Runtime    | [Bun](https://bun.sh)                                   |
| Auth       | Session-based (encrypted cookies)                       |
| Deployment | Docker / Docker Compose                                 |

## Quick Start

### Using Docker Compose (Recommended)

The fastest way to run Alcoves is with Docker Compose, which starts both the app and a PostgreSQL database.

**1. Clone the repository**

```bash
git clone https://github.com/rustyguts/alcoves.git
cd alcoves
```

**2. Start the services**

```bash
docker compose up -d
```

**3. Open the app**

Navigate to [http://localhost:3000](http://localhost:3000) and register your first account. The first user to register is automatically granted the **owner** role.

### Using the Container Image

If you already have a PostgreSQL instance, you can run the Alcoves container directly.

```bash
docker run -d \
  --name alcoves \
  -p 3000:3000 \
  -e ALCOVES_DATABASE_URL="postgres://user:password@your-db-host:5432/alcoves" \
  -e ALCOVES_SESSION_SECRET="your-secret-key-at-least-32-characters-long" \
  -v alcoves_data:/app/data \
  ghcr.io/rustyguts/alcoves:latest
```

Then open [http://localhost:3000](http://localhost:3000).

### Docker Compose (Production)

For production deployments, create a `docker-compose.prod.yml`:

```yaml
services:
  app:
    image: ghcr.io/rustyguts/alcoves:latest
    environment:
      - ALCOVES_DATABASE_URL=postgres://postgres:change-me@postgres:5432/alcoves?sslmode=disable
      - ALCOVES_SESSION_SECRET=change-me-to-a-random-string-at-least-32-chars
    volumes:
      - alcoves_data:/app/data
    ports:
      - 3000:3000
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:18
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

volumes:
  alcoves_data:
  postgres_data:
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Configuration

Alcoves is configured via environment variables:

| Variable                      | Description                                | Default                                               |
| ----------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `ALCOVES_DATABASE_URL`        | PostgreSQL connection string               | `postgres://postgres:postgres@localhost:5432/alcoves` |
| `ALCOVES_SESSION_SECRET`      | Encryption key for sessions (min 32 chars) | Dev default (insecure)                                |
| `ALCOVES_STORAGE_DRIVER`      | Storage backend driver (`local` or `s3`)   | `local`                                               |
| `ALCOVES_STORAGE_PATH`        | Directory for uploaded file storage        | `./data`                                              |
| `ALCOVES_AVATAR_STORAGE_PATH` | Optional avatar storage override           | `{ALCOVES_STORAGE_PATH}/avatars`                      |
| `ALCOVES_CACHE_STORAGE_PATH`  | Optional proxy cache storage override      | `{ALCOVES_STORAGE_PATH}/.cache`                       |

> **Important:** Always set `ALCOVES_SESSION_SECRET` to a unique, random value in production.
>
> If `ALCOVES_STORAGE_DRIVER=s3`, configure `ALCOVES_S3_BUCKET`, `ALCOVES_S3_REGION`, and S3 credentials variables from `.env.example`.

### Storage Backend Selection

- Local storage (default): set `ALCOVES_STORAGE_DRIVER=local` and optionally tune local paths.
- S3 storage: set `ALCOVES_STORAGE_DRIVER=s3` and provide S3 settings below.

| S3 Variable                    | Description                                                                | Default                  |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------ |
| `ALCOVES_S3_BUCKET`            | S3 bucket for files/avatars/cache objects                                  | none (required for `s3`) |
| `ALCOVES_S3_REGION`            | AWS region (or S3-compatible region)                                       | none (required for `s3`) |
| `ALCOVES_S3_ENDPOINT`          | Optional custom endpoint for S3-compatible providers                       | empty                    |
| `ALCOVES_S3_ACCESS_KEY_ID`     | Optional static access key ID (otherwise use runtime IAM/role credentials) | empty                    |
| `ALCOVES_S3_SECRET_ACCESS_KEY` | Optional static secret access key                                          | empty                    |
| `ALCOVES_S3_FORCE_PATH_STYLE`  | Use path-style URLs for compatibility (e.g. MinIO)                         | `false`                  |
| `ALCOVES_S3_FILES_PREFIX`      | Object prefix for uploaded files                                           | `files`                  |
| `ALCOVES_S3_AVATARS_PREFIX`    | Object prefix for avatars                                                  | `avatars`                |
| `ALCOVES_S3_CACHE_PREFIX`      | Object prefix for transformed media cache                                  | `cache`                  |

## Development

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Docker](https://www.docker.com/) (for PostgreSQL)

### Setup

```bash
# Clone the repo
git clone https://github.com/rustyguts/alcoves.git
cd alcoves

# Install dependencies
bun install

# Start PostgreSQL
docker compose up postgres -d

# Push the database schema
bun run db:push

# Start the dev server
bun run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Available Scripts

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `bun run dev`         | Start development server with hot reload |
| `bun run build`       | Create production build                  |
| `bun run lint`        | Run linter (OXlint)                      |
| `bun run fmt`         | Format code (OXfmt)                      |
| `bun run db:push`     | Push schema changes to database          |
| `bun run db:generate` | Generate SQL migration files             |
| `bun run db:migrate`  | Apply pending migrations                 |
| `bun run db:studio`   | Open Drizzle Studio database GUI         |

## Project Structure

```
alcoves/
├── app/                    # Frontend (Nuxt/Vue)
│   ├── components/         # Vue components
│   ├── composables/        # Shared composables (useAuth, etc.)
│   ├── layouts/            # Page layouts
│   ├── middleware/          # Route middleware
│   └── pages/              # File-based routing
├── server/                 # Backend (Nitro)
│   ├── api/                # REST API endpoints
│   ├── database/           # Drizzle schema & migrations
│   ├── middleware/          # Server middleware (auth)
│   └── utils/              # Shared server utilities
├── docker-compose.yml      # Development compose file
├── Dockerfile              # Multi-stage Docker build
└── drizzle.config.ts       # Drizzle ORM configuration
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

Built with [Nuxt](https://nuxt.com), [Nuxt UI](https://ui.nuxt.com), [Drizzle ORM](https://orm.drizzle.team), [Bun](https://bun.sh), and [PostgreSQL](https://www.postgresql.org).
