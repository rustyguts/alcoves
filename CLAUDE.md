# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alcoves is a collaborative file library management application built with Nuxt 4, Vue 3, and Nuxt UI v4. The backend uses Nitro (Nuxt's server engine) with Drizzle ORM and PostgreSQL for persistent data storage. Authentication is session-based using H3 encrypted cookies.

## Commands

Package manager is **Bun**.

- `bun install` - install dependencies
- `bun run dev` - start dev server (localhost:3000)
- `bun run build` - production build
- `bun run lint` / `bun run lint:fix` - lint with OXlint
- `bun run fmt` / `bun run fmt:check` - format with OXfmt
- `bun run db:push` - push schema to database (development)
- `bun run db:generate` - generate SQL migrations
- `bun run db:migrate` - apply migrations
- `bun run db:studio` - open Drizzle Studio GUI

Pre-commit hook (Husky) runs `bun fmt && bun lint`.

No test framework is configured yet.

## Architecture

### Frontend (`app/`)

- **Framework:** Nuxt 4 with Vue 3 and Nuxt UI v4 component library
- **Routing:** File-based via `app/pages/` (Nuxt auto-routing)
- **Layout:** Single `dashboard` layout with collapsible sidebar, library navigation, and user menu
- **Validation:** Zod schemas for form validation (login, register)
- **Styling:** Tailwind CSS v4 with Nuxt UI defaults; icons use `i-lucide-*` classes
- **State:** Vue 3 reactivity (`ref`/`reactive`), `useFetch` for API calls
- **Auth:** `useAuth()` composable provides user state, login, register, logout, and profile update
- **Middleware:** Global `auth.global.ts` redirects unauthenticated users to `/login`

### Backend (`server/`)

- **API:** REST endpoints via Nitro file-based routing in `server/api/`
- **HTTP method convention:** Filename suffix determines method (e.g., `index.get.ts`, `index.post.ts`)
- **Database:** Drizzle ORM with PostgreSQL (postgres.js driver)
  - Schema: `server/database/schema.ts`
  - Connection: `server/database/index.ts`
  - Config: `drizzle.config.ts`
  - Migrations: `server/database/migrations/`
- **Auth:** Session-based via H3 `useSession` with bcryptjs password hashing
  - Helpers: `server/utils/auth.ts`
  - Middleware: `server/middleware/auth.ts` (protects `/api/*` routes, skips `/api/auth/*`)
- **Types:** Shared interfaces in `server/utils/types.ts`

### Data Model

- **Users:** email/password auth, displayName, avatarUrl, role (owner/member). First registered user is owner.
- **Libraries:** owned by a user. Each user gets a default "My Library" on registration.
- **Files:** belong to a library. Store name, mimeType, size, originalCreatedAt. File content storage is mocked.
- **LibraryMembers:** grants users access to libraries with admin/viewer roles.

### API Endpoints

| Method | Path                               | Description           |
| ------ | ---------------------------------- | --------------------- |
| POST   | `/api/auth/register`               | Register new user     |
| POST   | `/api/auth/login`                  | Login                 |
| POST   | `/api/auth/logout`                 | Logout                |
| GET    | `/api/auth/me`                     | Get current user      |
| PATCH  | `/api/auth/me`                     | Update profile        |
| GET    | `/api/libraries`                   | List user's libraries |
| POST   | `/api/libraries`                   | Create library        |
| GET    | `/api/libraries/:id`               | Get library           |
| PATCH  | `/api/libraries/:id`               | Rename library        |
| GET    | `/api/libraries/:id/files`         | List files in library |
| POST   | `/api/libraries/:id/files`         | Add file to library   |
| PATCH  | `/api/libraries/:id/files/:fileId` | Rename file           |
| DELETE | `/api/libraries/:id/files/:fileId` | Delete file(s)        |

### Docker

- Multi-stage Dockerfile: development (hot reload), build, and production stages
- `docker-compose.yml` runs the app with PostgreSQL 18
- Database URL: `ALCOVES_DATABASE_URL` env var (postgres credentials in compose)

## Environment Variables

- `ALCOVES_DATABASE_URL` - PostgreSQL connection string (default: `postgres://postgres:postgres@localhost:5432/alcoves`)
- `ALCOVES_SESSION_SECRET` - Session encryption key, min 32 chars (has dev default)

## Code Quality

- **Linter:** OXlint (Rust-based, configured in `.oxlintrc.json`)
- **Formatter:** OXfmt (100 char print width, configured in `.oxfmtrc.json`)
- No Prettier or ESLint - uses OXC toolchain exclusively

## Current State

- Auth is fully wired: register, login, logout, profile update
- Data is persistent in PostgreSQL via Drizzle ORM
- File upload creates real DB records but file content storage is mocked (metadata only)
- Library sharing via `libraryMembers` table exists in schema but sharing UI is not yet built
