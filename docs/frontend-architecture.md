# Frontend Architecture (Nuxt 4)

This document gives a contributor the mental model of the Alcoves frontend. It
covers the SSR topology, the isomorphic HTTP transport, the typed API client,
the layout/middleware/plugin layer, and the conventions that keep the app
SSR-safe. Read it before touching anything under `frontend/app/`.

The frontend is a **Nuxt 4** (Vue 3) app running on its own Nitro server. The
Go backend (`backend/`) is a pure API — it does not embed or serve the
frontend. In dev, Nitro proxies `/api/**` and `/s/**` to the Go API; in prod,
both processes sit behind one reverse proxy.

- **Frontend (Nuxt Nitro):** port `3000`
- **Backend (Go/Echo API):** port `3001`

---

## 1. SSR topology (`frontend/nuxt.config.ts`)

Alcoves is "client-rendered everywhere except share pages." This is deliberate:
the only page that needs server rendering is the public moment share page
(`/s/:token`) which must emit Open Graph / Twitter player meta tags for social
embeds. Every other route is client-rendered to avoid SSR-time coupling to the
backend and to dodge a native-form-submit race during hydration (see §7).

```ts
// nuxt.config.ts
ssr: true,                       // global default
routeRules: {
  "/**":   { ssr: false },       // client-render everything...
  "/s/**": { ssr: true },        // ...except public share pages
  "/api/**": { proxy: `${apiTarget}/api/**` }, // prod API proxy
},
```

`ssr: true` is set globally but immediately narrowed by `routeRules`: the broad
`"/**"` rule disables SSR, and the more specific `"/s/**"` rule re-enables it
only for share pages. The single page that opts in via raw `useAsyncData`
(rather than `useApiFetch`) is `app/pages/s/[token].vue`.

### Dev proxy

Nitro proxies API and share traffic to the Go backend during `bun run dev`:

- `/api/**` → `${ALCOVES_API_URL}/api/**`
- `/s/**` → `${ALCOVES_API_URL}/s/**`
- `ws: true` — WebSocket upgrade is enabled so `/api/ws` (the activity/
  notifications socket) tunnels through the dev proxy.

### `runtimeConfig`

```ts
runtimeConfig: {
  apiUrl: process.env.ALCOVES_API_URL || "http://localhost:3001", // server-only
  public: {
    googleAuthEnabled: process.env.VITE_GOOGLE_AUTH_ENABLED === "true",
    apiOrigin: process.env.NUXT_PUBLIC_API_ORIGIN || "",
  },
},
```

- `apiUrl` (server-only) is the backend URL used by `apiFetch` during SSR.
  Sourced from `ALCOVES_API_URL`, default `http://localhost:3001`.
- `public.apiOrigin` is sourced from `NUXT_PUBLIC_API_ORIGIN`. **Empty string**
  means the client uses relative URLs proxied by Nitro. **Non-empty** means the
  client hits the backend directly cross-origin with `credentials: "include"`
  — used in prod (set in the Helm frontend deployment) so browsers stream
  video/image/download blobs directly from the API and bypass Nitro's
  range-request buffering.
- `public.googleAuthEnabled` toggles the Google OAuth button on login/register.

### Module, theme, and Vite config

- **Module:** `@nuxt/ui` (Nuxt UI v4) is the only Nuxt module. The Nitro
  preset is `"bun"` to align with the Bun runtime.
- **Theme** (`app.config.ts`): `primary = "emerald"`, `neutral = "zinc"`.
  Color mode is stored at `alcoves.theme`, defaults to system preference.
- **Vidstack:** registered as a *Vite* plugin (`vite: { plugins: [vidstack()] }`)
  for the media player. `media-*` custom elements are exempted from Vue's
  unknown-element warning so `<media-player>`/`<media-video-layout>` render
  cleanly.
- **Icon:** `localApiEndpoint: "/_nuxt_icon"` — moved off `/api/*` so the Go
  backend dev proxy doesn't intercept icon requests.
- **TypeScript:** `strict: true`.
- **Auto-imports:** `composables/**` and `utils/**` are auto-imported — no
  explicit imports needed in pages/components for anything in those trees.

### Bun hoisted linker (`bunfig.toml`)

`bunfig.toml` pins `linker = "hoisted"`. This is **required**: Bun's default
symlinked `node_modules` layout triggers an `ELOOP` error in Nitro's dependency
trace step at build time. Install with `bun install` (which honors the config);
do not switch package managers.

---

## 2. Isomorphic transport (`app/utils/api-fetch.ts`)

`api-fetch.ts` is the single HTTP transport layer. It is auto-imported (via
`imports.dirs: ["utils/**"]`) and exports `apiFetch`, `apiUrl`, and `ApiError`.

### `apiUrl(path)` — URL resolution

Resolves a relative API path to an absolute URL, branching on render context:

- **SSR (server):** prepends `runtimeConfig.apiUrl` (= `ALCOVES_API_URL`,
  default `http://localhost:3001`), falling back to
  `process.env.ALCOVES_API_URL` if called outside a Nuxt request context.
- **Client:** prepends `runtimeConfig.public.apiOrigin`
  (= `NUXT_PUBLIC_API_ORIGIN`) when set; otherwise returns the path
  **unchanged** so the relative URL is handled by the Nitro dev proxy.
- Already-absolute URLs (`https?://…`) pass through unchanged.

### `apiFetch<T>(url, options)` — the fetch wrapper

`ApiFetchOptions`: `{ method?, body?, query?, responseType?, headers? }`.

Behavior:

- **Query filtering:** appends `query` params, dropping any whose value is
  `undefined`.
- **SSR cookie forwarding:** on the server, grabs the request's `Cookie`
  header via `useRequestHeaders(["cookie"])` and forwards it to the backend.
  This is the *only* auth mechanism for SSR-rendered `/s/**` share pages — the
  browser's session cookie must be on the initial request.
- **Credentials mode:** `credentials: "include"` when `NUXT_PUBLIC_API_ORIGIN`
  is set (cross-origin); otherwise `"same-origin"`.
- **FormData handling:** a `FormData` body skips the `Content-Type` header so
  the browser sets the multipart boundary; all other bodies are JSON-serialized
  with `Content-Type: application/json`.
- **`responseType`:** `"blob"` returns a `Blob`, `"text"` returns the raw
  string, default `"json"` parses with null-safety (an empty body yields
  `null as T`).
- **Errors:** on a non-OK response it attempts a JSON parse and throws
  `ApiError(status, data)`.

### `ApiError`

Extends `Error`. Fields: `status: number`, `data: Record<string, unknown> | null`.
Message resolution order: `data.message` → `data.statusMessage` → a generic
string. Several components import `ApiError` for type-narrowing on failed
requests — **when mocking `~/utils/api-fetch` in tests, always re-export
`apiUrl` and `ApiError` alongside `apiFetch`**, or you get opaque vitest module
errors.

### `useApiFetch` (`app/composables/useApiFetch.ts`)

A thin wrapper over Nuxt's `useAsyncData` that calls `apiFetch`. It bridges SSR
payloads into client hydration. `UseApiFetchOptions` adds:

- `immediate?` (default `true`), `server?` (default `true`), `lazy?` (default
  `false`)
- `query?: MaybeRefOrGetter<…>` — reactive query params resolved via
  `toValue()` at fetch time
- `key?` — `useAsyncData` dedup key (defaults to `api:<url>`)
- `watch?: WatchSource[] | false` — defaults to watching the resolved URL ref

The URL argument is a `MaybeRefOrGetter<string>`; wrapping it in `computed()`
means the `useAsyncData` watcher auto-refetches when route params change.
Returns `{ data, error, status, refresh, execute }`.

**Rule of thumb:** use `useApiFetch` for page-level data that should hydrate
from SSR; use `apiFetch` directly (via the `api` client below) for imperative
mutations and polling.

---

## 3. The typed API client (`app/api/index.ts`)

`app/api/index.ts` exports a single `api` object composed of **14 namespaced
sub-objects**, each `as const`. Every method wraps `apiFetch` or `apiUrl`. This
is **the only place route paths are written** — components and composables call
`api.files.list(...)` etc. rather than hand-writing URLs. Adding or changing a
backend route means editing this file (and usually `shared/types/api.ts`).

The 14 namespaces:

| Namespace | Covers | Notable paths |
|---|---|---|
| `api.auth` | session, login, register, logout, me, avatar, sessions, providers | `GET /api/_auth/session`, `POST /api/auth/login`, `POST /api/auth/me/avatar` (FormData) |
| `api.libraries` | library CRUD | `/api/libraries`, `/api/libraries/:id` |
| `api.files` | file CRUD + media jobs | `…/files`, `…/playback-sources`, `…/proxy`, `…/transcribe`, `…/waveform`, `…/audio-detect`, `…/bulk-transcribe`, `…/bulk-audio-detect` |
| `api.folders` | folder CRUD + move/restore/purge | `…/folders/...` |
| `api.tags` | tag CRUD + sync | `…/tags/...`, `PUT …/files/:id/tags` |
| `api.highlightFilters` | filter CRUD | `…/highlight-filters/...` |
| `api.members` | members + invite links | `…/users/...` |
| `api.people` | face recognition | `…/people`, `…/people/merge`, `thumbnailUrl` (builder) |
| `api.objects` | object detection | `…/objects/labels`, `…/object-detection/reprocess` |
| `api.downloads` | ZIP estimate | `POST …/download-estimate` |
| `api.search` | global search | `GET /api/search?q=…&limit=…` |
| `api.invites` | invite lookup/accept | `GET /api/invites/:token`, `POST …/accept` |
| `api.admin` | admin + jobs | `…/stats`, `…/settings`, `…/users`, `controlJob`, `purgeQueue` |
| `api.moments` | moment CRUD + share/export | `…/moments/...`, `export`, `downloadUrl` (builder), `createShare` |
| `api.meta` | public meta | `GET /api/_meta/registration-mode` |

Some endpoints are deliberately **not** wrapped because they aren't
`apiFetch`-shaped: the admin SSE job stream (`GET /api/admin/jobs/stream`, used
via `EventSource`), the moment download (a browser navigation to
`api.moments.downloadUrl(...)`), and the ZIP download (raw `fetch` for blob
streaming in `useDownloadZip`). Bulk file endpoints accept an empty `fileIds`
list to mean "all eligible files."

---

## 4. Layouts

### `app/layouts/dashboard.vue` — primary authenticated shell

Used by most pages via `definePageMeta({ layout: "dashboard" })`. It provides:

- A **sidebar** (`w-64` desktop; mobile `USlideover`): brand link, the default
  library (the one with `isDefault: true`), a "Libraries" section with a `+`
  button (`POST /api/libraries` → `refreshLibraries()`), the non-default
  library list, and a conditional **Admin** item shown only when
  `user.value?.role === "owner"`.
- A **header bar**: mobile hamburger, a global search `<form>` (submits to
  `/search?q=…`, synced from `route.query.q`), `<NotificationBell>`, and a user
  avatar dropdown (profile link + sign-out).
- Fetches `GET /api/libraries` via `useApiFetch` and registers
  `refreshLibraries` into the `useLibrariesList()` singleton so child pages can
  trigger a sidebar refresh without prop drilling.

### `app/layouts/library.vue` — nested library layout

Wraps all `/libraries/[id]/*` pages. It renders **inside** the dashboard layout
via `<NuxtLayout name="dashboard">`, then adds `<LibraryHeader>` +
`<LibraryTabs>` + `<slot/>`. It fetches `GET /api/libraries/:id` and **provides**
three values consumed by child pages via Vue `inject`:

- `libraryId` — `Ref<string>` (route param)
- `library` — `Ref<Library | null>`
- `canManageLibrary` — `ComputedRef<boolean>` (true if `library.ownerId === user.id`
  or `currentUserRole` is `"owner"`/`"admin"`)

It also exposes `refreshLibrary`, and inline `saveLibraryName` /
`saveLibraryEmoji` handlers (`PATCH /api/libraries/:id`). The video editor page
(`edit/[fileId].vue`) deliberately uses the `dashboard` layout, not `library`,
because it needs full width.

---

## 5. Route middleware (`app/middleware/auth.global.ts`)

A **global** Nuxt route middleware running on every navigation. It destructures
`{ loggedIn, user, fetchSession }` from `useAuth()` on every page mount — **a
`useAuth` mock that omits any of these crashes the middleware during app init**,
so tests must always return the full shape.

Flow:

1. **Public allowlist (bypass auth):** `/login`, `/register`, `/s/**` (share
   pages), `/invites/**` (invite landing).
2. **Session gate:** if `loggedIn` is false, call `fetchSession()` (validates
   the cookie via `GET /api/_auth/session`). If still not logged in,
   `navigateTo({ path: "/login", query: { redirect: to.fullPath } })`.
3. **Owner gate:** `ownerRoutes = ["/admin", "/admin/jobs"]`. If the route
   matches and `user.value?.role !== "owner"`, redirect to `/`.

Note `/invites/:token` is whitelisted here but the page itself calls
`fetchSession()` and redirects unauthenticated users to
`/register?invite=:token`.

---

## 6. App root (`app.vue`)

The root shell wraps everything in `<UApp>` (the Nuxt UI provider) and renders
`<NuxtLayout>` → `<NuxtPage>`. Two app-level behaviors live here:

- **Upload navigation guard:** registers a `beforeunload` listener on mount;
  if `useUploadQueue().hasInFlightUploads` is true, it cancels navigation
  (`event.returnValue = ""`) to prevent accidentally closing the tab during an
  active TUS upload.
- **Floating upload widget:** `<UploadProgress>` wrapped in `<ClientOnly>` —
  the global bottom-right upload status panel. `ClientOnly` keeps it out of SSR.

---

## 7. Form-guard plugins (the hydration race fix)

Because login/register forms can render on the server but route rules disable
SSR for `/**`, there is a window between server HTML and client hydration where
a user could trigger a *native* form submit (full-page POST/GET), losing intent.
Two paired plugins close this:

- **`frontend/server/plugins/form-guard.ts`** (Nitro server plugin): injects an
  inline `<script>` at the top of `<body>` that installs a capturing `submit`
  listener. While `window.__nuxtReady` is falsy, every submit is cancelled with
  `e.preventDefault()`.
- **`frontend/app/plugins/form-guard.client.ts`** (client plugin): on the
  `app:mounted` hook, sets `window.__nuxtReady = true`, releasing the guard once
  Vue has fully hydrated. E2E tests also read `window.__nuxtReady` to know the
  app is interactive.

---

## 8. Backend contract types (`shared/types/api.ts`)

`shared/types/api.ts` (imported as `~~/shared/types/api`) is the single source
of truth for TypeScript types mirroring Go backend response shapes. All IDs are
`string` UUIDs.

Key types include `Library`, `LibraryFile` (the richest — carries every async
job's `*Status`/`*Progress`/`*Error`/`*Version` fields for proxy, transcribe,
audio-detect, and waveform pipelines), `LibraryFolder`, `LibraryEntry`
(`= LibraryFile | LibraryFolder`, discriminated by `kind`), `PaginatedFiles`,
`Moment`, `MomentShare`, `HighlightFilter`, `AudioDetection`, `WaveformData`,
`PlaybackSource`, `AuthUser`, `AdminStats`, `AppSettings`, and the people/search/
invites/members families.

`ActivityAction` is a **closed union literal** of 13 values
(`file.created`, `folder.renamed`, `moment.shared`, `system.waveform_ready`, …)
that exactly mirrors the backend Go `actions.go` enum. Adding a new activity
type means updating both files in lockstep, or one side silently mishandles it.

---

## 9. SSR-safety convention

Because pages render on the server by default in dev tooling (and `/s/**` does
in prod), any access to browser-only globals must be guarded. **When adding
`window`, `document`, `localStorage`, `sessionStorage`, `navigator.clipboard`,
`history`, `ResizeObserver`, or vidstack imports to a component or composable,
wrap it in `import.meta.client` or defer it to `onMounted`/`onBeforeUnmount`.**

Established patterns in the codebase:

- **Vidstack lazy-import:** `FilePreview.vue` and `VideoEditorPlayer.vue`
  dynamically `import("vidstack/player")` in `onMounted`, set `playerReady =
  true`, and render `<media-player v-if="playerReady">`.
- **`crossorigin="use-credentials"`** on every `<img>`, `<media-player>`, and
  canvas image load — all media endpoints require the session cookie.
- Composables `useFileDrop`, `useEditorShortcuts`, and `useWaveformRenderer`
  guard all DOM/`window` access with `import.meta.client`;
  `useNotificationsSocket.connect()` returns early on the server.

In tests, `localStorage`, `sessionStorage`, `navigator.clipboard`, and
`<NuxtLayout>` are already stubbed in `test/setup.ts` — don't re-stub them.

### `useRoute` / `useRouter` test gotcha

`useRoute`/`useRouter` auto-import from `#app/composables/router`, **not**
`vue-router`. Mocking `vue-router` alone does not intercept Nuxt's auto-imports.
Some components (e.g. `NotificationDropdown.vue`) import `useRouter` explicitly
from `#app/composables/router` to keep behavior predictable.

---

## 10. Data flow summary

```
Page / Component
  └─ api.<namespace>.<method>()      (app/api/index.ts — route paths)
       └─ apiFetch<T>()              (app/utils/api-fetch.ts — transport)
            ├─ apiUrl()              SSR → runtimeConfig.apiUrl
            │                        client → apiOrigin or relative
            ├─ SSR: forward Cookie   (useRequestHeaders)
            └─ throws ApiError on non-OK
  └─ useApiFetch()                   (useAsyncData wrapper for hydrating reads)
```

For real-time data, `useNotificationsSocket` opens a WebSocket to
`ws[s]://<host>/api/ws` (Nitro proxies it with `ws: true`); the bell and feed
pages subscribe to `user:<id>` and `library:<id>` rooms.

---

## Related code

| Concern | File |
|---|---|
| SSR topology, proxy, runtimeConfig, modules | `frontend/nuxt.config.ts` |
| Isomorphic transport (`apiFetch`, `apiUrl`, `ApiError`) | `frontend/app/utils/api-fetch.ts` |
| `useAsyncData` wrapper | `frontend/app/composables/useApiFetch.ts` |
| Typed API client (14 namespaces) | `frontend/app/api/index.ts` |
| Primary shell | `frontend/app/layouts/dashboard.vue` |
| Nested library layout (provides `libraryId`/`library`/`canManageLibrary`) | `frontend/app/layouts/library.vue` |
| Auth + owner-route middleware | `frontend/app/middleware/auth.global.ts` |
| Root shell (UApp, upload guard, UploadProgress) | `frontend/app.vue` |
| Form-guard (server) | `frontend/server/plugins/form-guard.ts` |
| Form-guard (client) | `frontend/app/plugins/form-guard.client.ts` |
| Backend contract types | `frontend/shared/types/api.ts` |
| Nuxt UI theme (emerald/zinc) | `frontend/app.config.ts` |
| Bun hoisted linker pin | `frontend/bunfig.toml` |
| Public SSR share page (only SSR'd route) | `frontend/app/pages/s/[token].vue` |
