---
title: "Frontend architecture (SvelteKit)"
description: "How the Alcoves SvelteKit frontend is structured: SSR topology, route groups, auth via hooks, the createApi client and in-process /api proxy, Svelte 5 rune stores, shadcn-svelte, testing, and adapter-node deployment."
---

The Alcoves frontend is a **SvelteKit** (Svelte 5) application living in `client/`, built on **shadcn-svelte** (the Svelte 5 port of shadcn/ui, on top of **bits-ui**) + **Tailwind 4** and run under **Bun**. The Go backend is a pure API — it does not embed or serve frontend assets. The SvelteKit server reaches the co-located Go API through an in-process proxy and server-side `load` functions; it never touches the database directly.

| Process | Default port |
|---|---|
| SvelteKit (adapter-node, run under Bun) | 3000 |
| Go API (backend) | 3001 |

This document is aimed at contributors. Read it before working in `client/src/`.

---

## SSR topology

Unlike the previous client-render-everything Nuxt app, this frontend uses **SvelteKit's default: server-render + hydrate**. Every page renders on the server first, then hydrates in the browser. Server `load` functions and `hooks.server.ts` fetch the Go API (never the DB), so the initial HTML is populated with real data and the public share page (`/s/:token`) emits correct Open Graph / Twitter meta for social crawlers.

There is no global `ssr: false` override and no per-route opt-out — SSR is the topology, not the exception. The unit that historically required SSR (the share page) is just a normal SSR page among many.

### Route structure

Routes follow the standard SvelteKit `src/routes` filesystem layout. The app is organised with **route groups** — parenthesised directories that share a layout without adding a URL segment:

| Path | Group / kind | Purpose |
|---|---|---|
| `(app)/` | Authed group | Everything behind login: dashboard, libraries, search, notifications, profile, admin |
| `(app)/libraries/[id]/…` | Authed | Library browser + per-tab pages (`feed`, `map`, `objects`, `people`, `tags`, `timeline`, `settings`, `trash`, `edit/[fileId]`) |
| `(app)/admin`, `(app)/admin/jobs` | Authed, owner-gated | Admin stats/settings + the Asynq job dashboard |
| `login/`, `register/` | Public | Auth entry points |
| `invites/[token]/` | Public | Invite-link landing/acceptance |
| `s/[token]/` | Public, SSR-for-OG | Moment share landing — server `load` fetches share metadata for crawlers |
| `api/[...path]/` | Server endpoint | In-process catch-all proxy to the Go API (below) |

