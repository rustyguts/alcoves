---
title: Configuration
description: The ALCOVES_* environment variables that configure runtime mode, database, storage, sessions, and OAuth.
---

Alcoves is configured entirely through environment variables, all prefixed with
`ALCOVES_` so they nest cleanly into container environments. Copy
[`.env.example`](https://github.com/rustyguts/alcoves/blob/main/.env.example) to
`.env` and fill in your values.

:::note[Sample doc]
This page covers the most common variables. See `.env.example` in the repo for
the complete, authoritative list.
:::

## Runtime

| Variable           | Default                 | Description                                                            |
| ------------------ | ----------------------- | ---------------------------------------------------------------------- |
| `ALCOVES_MODE`     | `all`                   | Capabilities to run: `all`, `api` (web only), or `worker` (jobs only). |
| `ALCOVES_ENV`      | `development`           | Environment name: `development` or `production`.                       |
| `ALCOVES_BASE_URL` | `http://localhost:5173` | Public base URL — used for OAuth redirects and share links.            |

Splitting `api` and `worker` lets you scale the request path and the heavy
async pipeline independently.

## Database & queue

| Variable                | Default                          | Description                                |
| ----------------------- | -------------------------------- | ------------------------------------------ |
| `ALCOVES_DATABASE_URL`  | `postgres://…@localhost:5455/…`  | PostgreSQL connection string.              |
| `ALCOVES_QUEUE_HOST`    | `localhost`                      | Dragonfly/Redis host for the Asynq queue.  |
| `ALCOVES_QUEUE_PORT`    | `6389`                           | Dragonfly/Redis port.                      |
| `ALCOVES_QUEUE_PASSWORD`| _(empty)_                        | Optional queue password.                   |

## Session

| Variable                 | Description                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| `ALCOVES_SESSION_SECRET` | AES-GCM key for encrypted session cookies. **Must be ≥ 32 bytes.**    |

Generate one with:

```sh
openssl rand -base64 32
```

:::caution
Never ship the example secret to production. Sessions are encrypted with this
key — rotating it invalidates every existing session.
:::

## Storage

| Variable                       | Default   | Description                              |
| ------------------------------ | --------- | ---------------------------------------- |
| `ALCOVES_STORAGE_DRIVER`       | `local`   | Storage backend: `local` or `s3`.        |
| `ALCOVES_STORAGE_PATH`         | `./data`  | Local blob path (when driver is `local`).|
| `ALCOVES_AVATAR_STORAGE_PATH`  | _(empty)_ | Override path for avatars.               |
| `ALCOVES_CACHE_STORAGE_PATH`   | _(empty)_ | Override path for the derived cache.     |

For S3-compatible object storage, set `ALCOVES_S3_BUCKET`, `ALCOVES_S3_REGION`,
`ALCOVES_S3_ENDPOINT`, `ALCOVES_S3_ACCESS_KEY_ID`, and
`ALCOVES_S3_SECRET_ACCESS_KEY`.

## Google OAuth (optional)

| Variable                            | Description                          |
| ----------------------------------- | ------------------------------------ |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_ID`    | Google OAuth client ID.              |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET`| Google OAuth client secret.          |

The frontend fetches available providers from the API at runtime, so OAuth
buttons appear automatically once these are set.

## Frontend

| Variable                    | Default                 | Description                                                  |
| --------------------------- | ----------------------- | ----------------------------------------------------------- |
| `ALCOVES_API_URL`           | `http://localhost:3001` | Go backend URL for the Nitro dev proxy and SSR fetches.     |
| `NITRO_HOST` / `NITRO_PORT` | `:3000`                 | Override the frontend server bind address.                  |
