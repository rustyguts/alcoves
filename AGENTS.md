# AGENTS.md

Repository-level instructions for coding agents working on Alcoves.

## Scope

These instructions apply to the whole repository.

## Project Facts

- Framework: Nuxt 4 + Vue 3
- UI: Nuxt UI v4 + Tailwind CSS v4
- Runtime/package manager: Bun
- API: Nitro/H3 (`server/api`)
- DB: PostgreSQL + Drizzle ORM
- Auth: session-based auth (`nuxt-auth-utils`) with optional Google OAuth
- Storage: local filesystem or S3-compatible object storage

## Working Rules

- Keep architecture consistent with existing Nuxt conventions.
- Prefer small, focused diffs over broad refactors.
- Preserve existing behavior unless the task explicitly changes it.
- Do not remove or rewrite unrelated user changes in a dirty tree.
- Never use destructive git cleanup commands unless explicitly requested.

## Important Paths

- Frontend pages/components/composables: `app/`
- Backend API routes: `server/api/`
- Backend domain/services/utils: `server/domain/`, `server/services/`, `server/utils/`
- Database schema/migrations: `server/database/`
- Shared types/constants: `shared/`
- Unit/integration tests: `test/`
- End-to-end tests: `test/e2e/`

## Build, Lint, Test

- Install: `bun install`
- Dev server: `bun run dev`
- Build: `bun run build`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format: `bun run fmt`
- Unit tests: `bun run test:unit`
- Unit coverage: `bun run test:unit:coverage`
- E2E tests: `bun run test:e2e`
- Full test pipeline: `bun run test`

## Database Workflow

- Update schema in `server/database/schema.ts`.
- Generate migrations with `bun run db:generate` when needed.
- Apply migrations with `bun run db:migrate`.
- For local schema sync, use `bun run db:push`.

## Environment

Use `.env.example` as the source of truth.
Key variables include:

- `ALCOVES_DATABASE_URL`
- `ALCOVES_SESSION_SECRET`
- `ALCOVES_STORAGE_DRIVER` and related local/S3 settings
- `NUXT_OAUTH_GOOGLE_CLIENT_ID` and `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`

## Testing Expectations

- When changing API behavior, add or update tests under `test/`.
- Prefer targeted test runs first, then broader suites.
- If tests are skipped due to environment constraints, explicitly report that.
