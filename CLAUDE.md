# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Summary

Alcoves is a self-hosted collaborative file library built with Nuxt 4 + Vue 3.
It has:

- Nuxt UI v4 frontend (`app/`)
- Nitro/H3 API backend (`server/api/`)
- Drizzle ORM with PostgreSQL (`server/database/`)
- Session auth with optional Google OAuth (`nuxt-auth-utils`)
- Local or S3-backed file/avatar/cache storage

## Core Commands

Use Bun for all tasks:

- `bun install`
- `bun run dev`
- `bun run build`
- `bun run preview`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:fix`
- `bun run fmt`
- `bun run fmt:check`
- `bun run test`
- `bun run test:unit`
- `bun run test:unit:coverage`
- `bun run test:e2e`
- `bun run coverage:summary`
- `bun run db:generate`
- `bun run db:migrate`
- `bun run db:push`
- `bun run db:studio`

## Architecture Notes

### Frontend

- `app/pages/` defines routes.
- `app/layouts/dashboard.vue` is the primary authenticated shell.
- `app/middleware/auth.global.ts` enforces auth redirects.
- Shared UI behavior lives in `app/composables/`.
- Shared types/constants also exist in `shared/`.

### Backend

- API routes are in `server/api/**` using Nitro file routing.
- Domain logic is split into `server/domain/` and `server/services/`.
- Authentication and request checks are in `server/middleware/` and `server/utils/auth.ts`.
- Storage behavior is configured in `server/utils/storage.ts` and initialized in `server/plugins/storage.ts`.

### Data Layer

- Drizzle schema: `server/database/schema.ts`
- DB entrypoint: `server/database/index.ts`
- Migrations: `server/database/migrations/`
- Drizzle config: `drizzle.config.ts`

## Environment

Primary env vars:

- `ALCOVES_DATABASE_URL`
- `ALCOVES_SESSION_SECRET`
- `ALCOVES_STORAGE_DRIVER` (`local` or `s3`)
- `ALCOVES_STORAGE_PATH`
- `ALCOVES_AVATAR_STORAGE_PATH`
- `ALCOVES_CACHE_STORAGE_PATH`
- `ALCOVES_S3_BUCKET`
- `ALCOVES_S3_REGION`
- `ALCOVES_S3_ENDPOINT`
- `ALCOVES_S3_ACCESS_KEY_ID`
- `ALCOVES_S3_SECRET_ACCESS_KEY`
- `ALCOVES_S3_FORCE_PATH_STYLE`
- `ALCOVES_S3_FILES_PREFIX`
- `ALCOVES_S3_AVATARS_PREFIX`
- `ALCOVES_S3_CACHE_PREFIX`
- `NUXT_OAUTH_GOOGLE_CLIENT_ID`
- `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`

See `.env.example` for full details and defaults.

## Engineering Guardrails

- Keep changes scoped and consistent with existing Nuxt/Nitro patterns.
- Do not switch package manager or lint/format stack.
- Prefer adding/adjusting tests when behavior changes.
- Run targeted tests first, then broader suites when needed.
- Avoid destructive git commands and do not revert unrelated local changes.