The `(app)` group exists so a single `+layout.server.ts` can guard the entire authenticated surface in one place (see [Auth](#auth-via-hooksserverts)), and a single `+layout.svelte` can render the dashboard shell (sidebar, header, search, notification bell, user menu). Public pages sit outside the group so they render without that guard or shell.

`(app)/libraries/[id]/+layout.svelte` nests inside the dashboard shell automatically and adds the library header + tabs. Child tab pages read `data.library` from the subtree's server load and `page.params.id` directly — there is no Vue-style `provide`/`inject` for `libraryId`. The video editor (`edit/[fileId]`) breaks out of the library layout with a `+page@(app).svelte` layout reset so it gets full viewport width.

:::note[Library page toolbars use a portal action]
Library tab pages render their toolbar with `use:portal={'#library-header-actions'}` (`src/lib/actions/portal.ts`) to move it up into the shared library-header breadcrumb row — the SvelteKit equivalent of the old `<Teleport>`.
:::

---

## Auth via `hooks.server.ts`

Authentication is resolved server-side, once per request, in `src/hooks.server.ts`.

### `handle` — session resolution

The `handle` hook populates `event.locals.user`:

- For app navigations it calls `resolveUser()`, which forwards the request's `cookie` header to the Go API's `GET /api/_auth/session` (an endpoint that never `401`s — it returns `{ user: … | null }`). The result is set on `locals.user`.
- If there is no cookie, the round trip is skipped (anonymous).
- A backend hiccup is swallowed and treated as anonymous — **a flaky API must not turn every page into a 500**.
- For `/api/*` requests `locals.user` is left `null`; the proxy forwards the raw cookie itself, so resolving the session there would be wasted work.

The root `+layout.server.ts` exposes `locals.user` to every page as `data.user`. The **authed-area guard** lives in `(app)/+layout.server.ts`: it throws `redirect(302, '/login?redirect=…')` when `locals.user` is null, then loads the libraries list the sidebar renders (degrading to an empty list on failure rather than failing the shell). `(app)/admin/+layout.server.ts` adds the **owner-only** guard (`locals.user?.role !== 'owner'` → redirect to `/`).

### `handleFetch` — cookie + host rewrite for server `load`

The `handleFetch` hook intercepts `fetch` calls made inside server `load`/actions. When a same-origin `/api/*` URL is requested:

- it rewrites the target to `INTERNAL_API_URL` (the co-located Go API);
- it forwards the session `cookie`;
- it forwards `X-Forwarded-Host` and `X-Forwarded-Proto`. The proto/host are **load-bearing for share pages** — the backend's `share.go` builds absolute OG/share URLs from the forwarded host, so they must match the public origin.

This is why a server `load` can write `await fetch('/api/share/…')` with a relative path and have it transparently reach the backend with auth attached.

---

## API client and transport

### `createApi(fetch)`

`src/lib/api/client.ts` exports a `createApi(fetchImpl)` **factory** that returns a typed `api` object composed of **15 namespaced sub-objects**. Every method wraps the underlying `apiFetch`/`apiUrl`. This is the only place route paths are written — code calls `api.files.list(...)` rather than hand-writing URLs.

The factory pattern is what makes the client isomorphic:

- **Server `load`/actions** call `createApi(event.fetch)` so SvelteKit's `event.fetch` + `handleFetch` rewrite the relative `/api/*` path to the Go API and forward the cookie.
- **Browser code** (components, rune stores) imports the `api` singleton from `$lib/api`, which is `createApi((i, init) => fetch(i, init))` bound to the global `fetch`.

| Namespace | Covers |
|---|---|
| `api.auth` | Session, login, register, logout, profile, avatar, active sessions, OAuth providers |
| `api.libraries` | Library CRUD |
| `api.files` | File CRUD, playback sources, image/video proxy, transcription, waveform, audio event detection |
| `api.folders` | Folder CRUD, move, trash, restore, purge |
| `api.tags` | Tag CRUD, bulk sync |
| `api.highlightFilters` | Highlight filter CRUD |
| `api.members` | Library members and invite links |
| `api.people` | Face-recognition people, merge, thumbnail URL builder |
| `api.objects` | Object-detection labels, reprocess |
| `api.downloads` | ZIP download size estimate |
| `api.search` | Cross-library search |
| `api.invites` | Invite lookup and acceptance |
| `api.admin` | Admin stats, settings, user management, job control |
| `api.moments` | Moment CRUD, sharing, export, download URL builder |
| `api.meta` | Public metadata (registration mode) |

### `apiFetch` and `ApiError`

`src/lib/api/fetch.ts` builds the `apiFetch` bound to a `fetch` implementation. It appends query params (dropping `undefined`/`null`), sends JSON bodies (skipping `Content-Type` for `FormData` so the multipart boundary is browser-set), supports `json` / `blob` / `text` response types (an empty body parses to `null`), and throws `ApiError(status, data)` on any non-OK response. `ApiError` carries `status: number` and `data`, with the message resolved from `data.message` → `data.statusMessage` → a generic fallback.

Cookie forwarding is **intentionally not** in `apiFetch`: on the server it lives in `handleFetch`; in the browser the cookie rides along automatically (same-origin) or via `credentials: 'include'` (cross-origin, when `PUBLIC_API_ORIGIN` is set).

### The in-process `/api` proxy

`src/routes/api/[...path]/+server.ts` is a catch-all SvelteKit endpoint exporting every HTTP verb. It streams the request to `INTERNAL_API_URL/api/<path>` and streams the response back, preserving the unified single-origin topology so a same-origin `/api/*` call (cookie auto-sent) reaches the Go API. It is deliberately byte-faithful:

- **Streams bodies both ways** — `duplex: 'half'` is set for request bodies so undici/Bun can stream TUS `PATCH` chunks.
- **Passes status/headers through verbatim**, so **Range/`206`, ETag, TUS, and `Set-Cookie`** all work.
- Strips hop-by-hop headers, and drops `content-encoding`/`content-length` on the way back because `fetch` transparently decodes the upstream body.

### `PUBLIC_API_ORIGIN` bypass

`src/lib/api/url.ts` decides per-request whether the browser talks to the proxy or directly to the Go API:

- `apiUrl(path)` builds **browser-facing asset/stream URLs** (`<img>`/`<video>` `src`, downloads, thumbnails). When `PUBLIC_API_ORIGIN` is set it returns a direct-to-Go absolute URL (avoiding Range mangling through the proxy); otherwise a same-origin relative path through the `/api` proxy.
- `dataRequestUrl(path)` resolves **JSON data fetches**: relative on the server (so `handleFetch` rewrites it), and on the browser the same proxy-vs-direct choice.
- `clientUsesCrossOrigin()` flips `credentials` to `'include'` when the browser is crossing the API origin.

So **binary streaming and the activity WebSocket bypass the proxy** when `PUBLIC_API_ORIGIN` is set, hitting the Go API directly. In the single-port unified (`all`-role) deployment where no separate API origin is exposed, the activity WebSocket can't upgrade through the single SvelteKit port; the notifications socket **degrades to its poll-fallback**. Real-time WS works when reaching the API directly — via a Kubernetes ingress that routes `/api/ws` to the API service, or by setting `PUBLIC_API_ORIGIN`.

---

## Svelte 5 rune stores (`$lib/state`)

The Vue composables (`useLibraryExplorer`, `useUploadQueue`, `useNotifications`, …) are replaced by **Svelte 5 rune stores** under `src/lib/state/`. Stateful stores are `.svelte.ts` files (so the compiler enables runes), exporting a single module-level instance whose reactive fields use `$state`/`$derived` and are exposed through getters so reactivity survives the module boundary. Consumers import the singleton and drive it from `onMount`/`onDestroy`; the stores themselves avoid `$effect`/lifecycle hooks.

Representative stores: `auth`, `theme`, `toast`, `libraries-list`, `library-explorer`, `library-timeline`/`-map`/`-feed`/`-members`/`-people`/`-tags`/`-moments`/`-folder-path`/`-folder-actions`, `upload-queue` (TUS), `notifications` + `notifications-socket`, `transcript`/`transcribe-job`, `audio-detections`/`audio-detect-job`, `waveform`/`waveform-job`/`waveform-renderer`, `highlight-filters`, `editor-highlights`/`editor-shortcuts`, `download-zip`, `moment-downloads`, `async-job-status`, `file-drop`. Pure non-reactive helpers (e.g. `async-job-status.ts`, `editor-shortcuts.ts`, `toast.ts`) keep a plain `.ts` extension.

:::note[Reactive collections]
Rune stores reassign a fresh `Set`/`Map` to a `$state` field on each change (which *is* reactive) rather than mutating in place. The `svelte/prefer-svelte-reactivity` lint rule can't distinguish that from a real bug, so it's disabled in `eslint.config.js`; reactivity correctness is covered by tests instead.
:::

---

## Styling, theme, and icons

- **Tailwind 4 + shadcn-svelte**, configured **CSS-first** in `src/app.css` (`@import 'tailwindcss'` + `@import 'tw-animate-css'`, plus a zinc-neutral `:root`/`.dark` design-token block — `--background`, `--foreground`, `--primary`, `--border`, etc. — feeding Tailwind's `@theme inline`). There is **no `tailwind.config`** — Tailwind is wired through `@tailwindcss/vite`. shadcn-svelte's components (built on **bits-ui** primitives) are vendored, not npm-installed: each lives under `src/lib/components/ui/<name>/` (e.g. `ui/button/`, `ui/dialog/`, `ui/sidebar/`) so the project owns and can theme the source directly.
- **Class-based dark mode.** `app.css` redefines the dark variant with `@custom-variant dark (&:where(.dark, .dark *))`, so light/dark is driven by a `.dark` class on `<html>` toggled by a persisted preference (`theme.svelte.ts`, key `alcoves.theme`), not by `prefers-color-scheme` alone. `app.html` applies the persisted scheme **before first paint** to avoid a flash of the wrong theme.
- **Offline icons.** App-level icons use `@iconify/svelte` rendered via `AppIcon.svelte`, which calls `addCollection(@iconify-json/lineicons)` in a `module` block so the Lineicons set is **bundled and rendered fully offline** — no requests to the Iconify API (privacy-first, per the project vision). `src/lib/utils/icons.ts` is the single registry: keys are *semantic UI roles*, values are `lineicons:<glyph>` strings, all validated against the installed set by `icons.test.ts`. `@lucide/svelte` is used only inside the vendored shadcn-svelte primitives (also offline/tree-shaken), never elsewhere.
- **Toasts and the sidebar shell.** Toasts render through **svelte-sonner** (`ui/sonner/`), mounted once in the root layout and driven from application code via `$lib/state/toast` — call sites never touch `svelte-sonner` directly. The authed dashboard shell is shadcn's `Sidebar` composition (`Sidebar.Provider`/`Sidebar.Root`/`Sidebar.Inset` etc., in `ui/sidebar/`), which folds to a `Sheet`-based drawer on mobile.

### Pre-hydration form guard

`app.html` installs an inline capturing `submit` listener that calls `e.preventDefault()` while `window.__alcovesReady` is falsy. The root `+layout.svelte` sets `__alcovesReady = true` and releases the guard in `onMount`. This closes the SSR→hydration window in which a native `<form>` POST could fire before the app is interactive. E2E tests read `window.__alcovesReady` to know the app is interactive before asserting.

:::caution[Tooling deviates from the repo OX stack]
OXlint/OXfmt can't parse `.svelte`, so the client uses **svelte-check** (typecheck), **Prettier + `prettier-plugin-svelte` + `-tailwindcss`** (format), and **ESLint flat config + `eslint-plugin-svelte` + `typescript-eslint`** (lint). Bun remains the package manager and runtime. Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `fmt`, `test:unit`, `test:unit:coverage`, `coverage:floor`, `test:e2e`.
:::

---

## Testing strategy

### Unit tests — Vitest dual projects

`vite.config.ts` defines two Vitest **projects** so each test runs in the right environment:

| Project | Environment | Files | Covers |
|---|---|---|---|
| `server` | `node` | `src/**/*.{test,spec}.ts` | Pure logic, hooks, `load` functions, the `/api` proxy, the API client |
| `client` | browser (`vitest-browser-svelte` + Playwright chromium, headless) | `src/**/*.svelte.{test,spec}.ts` | Components and DOM-touching rune stores |

There are ~2,100 unit tests. Coverage is v8 with global thresholds of **90%** lines/functions/statements and **80%** branches; `scripts/coverage-floor.mjs` enforces the complementary per-file rule that **no file is below 60%**. A short coverage-exclude list covers files the unit harness can't meaningfully exercise — `LibraryMap.svelte` and `VideoEditorPlayer.svelte` (thin wrappers around browser-only libs whose `onMount` dynamic imports can't run in unit tests), the two trivial `libraries/[id]` `+page.svelte` passthroughs, and the **vendored shadcn-svelte primitives** under `src/lib/components/ui/*/**` (upstream-maintained, exercised via the composites and pages built on top of them plus e2e, not hand-written) — all exercised by the full-stack e2e or their composites instead.

:::note[Route tests must not use `+`-prefixed filenames]
SvelteKit treats `+page`/`+layout`/`+server` files as routes, so test files alongside them are named `page.svelte.test.ts`, `layout.server.test.ts`, etc. — never `+page.test.ts`.
:::

### E2E — real-stack Playwright

`client/playwright.config.ts` runs `client/test/e2e/*.e2e.ts` against a **real, running, full stack** — Postgres + Dragonfly + the Go API/worker (seeded) behind the SvelteKit server. There is **no mock backend**.

```bash
docker compose up        # brings up postgres + dragonfly + Go API/worker (seeded) + SvelteKit
bun run test:e2e         # Playwright against http://localhost:3000 (or E2E_BASE_URL)
```

Seed login: **`test@alcoves.io` / `password123`** (see `backend/internal/seed`). Tests run sequentially (`workers: 1`).

---

## Deployment (adapter-node)

The client builds with **`@sveltejs/adapter-node`** (`svelte.config.js`) to `build/` and is run under Bun (`bun /app/build/index.js`).

### `envPrefix` — avoiding a PORT collision

The adapter is configured with `envPrefix: 'FRONTEND_'`. In the unified single-image `all` role the SvelteKit server and the Go API run side by side, and the Go API owns the unprefixed `PORT`. Prefixing means the SvelteKit server reads `FRONTEND_HOST` / `FRONTEND_PORT` / `FRONTEND_ORIGIN` / `FRONTEND_BODY_SIZE_LIMIT` (and `FRONTEND_PROTOCOL_HEADER` / `FRONTEND_HOST_HEADER`) without colliding with the Go process.

| Variable | Purpose |
|---|---|
| `INTERNAL_API_URL` | Co-located Go API base for server `load` + the `/api` proxy target (default `http://localhost:3001`; `http://127.0.0.1:3001` in the unified image) |
| `PUBLIC_API_ORIGIN` | Public API origin for direct browser binary streaming + the activity WS; empty → everything same-origin through the proxy |
| `FRONTEND_HOST` / `FRONTEND_PORT` | adapter-node bind address (`0.0.0.0` / `3000`) |
| `FRONTEND_PROTOCOL_HEADER` / `FRONTEND_HOST_HEADER` | `x-forwarded-proto` / `x-forwarded-host` — let adapter-node derive the request origin from the ingress |
| `FRONTEND_BODY_SIZE_LIMIT` | Must be `Infinity` or TUS chunk `PATCH` bodies streamed through the `/api` proxy are rejected |

### Build pipeline

The root `Dockerfile` builds the client in stage 3 (`oven/bun:1`): `bun run build` emits `build/`, then prod deps are **pruned** to a lean `node_modules` (vite/eslint/playwright dropped, but adapter-node's runtime deps kept since the server imports from `build/`). Stage 4 copies `build/` + the pruned `node_modules` + `package.json` into the runtime image. `docker/entrypoint.sh` runs `bun /app/build/index.js` for the `web` and `all` roles; in `all` it supervises that alongside the Go binary and exits non-zero if either child dies.

Dev uses the docker-compose `frontend` service built from `client/Dockerfile.dev` (Vite dev server on :3000 with HMR, `INTERNAL_API_URL=http://backend:3001`).

The Helm chart's `frontend` Deployment runs the one image with `args: ["web"]` and sets `FRONTEND_HOST`/`FRONTEND_PORT`/`FRONTEND_PROTOCOL_HEADER`/`FRONTEND_HOST_HEADER`/`FRONTEND_BODY_SIZE_LIMIT`, `INTERNAL_API_URL` (the in-cluster API service), and `PUBLIC_API_ORIGIN` (so browsers reach the API directly for streaming and the activity WebSocket).

---

## Reference: key files

| Concern | File |
|---|---|
| Session resolution + cookie/host rewrite | `client/src/hooks.server.ts` |
| Authed-area guard + sidebar data | `client/src/routes/(app)/+layout.server.ts` |
| Owner-only admin guard | `client/src/routes/(app)/admin/+layout.server.ts` |
| Dashboard shell | `client/src/routes/(app)/+layout.svelte` |
| In-process `/api` proxy | `client/src/routes/api/[...path]/+server.ts` |
| Typed API client factory (16 namespaces) | `client/src/lib/api/client.ts` |
| Isomorphic `apiFetch` + `ApiError` | `client/src/lib/api/fetch.ts` |
| URL resolution + `PUBLIC_API_ORIGIN` bypass | `client/src/lib/api/url.ts` |
| Backend contract types | `client/src/lib/types/api.ts` |
| Rune stores | `client/src/lib/state/*.svelte.ts` |
| Icon registry + offline bundling | `client/src/lib/utils/icons.ts`, `client/src/lib/components/ui/AppIcon.svelte` |
| Theme bootstrap + form guard | `client/src/app.html`, `client/src/lib/state/theme.svelte.ts` |
| Tailwind 4 + shadcn-svelte CSS-first config | `client/src/app.css` |
| Public share page (SSR for OG) | `client/src/routes/s/[token]/+page.server.ts` |
| adapter-node + `envPrefix` | `client/svelte.config.js` |
| Vitest dual projects + coverage | `client/vite.config.ts`, `client/scripts/coverage-floor.mjs` |
| Real-stack e2e | `client/playwright.config.ts`, `client/test/e2e/*.e2e.ts` |
