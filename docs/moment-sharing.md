# Public Moment Sharing

Public moment sharing lets a library member turn a **moment** (a named
time-range clip of a video file) into a tokenized public URL that anyone can
open — no Alcoves account, no login, no library membership required. The shared
page renders a standalone dark-themed video player, embeds rich Open Graph /
Twitter Player metadata so the link unfurls nicely in chat apps and social
feeds, and streams the exported MP4 clip directly from the backend.

This is the only part of Alcoves that is deliberately exposed to anonymous
visitors. Everything else behind `/api/**` requires a session cookie; the share
subsystem is a small, auth-bypassed surface guarded by a long random bearer
token and a per-library opt-in flag.

## What a user experiences

1. **Enable sharing on the library.** Sharing is off by default. A library
   owner/admin flips the **Sharing** toggle in
   `/libraries/:id/settings` (persisted as `libraries.sharing_enabled`). Until
   this is on, no share links can be created.
2. **Create a moment and export it.** In the video editor
   (`/libraries/:id/edit/:fileId`) the user marks a moment (start/end seconds),
   then triggers an export. The backend transcodes the clip to a versioned MP4
   in cache storage (the `moment:export` async job).
3. **Generate a share link.** From the moment edit form the user opens the
   **Share** modal (`MomentShareModal.vue`), which lists existing active links
   and offers a **Create** button. Creating a link returns a public URL of the
   form `https://<host>/s/<token>`.
4. **Share the URL.** Anyone who opens `/s/<token>` lands on the SSR public
   share page. If the clip has finished exporting they get an inline player;
   otherwise they see a "Still processing" placeholder. Pasting the link into
   Slack/Discord/iMessage/X produces a video unfurl driven by the page's OG
   tags.
5. **Revoke when done.** Each link can be revoked from the share modal. Revoking
   sets `revoked_at`; the token immediately 404s everywhere (metadata, video,
   thumbnail, and the SSR page).

A few important guarantees:

- A share link points at a **moment**, not a raw file. The visitor only ever
  receives the exported clip — never the source file, and never anything that
  would require auth.
- The clip is **version-stamped**. Editing the moment's time range bumps its
  export version and re-encodes; the share always serves the latest completed
  export.
- Revocation is instant and irreversible for that token. Generating a new link
  mints a fresh token.

## How it works

### Data model

Two tables underpin sharing (migrations `00008` and `00009`):

| Table | Key columns | Purpose |
|---|---|---|
| `libraries` | `sharing_enabled BOOLEAN NOT NULL DEFAULT false` | Per-library gate. Added in migration `00008`. |
| `moments` | `start_seconds`, `end_seconds` (numeric 12,3), `export_status`, `export_version`, `exported_version`, `trashed_at` | The clip definition + export state machine. |
| `moment_shares` | `token TEXT UNIQUE`, `moment_id`, `library_id`, `created_by_id`, `revoked_at` | One row per share link. `revoked_at IS NULL` means active. |

The relationship a public request resolves is **share → moment → file**:
`moment_shares.token` → `moments` (must not be trashed) → `files` (the source
video, used for the thumbnail). The exported MP4 lives in **cache storage**, not
in the `files` table, keyed by
`momentexport.CacheKey(libraryID, momentID, version)` =
`"{libraryID}/moments/{momentID}/v{version}.mp4"`.

A moment is **ready to share** only when both:

- `moments.exported_version` is non-nil, and
- `moments.export_status == "ready"`.

### Share management (authenticated)

