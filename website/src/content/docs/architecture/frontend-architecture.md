---
title: "Frontend architecture (Nuxt 4)"
description: "How the Alcoves Nuxt 4 frontend is structured: SSR topology, isomorphic API transport, typed client, layouts, auth middleware, and SSR-safety conventions."
---

The Alcoves frontend is a **Nuxt 4** (Vue 3) application running on its own Nitro server. The Go backend is a pure API — it does not embed or serve frontend assets. In development, Nitro proxies `/api/**` and `/s/**` to the Go API on port 3001. In production, both processes sit behind one reverse proxy.

| Process | Default port |
|---|---|
| Nuxt Nitro (frontend) | 3000 |
| Go API (backend) | 3001 |

This document is aimed at contributors. Read it before working in `frontend/app/`.

---

## SSR topology

Alcoves uses a deliberate "client-render everywhere except share pages" strategy. The only route that requires server-side rendering is the public moment share page (`/s/:token`), which must emit Open Graph and Twitter player meta tags for social embeds. Every other page is client-rendered to avoid coupling page loads to backend latency and to eliminate a native-form-submit race during hydration (see [Form-guard plugins](#form-guard-plugins) below).

The `nuxt.config.ts` encodes this with a broad `routeRules` override:

```ts
ssr: true,                       // global default
routeRules: {
  "/**":   { ssr: false },       // client-render everything ...
  "/s/**": { ssr: true },        // ... except public share pages
},
```

`ssr: true` is set globally, then immediately narrowed: the `/**` rule disables server rendering, and the more-specific `/s/**` rule re-enables it only for share pages.

### Dev proxy

During `bun run dev`, Nitro proxies backend traffic automatically:

- `/api/**` → `${ALCOVES_API_URL}/api/**`
- `/s/**` → `${ALCOVES_API_URL}/s/**`
- WebSocket upgrades are enabled (`ws: true`) so the real-time activity socket (`/api/ws`) tunnels through the dev proxy without extra configuration.

### Runtime configuration

```ts
runtimeConfig: {
  apiUrl: process.env.ALCOVES_API_URL || "http://localhost:3001",  // server-only
  public: {
    apiOrigin: process.env.NUXT_PUBLIC_API_ORIGIN || "",
  },
},
```

| Variable | Side | Purpose |
|---|---|---|
| `ALCOVES_API_URL` | Server (SSR) | Backend URL used when `apiFetch` runs on the server. Defaults to `http://localhost:3001`. |
| `NUXT_PUBLIC_API_ORIGIN` | Client | When set, the client hits the backend directly cross-origin with `credentials: include`. When empty (default), the client uses relative URLs proxied by Nitro. |

Setting `NUXT_PUBLIC_API_ORIGIN` in production lets browsers stream video and image blobs directly from the API, bypassing Nitro's range-request buffering.

### Modules and theme

- **Nuxt UI v4** is the only Nuxt module. The Nitro preset is `"bun"` to align with the Bun runtime.
- **Theme** (`app.config.ts`): `primary = "emerald"`, `neutral = "zinc"`. Color mode defaults to the system preference and is stored under the `alcoves.theme` key.
- **Vidstack** is registered as a Vite plugin for the media player. `media-*` custom elements are exempted from Vue's unknown-element warning so `<media-player>` and `<media-video-layout>` render without console noise.
- **Icon routes** are served at `/_nuxt_icon` rather than `/api/*` so the Go backend proxy does not intercept them.
- **TypeScript** is configured with `strict: true`.
- Anything under `composables/**` and `utils/**` is **auto-imported** — no explicit imports are needed in pages or components for those trees.

:::caution[Bun hoisted linker is required]
`bunfig.toml` pins `linker = "hoisted"`. Bun's default symlinked `node_modules` layout triggers an `ELOOP` error in Nitro's dependency trace step at build time. Always install with `bun install` and do not switch package managers.
:::

---

## Isomorphic transport

`app/utils/api-fetch.ts` is the single HTTP transport layer. It is auto-imported and exports three things used across the codebase: `apiFetch`, `apiUrl`, and `ApiError`.

### URL resolution (`apiUrl`)

`apiUrl(path)` resolves a relative API path to an absolute URL, branching on render context:

- **On the server (SSR):** prepends `runtimeConfig.apiUrl` (`ALCOVES_API_URL`).
- **On the client:** prepends `NUXT_PUBLIC_API_ORIGIN` when set; otherwise returns the path unchanged so the browser's request is handled by Nitro's proxy.
- Already-absolute URLs pass through unchanged.

### The fetch wrapper (`apiFetch`)

`apiFetch<T>(url, options)` wraps `fetch` with consistent behavior:

- **Query params:** appends query params, dropping any whose value is `undefined`.
- **SSR cookie forwarding:** on the server, grabs the incoming request's `Cookie` header via `useRequestHeaders(["cookie"])` and forwards it to the backend. This is the auth mechanism for SSR-rendered `/s/**` share pages.
- **Credentials mode:** uses `credentials: "include"` when `NUXT_PUBLIC_API_ORIGIN` is set (cross-origin); otherwise `"same-origin"`.
- **FormData handling:** a `FormData` body skips `Content-Type` so the browser can set the multipart boundary automatically; all other bodies are JSON-serialized.
- **Response types:** `"blob"` returns a `Blob`, `"text"` returns a raw string, and the default `"json"` parses the response body with null-safety (an empty body yields `null`).
- **Errors:** on a non-OK response, attempts a JSON parse and throws `ApiError(status, data)`.

### `ApiError`

`ApiError` extends `Error` and carries `status: number` and `data: Record<string, unknown> | null`. The message is resolved from `data.message`, then `data.statusMessage`, then a generic fallback.

:::note[Testing note]
When mocking `~/utils/api-fetch` in unit tests, always re-export `apiUrl` and `ApiError` alongside `apiFetch`. Multiple components import them directly, and omitting either causes opaque Vitest module errors.
:::

### `useApiFetch` composable

`app/composables/useApiFetch.ts` wraps Nuxt's `useAsyncData` and calls `apiFetch` internally. It bridges SSR payloads into client hydration. Key options beyond the standard `useAsyncData` surface:

- `query` — reactive query params resolved via `toValue()` at fetch time.
- `key` — dedup key for `useAsyncData` (defaults to `api:<url>`).
- `watch` — defaults to watching the resolved URL ref; pass `false` to disable.

**Rule of thumb:** use `useApiFetch` for page-level data that should hydrate from SSR; use `apiFetch` directly for imperative mutations and fire-and-forget calls.

---

## Typed API client

`app/api/index.ts` exports a single `api` object composed of **14 namespaced sub-objects**. Every method wraps `apiFetch` or `apiUrl`. This is the only place route paths are written — components and composables call `api.files.list(...)` rather than hand-writing URLs. Adding or changing a backend route means editing this file and the shared types.

| Namespace | Covers |
|---|---|
| `api.auth` | Session, login, register, logout, profile, avatar, active sessions, OAuth providers |
| `api.libraries` | Library CRUD |
| `api.files` | File CRUD, playback sources, image/video proxy, transcription, waveform, audio event detection |
| `api.folders` | Folder CRUD, move, trash, restore, purge |
| `api.tags` | Tag CRUD, bulk sync |
| `api.highlightFilters` | Highlight filter CRUD |
| `api.members` | Library members and invite links |
| `api.people` | Face recognition people, merge, thumbnail URL builder |
| `api.objects` | Object detection labels, reprocess |
| `api.downloads` | ZIP download size estimate |
| `api.search` | Cross-library search |
| `api.invites` | Invite lookup and acceptance |
| `api.admin` | Admin stats, settings, user management, job control |
| `api.moments` | Moment CRUD, sharing, export, download URL builder |
| `api.meta` | Public metadata (registration mode) |

A few endpoints are intentionally not wrapped because they don't fit the `apiFetch` model: the admin SSE job stream (used via `EventSource`), moment downloads (browser navigation to a signed URL), and ZIP downloads (raw `fetch` for blob streaming).

---

## Layouts

### Dashboard layout

`app/layouts/dashboard.vue` is the primary authenticated shell used by most pages. It provides:

- A **sidebar** (fixed on desktop; a slide-over on mobile) with the brand link, the default library, a list of all libraries with a create button, and an **Admin** link that appears only for users with the `owner` role.
- A **header** with a global search form (submits to `/search?q=…`), a notification bell, and a user avatar dropdown with profile and sign-out links.
- A `useApiFetch` call for `GET /api/libraries` and a `refreshLibraries` function registered into the `useLibrariesList()` singleton, so child pages can trigger a sidebar refresh without prop drilling.

### Library layout

`app/layouts/library.vue` wraps all `/libraries/[id]/*` pages. It renders inside the dashboard layout and adds a library header, navigation tabs, and the page slot. It fetches `GET /api/libraries/:id` and **provides** three values to child pages via Vue's `inject`:

| Provided key | Type | Value |
|---|---|---|
| `libraryId` | `Ref<string>` | Current route param |
| `library` | `Ref<Library \| null>` | Fetched library object |
| `canManageLibrary` | `ComputedRef<boolean>` | True when the current user is the library owner or has the `owner`/`admin` role |

:::note
The video editor (`/libraries/[id]/edit/[fileId]`) uses the `dashboard` layout directly rather than the library layout because it needs the full viewport width.
:::

---

## Auth middleware

`app/middleware/auth.global.ts` is a global Nuxt route middleware that runs on every navigation.

**Flow:**

1. **Public allowlist** — `/login`, `/register`, `/s/**`, and `/invites/**` bypass the auth check entirely.
2. **Session gate** — if the user is not logged in, calls `fetchSession()` to validate the session cookie via `GET /api/_auth/session`. If still unauthenticated, redirects to `/login?redirect=<original path>`.
3. **Owner gate** — `/admin` and `/admin/jobs` redirect non-owner users to `/`.

:::note[Testing note]
The middleware destructures `{ loggedIn, user, fetchSession }` from `useAuth()` on every navigation. A `useAuth` mock that omits any of these fields will crash the middleware during app initialization. Always return the full shape in tests.
:::

---

## App root

`app.vue` wraps everything in the Nuxt UI provider (`<UApp>`) and renders `<NuxtLayout>` → `<NuxtPage>`. Two app-level behaviors live here:

- **Upload navigation guard:** a `beforeunload` listener that blocks tab close or unload when there are active TUS uploads in flight (`useUploadQueue().hasInFlightUploads`).
- **Floating upload widget:** a `<UploadProgress>` component wrapped in `<ClientOnly>` that renders the global bottom-right upload status panel only on the client.

---

## Form-guard plugins

Because login and register pages can render HTML on the server but SSR is disabled for `/**` routes, there is a window between server HTML delivery and client hydration where a user could trigger a native form submit (a full-page POST or GET), losing the form's intent. Two paired plugins close this gap:

- **`frontend/server/plugins/form-guard.ts`** (Nitro server plugin): injects an inline `<script>` at the top of `<body>` that installs a capturing `submit` listener. While `window.__nuxtReady` is falsy, every form submit is cancelled with `e.preventDefault()`.
- **`frontend/app/plugins/form-guard.client.ts`** (client plugin): on the `app:mounted` hook, sets `window.__nuxtReady = true`, releasing the guard once Vue has fully hydrated.

End-to-end tests read `window.__nuxtReady` to know the app is interactive before asserting on page content.

---

## Backend contract types

`shared/types/api.ts` (imported as `~~/shared/types/api`) is the single source of truth for TypeScript types that mirror Go backend response shapes. All IDs are string UUIDs.

Key types include `Library`, `LibraryFile` (carries async job status fields for proxy, transcription, audio detection, and waveform pipelines), `LibraryFolder`, `LibraryEntry` (a discriminated union of `LibraryFile | LibraryFolder`), `Moment`, `MomentShare`, `HighlightFilter`, `AuthUser`, `AdminStats`, and the people, search, invites, and members families.

`ActivityAction` is a closed union literal of 13 values (`file.created`, `folder.renamed`, `moment.shared`, `system.waveform_ready`, and others) that exactly mirrors the backend enum. Adding a new activity type requires updating both files in lockstep.

---

## SSR-safety conventions

Because `/s/**` pages render on the server in production, browser-only globals must be guarded. When adding `window`, `document`, `localStorage`, `sessionStorage`, `navigator.clipboard`, `history`, `ResizeObserver`, or Vidstack imports to a component or composable, wrap the access in `import.meta.client` or defer it to `onMounted`.

Established patterns in the codebase:

- **Vidstack lazy-import:** `FilePreview.vue` and `VideoEditorPlayer.vue` dynamically import `vidstack/player` in `onMounted`, set a `playerReady` flag, and render `<media-player v-if="playerReady">`.
- **`crossorigin="use-credentials"`** on every `<img>`, `<media-player>`, and canvas image load — all media endpoints require the session cookie.
- Composables `useFileDrop`, `useEditorShortcuts`, and `useWaveformRenderer` guard all DOM/`window` access with `import.meta.client`. The notifications socket returns early on the server.

:::note[Testing note]
`localStorage`, `sessionStorage`, `navigator.clipboard`, and `<NuxtLayout>` are already stubbed in `test/setup.ts`. Do not re-stub them per file.
:::

### `useRoute` and `useRouter` in tests

`useRoute` and `useRouter` auto-import from `#app/composables/router`, not from `vue-router`. Mocking `vue-router` alone does not intercept Nuxt's auto-imports. Tests that need to control route state should avoid `useRoute`-dependent code paths, or mock at the `#app/composables/router` level.

---

## Data flow

```
Page / Component
  └─ api.<namespace>.<method>()      typed client — route paths live here
       └─ apiFetch<T>()              transport layer
            ├─ apiUrl()              SSR → runtimeConfig.apiUrl
            │                        client → apiOrigin or relative path
            ├─ SSR: forward Cookie   via useRequestHeaders
            └─ throws ApiError       on any non-OK response

  └─ useApiFetch()                   useAsyncData wrapper for hydrating reads
```

For real-time data, `useNotificationsSocket` opens a WebSocket to `/api/ws` (Nitro proxies with `ws: true`). The notification bell and activity feed pages subscribe to `user:<id>` and `library:<id>` rooms.

---

## Reference: key files

| Concern | File |
|---|---|
| SSR topology, proxy, runtime config, modules | `frontend/nuxt.config.ts` |
| Isomorphic transport (`apiFetch`, `apiUrl`, `ApiError`) | `frontend/app/utils/api-fetch.ts` |
| `useAsyncData` wrapper | `frontend/app/composables/useApiFetch.ts` |
| Typed API client (14 namespaces) | `frontend/app/api/index.ts` |
| Primary shell layout | `frontend/app/layouts/dashboard.vue` |
| Nested library layout | `frontend/app/layouts/library.vue` |
| Auth and owner-route middleware | `frontend/app/middleware/auth.global.ts` |
| Root shell (upload guard, floating progress) | `frontend/app/app.vue` |
| Form-guard (server) | `frontend/server/plugins/form-guard.ts` |
| Form-guard (client) | `frontend/app/plugins/form-guard.client.ts` |
| Backend contract types | `frontend/shared/types/api.ts` |
| Nuxt UI theme | `frontend/app/app.config.ts` |
| Bun linker pin | `frontend/bunfig.toml` |
| Only SSR-rendered route | `frontend/app/pages/s/[token].vue` |
