---
title: Configuration
description: The ALCOVES_* environment variables that configure runtime mode, database, storage, sessions, and OAuth.
---

Alcoves is configured through environment variables, prefixed with `ALCOVES_`
on the backend. This page covers the ones most installs touch;
[`.env.example`](https://github.com/rustyguts/alcoves/blob/main/.env.example)
in the repository is the complete, always-current list.

## Required

| Variable                 | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `ALCOVES_SESSION_SECRET` | Key for encrypted session cookies. **At least 32 bytes** — the API refuses to start without it. |
| `ALCOVES_DATABASE_URL`   | PostgreSQL connection string. The database needs the pgvector extension.      |

Generate a session secret with:

```sh
openssl rand -base64 48
```

:::caution
Rotating the session secret signs everyone out. Never reuse an example value
in production.
:::

## Runtime

| Variable           | Default                 | Description                                                              |
| ------------------ | ----------------------- | ------------------------------------------------------------------------ |
| `ALCOVES_MODE`     | `all`                   | `all` (API + worker), `api` (HTTP only), or `worker` (background jobs only). |
| `ALCOVES_ENV`      | `development`           | Set `production` for real deployments — `development` relaxes CORS for localhost. |
| `ALCOVES_BASE_URL` | `http://localhost:3000` | The public URL of the instance. Drives OAuth redirects, share links, and CORS. Keep it accurate. |

Splitting `api` and `worker` lets you scale the request path and the heavy
background pipeline independently — see
[deploying Alcoves](/self-hosting/deploying-alcoves/).

## Queue

| Variable                 | Default     | Description                               |
| ------------------------ | ----------- | ----------------------------------------- |
| `ALCOVES_QUEUE_HOST`     | `localhost` | Dragonfly/Redis host for background jobs. |
| `ALCOVES_QUEUE_PORT`     | `6389`      | Port (most Redis setups use `6379`).      |
| `ALCOVES_QUEUE_PASSWORD` | _(empty)_   | Optional queue password.                  |

## Storage

| Variable                      | Default        | Description                                |
| ----------------------------- | -------------- | ------------------------------------------ |
| `ALCOVES_STORAGE_DRIVER`      | `local`        | Storage backend.                           |
| `ALCOVES_STORAGE_PATH`        | `./data`       | Root path for uploaded files.              |
| `ALCOVES_AVATAR_STORAGE_PATH` | `{path}/avatars` | Override path for avatars.               |
| `ALCOVES_CACHE_STORAGE_PATH`  | `{path}/.cache`  | Override path for derived media (thumbnails, transcodes). |

:::note
`ALCOVES_S3_*` variables exist and parse, but the S3 driver is **not wired up
yet** — the server currently always uses local storage. Treat S3 as planned,
not available.
:::

## Google login (optional)

| Variable                             | Description                 |
| ------------------------------------ | --------------------------- |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_ID`     | Google OAuth client ID.     |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |

Also set `PUBLIC_GOOGLE_AUTH_ENABLED=true` on the frontend so the sign-in
button shows up (the Helm chart does this automatically).

## Frontend

The SvelteKit server reads its own variables (not `ALCOVES_`-prefixed):

| Variable                      | Default                 | Description                                                                  |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `INTERNAL_API_URL`            | `http://localhost:3001` | Where the SvelteKit server reaches the Go API for SSR and the `/api` proxy.   |
| `PUBLIC_API_ORIGIN`           | _(empty)_               | When set, browsers stream video/images/downloads and the activity WebSocket directly from the API instead of through the SvelteKit proxy. Recommended in production. |
| `FRONTEND_HOST` / `FRONTEND_PORT` | `0.0.0.0` / `3000`  | Bind address of the SvelteKit server.                                         |
| `FRONTEND_BODY_SIZE_LIMIT`    | `Infinity`              | Keep unbounded, or large upload chunks through the proxy are rejected.        |
| `PUBLIC_GOOGLE_AUTH_ENABLED`  | _(empty)_               | `true` shows the Google sign-in button.                                       |
| `PUBLIC_MAP_TILE_URL` / `PUBLIC_MAP_TILE_ATTRIBUTION` | OpenStreetMap | Point the map view at self-hosted tiles if you prefer.    |

## Optional features

| Variable                   | Default | Description                                                       |
| -------------------------- | ------- | ------------------------------------------------------------------ |
| `ALCOVES_MCP_HTTP_ENABLED` | `false` | Serve the [MCP server](/features/mcp-server/) over HTTP at `/api/mcp`. |
| `ALCOVES_MCP_OAUTH_ENABLED`| `false` | OAuth 2.1 flow for remote MCP connectors (requires the HTTP transport and an `https` base URL). |
| `ALCOVES_SENTRY_DSN`       | _(empty)_ | Backend error reporting to a Sentry instance you choose. Off unless set. |
| `ALCOVES_WHISPER_MODEL`    | `large-v3` | Boot-time default transcription model; admins can change it at runtime in the admin panel. |