Share CRUD lives on the authenticated, library-scoped moment routes in
`backend/internal/handlers/moment_share.go` (part of `MomentHandler`). These run
behind `AuthMiddleware` + `LibraryAccessMiddleware`, so the caller must be a
library member; mutating verbs require admin/owner per the library write-gate.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/libraries/:id/files/:fileId/moments/:momentId/shares` | List active shares for the moment. |
| `POST` | `/api/libraries/:id/files/:fileId/moments/:momentId/shares` | Create a share link. |
| `DELETE` | `/api/libraries/:id/files/:fileId/moments/:momentId/shares/:token` | Revoke a share link. |

**`CreateShare`**

- Requires `library.sharing_enabled == true` — otherwise rejected. (The library
  settings toggle is the source of truth; the modal also mirrors this state to
  disable its Create button client-side.)
- Generates a **192-bit** random token encoded with `base64.RawURLEncoding`
  (URL-safe, unpadded) — this is the bearer secret embedded in `/s/<token>`.
- Inserts a `moment_shares` row.
- Emits the `moment.shared` activity event (`activity.ActionMomentShared`) into
  the library feed.

**`RevokeShare`**

- Sets `revoked_at` on the matching `moment_shares` row and returns **204 No
  Content**. Because every public lookup filters on `revoked_at IS NULL`, the
  token stops resolving immediately.

### Public share endpoints (auth-bypassed)

The public surface is `backend/internal/handlers/share.go` (`ShareHandler`),
registered on the `/api/share` group in `main.go`. The auth middleware
explicitly allowlists `/api/share/**` in its `needsAuth` check
(`backend/internal/middleware/auth.go`), so these routes never require a session
cookie or library membership.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/share/:token` | JSON metadata for the share. |
| `GET` | `/api/share/:token/video` | The exported MP4 (streamed, Range-aware). |
| `GET` | `/api/share/:token/thumbnail` | Poster image bytes. |

**Universal rule:** every handler resolves the share with
`WHERE revoked_at IS NULL`. A nonexistent or revoked token returns **404** —
there is no way to distinguish "never existed" from "revoked", which avoids
leaking the existence of tokens.

**`GET /:token` — Metadata**

Resolves share → moment → file and returns:

```json
{
  "token": "…",
  "title": "…",
  "description": "…",
  "shareUrl":     "https://host/s/<token>",
  "appUrl":       "https://host/libraries/<id>/edit/<fileId>?momentId=<id>",
  "videoUrl":     "https://host/api/share/<token>/video",
  "thumbnailUrl": "https://host/api/share/<token>/thumbnail",
  "ready": true
}
```

`ready` is `true` only when `ExportedVersion != nil && ExportStatus == "ready"`.
`videoUrl` and `thumbnailUrl` are included **only when `ready`** — a
not-yet-exported clip returns metadata with `ready: false` and no media URLs, so
the SSR page can render its "still processing" placeholder.

**`GET /:token/video` — Exported clip**

Streams the exported MP4 from cache storage with full HTTP **Range** support
(for scrubbing / partial fetches). Response headers:

- `ETag: "v{exportedVersion}"` — changes whenever the moment is re-exported.
- `Cache-Control: private, max-age=60` — short-lived, private (the clip is
  semi-public but not a long-cache asset).

**`GET /:token/thumbnail` — Poster**

Streams the poster image bytes **directly**. This is a deliberate design choice:
it does **not** redirect to `/api/files/proxy/...`, because that proxy endpoint
requires an authenticated session + library membership and would break Open
Graph crawlers (which fetch the thumbnail unauthenticated). If the source file
has a `ThumbnailFileID`, the handler looks up that file's MIME type from the DB
and streams its bytes; otherwise it falls back to the source file. Keeping the
bytes inline here is what makes the share link unfurl correctly in social cards.

### Base URL resolution

The absolute URLs in the metadata response (`shareUrl`, `appUrl`, `videoUrl`,
`thumbnailUrl`) must reflect the public-facing host, which may sit behind a
reverse proxy. `ShareHandler.resolveBase` resolves it in priority order:

1. `X-Forwarded-Proto` + `X-Forwarded-Host` (set by the reverse proxy), then
2. `cfg.BaseURL` (env `ALCOVES_BASE_URL`), then
3. the request's own `scheme` + `Host`.

Note this differs slightly from `MomentHandler.baseURLFor` (used by the
authenticated moment handlers), which additionally honors an `Origin` header at
the front of the chain. The public share handler intentionally does **not**
trust `Origin` for base resolution.

### Export pipeline (how the clip gets there)

Sharing depends on a successful moment export. The export is an async Asynq job
(`moment:export`, `momentexport.TaskTypeMomentExport`) handled by
`backend/internal/services/momentexport/`:

- Triggered by `POST …/moments/:momentId/export` → `momentExport.Enqueue` (HTTP
  returns **202**).
- ffmpeg cuts `[startSeconds, endSeconds]` and re-encodes to H.264/AAC MP4
  (`libx264 -crf 23 -preset medium … -movflags +faststart`), scaled to fit
  within 1920×1080.
- Output is streamed into cache at
  `CacheKey(libraryID, momentID, runVersion)`; on success the moment row is set
  to `export_status = "ready"`, `exported_version = runVersion`.
- **Versioning / staleness:** `export_version` is bumped whenever the moment's
  time range is edited; an in-flight encode that detects a version mismatch on
  completion discards its output. The versioned cache key means a previous
  export is never overwritten until a new one fully succeeds — so a live share
  link keeps serving the old clip until the new version is ready.

### SSR frontend: the `/s/:token` page

`frontend/app/pages/s/[token].vue` is the **only** server-side-rendered page in
the entire app. SSR is required so crawlers and link-unfurlers receive fully
populated `<meta>` tags in the initial HTML.

SSR topology (`frontend/nuxt.config.ts`):

```ts
routeRules: {
  "/**":   { ssr: false }, // client-render everything by default
  "/s/**": { ssr: true },  // SSR only the public share pages
}
```

Key behaviors of the page:

- **Raw `useAsyncData` + `apiFetch`** (not the usual `useApiFetch` wrapper) so
  the fetch runs on the server. On SSR, `apiFetch` prepends
  `runtimeConfig.apiUrl` (env `ALCOVES_API_URL`, default
  `http://localhost:3001`) and forwards the incoming request's `Cookie` header
  via `useRequestHeaders(['cookie'])`. The share endpoint ignores cookies, but
  the forwarding path is shared with other SSR fetches.
- **404 handling:** if `apiFetch` throws an `ApiError` with status 404 (revoked
  or unknown token), the page throws a Nuxt **fatal** error with
  `statusCode: 404`.
- **Full `useSeoMeta` suite** for video unfurls:
  - `ogType: "video.other"`, `ogVideo` (= `videoUrl`),
    `ogVideoType: "video/mp4"`, `ogVideoWidth/Height: 1920×1080`
  - `twitterCard: "player"`, `twitterPlayer` (= `videoUrl`)
  - thumbnail wired as both `ogImage` and the Twitter image
- **Standalone dark player:** the page uses `layout: false` (no dashboard
  chrome), renders a `bg-neutral-950` shell, and when `meta.videoUrl` is present
  shows a native `<video controls preload="metadata" :poster :src />`. When the
  clip is still exporting (`ready: false`, no `videoUrl`) it shows a "Still
  processing" placeholder. A footer link points back to `meta.appUrl`.

The auth middleware on the frontend (`app/middleware/auth.global.ts`) also
bypasses `/s/**`, matching the backend allowlist — the page is fully public on
both sides.

### Frontend: share management UI

- **`frontend/app/components/editor/MomentShareModal.vue`** — the share manager.
  Props: `open`, `libraryId`, `fileId`, `momentId`, `sharingEnabled`. On open it
  calls `api.moments.listShares(...)`; **Create** calls
  `api.moments.createShare(...)`; per-row **Revoke** calls
  `api.moments.revokeShare(...)`. Each active link is shown with Copy/Revoke. If
  `sharingEnabled` is `false`, the Create button is disabled with a message
  directing the user to library settings.
- **`frontend/app/components/editor/MomentEditForm.vue`** emits a `share` event
  (from its Share header button) that the editor page wires up to open the
  modal. The editor first checks `library.sharingEnabled` and surfaces a warning
  toast if disabled.
- **Sharing toggle** lives in `frontend/app/pages/libraries/[id]/settings.vue`,
  which `PATCH`es `/api/libraries/:id` with `{ sharingEnabled }`. The
  `Library.sharingEnabled` field flows through `shared/types/api.ts` and the
  `api.libraries` client.
- **API client** (`frontend/app/api/index.ts`, `api.moments`): `createShare`,
  `listShares`, `revokeShare`, plus the related `export` / `downloadUrl`
  helpers. Share metadata for the public page is fetched directly via `apiFetch`
  in `pages/s/[token].vue` (it is not routed through the typed `api` object).

## Security model recap

- **Opt-in per library.** No share can be created unless
  `libraries.sharing_enabled` is true; `CreateShare` enforces it server-side.
- **Bearer token.** 192 bits of randomness, base64url-encoded. Possession of the
  URL is the only credential; treat share URLs as secrets.
- **Auth bypass is narrow.** Only `/api/share/**` (and the `/s/**` SSR page) are
  public. The token resolves exactly one moment's exported clip + poster —
  nothing else.
- **404, not 403.** Revoked/unknown tokens 404 uniformly; no token-existence
  oracle.
- **Thumbnail is inline by design.** It must not redirect to the
  auth-required image proxy, or OG crawlers would fail.
- **Revocation is immediate.** `revoked_at` is set and every lookup filters
  `revoked_at IS NULL`.

## Related code

Backend:

- `backend/internal/handlers/moment_share.go` — `CreateShare`, `RevokeShare`,
  `ListShares` (authenticated, on `MomentHandler`); `baseURLFor`.
- `backend/internal/handlers/share.go` — `ShareHandler`: public `Metadata`,
  `Video`, `Thumbnail`; `resolveBase`. Registered on `/api/share` in
  `backend/cmd/server/main.go`.
- `backend/internal/middleware/auth.go` — `needsAuth` allowlists `/api/share/**`.
- `backend/internal/services/momentexport/` — `service.go`, `worker.go`:
  `CacheKey`, `CachePrefix`, the `moment:export` job that produces the MP4.
- `backend/internal/services/activity/actions.go` — `ActionMomentShared`
  (`moment.shared`).
- `backend/internal/models/models.go` — `Library.SharingEnabled`,
  `Moment`, `MomentShare`.
- Migrations: `backend/migrations/00008_*` (`sharing_enabled`),
  `00009_*` (`moments`, `moment_tags`, `moment_shares`).

Frontend:

- `frontend/app/pages/s/[token].vue` — public SSR share page (the only SSR page).
- `frontend/app/components/editor/MomentShareModal.vue` — share link manager.
- `frontend/app/components/editor/MomentEditForm.vue` — emits `share`.
- `frontend/app/pages/libraries/[id]/settings.vue` — sharing toggle.
- `frontend/app/pages/libraries/[id]/edit/[fileId].vue` — opens the share modal.
- `frontend/app/api/index.ts` — `api.moments.{createShare,listShares,revokeShare}`.
- `frontend/nuxt.config.ts` — `routeRules` SSR topology (`/s/** → ssr:true`).
- `frontend/shared/types/api.ts` — `MomentShare`, `Library.sharingEnabled`.

Configuration:

- `ALCOVES_BASE_URL` — public-facing URL used for base resolution and share
  links when no `X-Forwarded-*` headers are present.
- `ALCOVES_API_URL` (frontend) — backend target for SSR fetches from the share
  page.
