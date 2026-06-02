# Search, Activity Feed & Notifications

This document covers the three "discovery and awareness" features in Alcoves:

- **Global search** — find files and folders across every library you can see.
- **Activity feed** — a per-library log of who did what.
- **Notifications** — a global bell that surfaces relevant activity from collaborators in real time.

All three answer the same question from different angles: *what is in my libraries, and what is changing in them?*

---

## 1. Global Search

### What it does

A single search box in the dashboard header (`layouts/dashboard.vue`) lets you search across **every library you own or are a member of** at once. Submitting the form navigates to `/search?q=<query>`.

Search matches on three independent signals and merges them into one ranked result list:

1. **Filename** — files whose `name` contains the query.
2. **Folder name** — folders whose `name` contains the query.
3. **Object-detection labels** — images whose detected objects (YOLO COCO labels, e.g. `person`, `dog`, `car`) contain the query. This means you can search `dog` and find photos with a dog in them even if "dog" appears nowhere in the filename.

Each result carries a `matchReason` (`name`, `object`, or `name+object`) and, for object matches, the `matchedLabels` that hit. On the results page, results are grouped by library, rendered with thumbnails, and a double-click on a file opens the full `FilePreview` modal.

### How a user experiences it

- Type a query (minimum 2 characters on the frontend) into the header search box and press Enter.
- The `/search` page fetches `GET /api/search?q=<query>&limit=80` and groups results by library.
- Each result shows a thumbnail (image/video via the image proxy, MIME icon otherwise), its `locationPath`, any `matchedLabels` chips for object/label matches, plus size and kind badges.
- Double-clicking a file result fetches the full file (`GET /api/libraries/:id/files/:fileId`) and opens `FilePreview`.

### How it works

**Endpoint:** `GET /api/search?q=` (registered on the `/api` group; handler `SearchHandler` in `backend/internal/handlers/search.go`).

An empty `q` returns `{ query: "", totalCount: 0, results: [] }` immediately.

For a non-empty query, the handler runs **three parallel GORM raw queries**, all scoped to libraries the requesting user owns OR is a member of:

| # | Query | Detail |
|---|---|---|
| 1 | Files by filename | `name ILIKE '%q%'` |
| 2 | Folders by name | `name ILIKE '%q%'` |
| 3 | Files by object label | `object_detections.label ILIKE '%q%'`, using `DISTINCT ON (file.id)` to pick the **highest-confidence** matching label per file |

**Merge order** (this is the ranking):

1. Folders first.
2. Then filename-matched files.
3. Then object-label-matched files that were **not already** in the filename set. These are annotated with `matchedLabels[]`.

`matchReason` is computed per result: `"name"`, `"object"`, or `"name+object"` (when a file matched both a filename query and an object label). A `dedup([]string)` helper de-duplicates `matchedLabels` case-insensitively, preserving first occurrence.

**Result shape** (`GlobalSearchResult` in `shared/types/api.ts`):

```
{ id, libraryId, libraryName, parentFolderId, targetFolderId, name, kind,
  locationPath, mimeType, size, thumbnailFileId, updatedAt,
  matchReason, matchedLabels }
```

The object-label path depends on the object-detection pipeline (`object:detect` Asynq task) having populated the `object_detections` table for the library. Object detection only runs for libraries with `object_detection_enabled = true`; see the detection services for details.

### Related code (search)

- Backend handler: `backend/internal/handlers/search.go` (`search_test.go`)
- Object label source table: `object_detections` (populated by `backend/internal/services/objectdetection/`)
- API client method: `api.search.*` → `GET /api/search` (`frontend/app/api/index.ts`)
- Page: `frontend/app/pages/search.vue`
- Result rendering: thumbnails via `AlcovesImage` / image proxy, preview via `FilePreview.vue`
- Header search form: `frontend/app/layouts/dashboard.vue`
- Types: `GlobalSearchResponse`, `GlobalSearchResult` in `frontend/shared/types/api.ts`

---

## 2. Activity Feed & Notifications

### What it does

Every meaningful mutation in a library — a file uploaded, a folder renamed, a moment shared, a member joined — is recorded as a row in the `library_activities` table. That durable log powers two views:

- **Per-library feed** (`/libraries/:id/feed`): every activity in the library, including your own actions and system events. Think of it as the library's history.
- **Global bell** (header `NotificationBell` + `/notifications` page): a cross-library inbox of activity *by other people* that is relevant to you. Your own actions and system-only events are filtered out, and dismissed items stay dismissed.

Both views update in **real time** over a WebSocket and fall back to HTTP polling if the socket drops.

### Why the dual-path model

The system is deliberately split into a **durable source of truth** and a **best-effort live transport**:

- **Durable path:** the `library_activities` table. Every event is written here first. The HTTP feed/notification endpoints read from it. If anything else fails, the data is never lost — clients re-fetch on reconnect.
- **Live path:** an in-process WebSocket `Hub` plus a cross-process Redis Pub/Sub `Bus`. This is **at-most-once** delivery — a slow or disconnected client simply misses the push and recovers by re-fetching over HTTP. The live path is an optimization, never the system of record.

This is why `Hub.Broadcast` is non-blocking (it drops messages to full client buffers rather than stalling) and why emitting an activity never fails a user's request even if the bus publish fails.

### Action constants

Defined in `backend/internal/services/activity/actions.go` (mirrored 1:1 in `frontend/app/utils/activity-format.ts` and `shared/types/api.ts` as the `ActivityAction` union — adding an action requires updating **both** sides in lockstep):

| Action | Subject type | Notes |
|---|---|---|
| `file.created` | file | emitted on upload (handlers + TUS) |
| `file.deleted` | file | soft-delete; backend may batch a count in metadata |
| `folder.created` | folder | |
| `folder.renamed` | folder | only when the name actually changes |
| `folder.deleted` | folder | |
| `tag.created` | tag | |
| `moment.created` | moment | |
| `moment.shared` | share | on share-link creation |
| `member.joined` | member | invite redemption / first OAuth join |
| `member.removed` | member | |
| `system.waveform_ready` | file | **feed-only** — excluded from the global bell |
| `system.transcribe_ready` | file | **feed-only** |
| `system.video_proxy_ready` | file | **feed-only** |

`IsSystemAction(action)` returns true for any action with the `system.` prefix. System actions have a `nil` actor (they're emitted by background workers) and are excluded from the global bell fan-out (see the Bus below).

### Emitting activity

The `activity.Service` (`backend/internal/services/activity/service.go`) is injected into every handler that mutates a library. Two entry points:

- **`Emit(ctx, EmitParams) (*LibraryActivity, error)`** — synchronous. Validates `LibraryID` and `Action`, JSON-marshals `Metadata`, inserts the `library_activities` row (using `p.Tx` if a transaction is supplied), then — if a `Bus` is configured — hydrates an envelope (actor display name + library name) and publishes it to the `activity:library:<uuid>` Redis channel. Publish failures are logged, never fatal.
- **`EmitAsync(p EmitParams)`** — fire-and-forget goroutine with a detached `context.Background()`. Used by request handlers so notification delivery never blocks or fails the user's action. Background workers (transcribe, waveform, video proxy) also use `EmitAsync` for their `system.*` events.

`EmitParams`: `LibraryID` (required), `Action` (required), `ActorID *uuid.UUID` (nil = system event), `SubjectType`, `SubjectID`, `Metadata any`, `Tx *gorm.DB` (optional). Subject names are snapshotted into `metadata` so the feed survives later renames/deletes of the referenced resource.

### The Hub (in-process WebSocket rooms)

`backend/internal/services/activity/hub.go`. Maintains two room types:

- `user:<uuid>` — **auto-joined** when a client registers. Receives the user's global bell events.
- `library:<uuid>` — joined **explicitly** by an authenticated client subscribe (with an access check). Receives that library's feed events.

Methods: `Register`, `Unregister`, `Join`, `Leave`, `Broadcast(room, payload)`. **`Broadcast` is non-blocking** (`select` + `default`): if a client's send buffer is full, the message is dropped and logged. The client must recover via HTTP re-fetch on reconnect. The Hub exists only on non-worker nodes (it is `nil` in `ALCOVES_MODE=worker`).

### The Bus (cross-process Redis Pub/Sub)

`backend/internal/services/activity/bus.go`. Bridges activity across API replicas.

- **`Publish(ctx, channel, payload)`** — publishes raw envelope bytes to a Redis channel.
- **`Run(ctx, hub)`** — blocks, `PSUBSCRIBE activity:*`, and dispatches decoded envelopes into the local Hub. Must run in a goroutine (started in `main.go` as `activityBus.Run(ctx, activityHub)`); exits cleanly on context cancel.

**`dispatch` / `fanOutToUsers` logic:**

1. Unmarshal the envelope from the Redis message.
2. Broadcast to each room named in `envelope.Rooms` (the `library:<uuid>` room → drives the per-library feed).
3. For any `library:*` room, call `fanOutToUsers`: look up the library's members via the `MemberLookup` callback, then push to each member's `user:<uid>` room — **excluding the actor** (you don't notify yourself) and **skipping system actions** (those stay feed-only).

`MemberLookup` is wired during startup. The implementation lives in `NotificationsHandler.MemberLookup(libraryIDStr) []string` (`backend/internal/handlers/notifications.go`), which returns the library owner plus deduplicated members as UUID strings.

### The Client pump

`backend/internal/services/activity/client.go`. Each WebSocket connection is an `activity.Client` (`UserID`, a `coder/websocket` conn, and a 32-slot `send` channel).

`Serve(ctx, hub, accessSvc)`:
- Registers with the Hub (auto-joins `user:<uuid>`).
- Spawns a `pingLoop` (25s app-level pings, on top of protocol pings).
- Spawns a `writeLoop` (drains `send` with a 10s write timeout).
- Runs a blocking `readLoop`.

**Client → server commands (JSON):**

| `type` | Behavior |
|---|---|
| `subscribe` | `room` must be `library:<uuid>`; verified via `accessSvc.GetLibraryAccess` before `hub.Join`. Any other room name → `"unsupported room"` error. |
| `unsubscribe` | `hub.Leave(c, room)` |
| `pong` | no-op liveness signal |

**Security:** clients can only explicitly join `library:*` rooms they have access to. The `user:*` room is auto-managed by the Hub — a client cannot subscribe to another user's notifications.

### Data model

| Table | Purpose |
|---|---|
| `library_activities` | Canonical event log: `library_id`, `actor_id` (FK→users, `ON DELETE SET NULL`), `action`, `subject_type`, `subject_id`, `metadata` (jsonb), `created_at`. Source of truth. |
| `user_notification_dismissals` | Sparse per-item dismissals. Composite PK `(user_id, activity_id)`. One row per explicitly-dismissed activity. |
| `users.notifications_cleared_before` | `timestamptz` watermark for "dismiss all" — O(1) bulk clear without inserting a dismissal row per activity. JSON-omitted; server-side only. |

Indexes on `library_activities` (migration `00018_add_activity_feed.sql`):
- `(library_id, created_at DESC, id DESC)` — per-library paginated feed.
- `(actor_id, library_id, created_at DESC)` — global feed excluding own actions.
- `(subject_type, subject_id)` — history for a specific resource.

### HTTP endpoints

Handler: `NotificationsHandler` in `backend/internal/handlers/notifications.go`.

**Global (registered on `/api` via `RegisterGlobalRoutes`):**

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/notifications` | Cross-library bell feed. Filters: actor ≠ current user, action NOT LIKE `system.%`, NOT in this user's dismissals, `created_at > notifications_cleared_before`. Includes `unreadCount`. |
| GET | `/api/notifications/unread-count` | Lightweight count matching the same global filters. |
| POST | `/api/notifications/:id/dismiss` | Idempotent dismiss via `INSERT ... ON CONFLICT DO NOTHING`. Verifies library access before inserting. |
| POST | `/api/notifications/dismiss-all` | Advances `users.notifications_cleared_before` to `now()`. |
| GET | `/api/ws` | Upgrades to a WebSocket (`ServeWS`). Builds an `activity.Client` and calls `client.Serve`, whose context derives from `context.Background()` so the connection outlives the HTTP handler return. |

**Per-library (registered on `/api/libraries` via `RegisterLibraryRoutes`):**

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/libraries/:id/feed` | `ListLibrary` — **all** activities in the library, including your own and `system.*` events. **No dismissal filtering.** |

> Note: the per-library feed reads activities written by `Emit`/`EmitAsync` for that library. It is intentionally unfiltered — it's a history, not an inbox.

### Cursor pagination & hydration

- **Cursor:** `base64(JSON{ createdAt, id })`. Results ordered `DESC(created_at, id)`. Default limit 50, max 100.
- **`hydrate`:** a single batch step that loads, for a page of `LibraryActivity` rows, the actor users, the library names, and (for the global feed) per-row dismissal state — avoiding N+1 queries. The result is serialized via `envelope.ToResponse` into the shared `ActivityResponse` shape, which doubles as the WebSocket broadcast payload (so the live push is directly renderable without a client re-fetch).

`ActivityResponse` / `Activity` shape (`shared/types/api.ts`):

```
{ id, libraryId, libraryName?, actor: { id, displayName, avatarUrl? } | null,
  action, subjectType, subjectId?, metadata, createdAt, dismissed }
```

### Frontend

**Composables** (`frontend/app/composables/`):

- **`useNotifications.ts`** — global bell store backed by Nuxt `useState` (keys prefixed `notifications:`) so the bell badge and the `/notifications` page share one reactive store. Calls `GET /api/notifications?cursor=`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/dismiss`, `POST /api/notifications/dismiss-all` directly via `apiFetch`. `dismiss()` is optimistic (removes from `entries` + decrements `unreadCount` before the API call). `prependLive(activity)` is an idempotent head-insert that increments `unreadCount`.
- **`useNotificationsSocket.ts`** — singleton-per-app WebSocket via `useState` (key `notifications:socket-state`). Connects to `ws[s]://<window.location.host>/api/ws` (same-origin; Nitro proxies to the Go API in dev). Protocol: server `{type:"ping"}` → client `{type:"pong"}`; `subscribed`/`unsubscribed`/`error` ignored; payloads with no `type` field are dispatched to all registered `onActivity` handlers. **Reconnect:** exponential backoff with jitter capped at 30s; after 3 failures it starts a 60s poll fallback via `useNotifications().refreshUnreadCount()`. **Heartbeat:** 35s inactivity timeout checked every 10s; on timeout it force-closes to trigger a reconnect. `connect()` returns early on the server. Rooms: `user:{id}` auto-joined by the app shell; `library:{id}` subscribed/unsubscribed by pages via `subscribeRoom` / `unsubscribeRoom`.
- **`useLibraryFeed.ts`** — paginates `GET /api/libraries/:id/feed` by cursor. Does **not** self-subscribe to the WebSocket — the page wires that via `useNotificationsSocket().subscribeRoom("library:<id>")`. Exposes idempotent `prependLive(activity)` (dedupes by `id`).

**Components** (`frontend/app/components/notifications/`):

- **`NotificationBell.vue`** — the header bell. On mount: `useNotificationsSocket().connect()`, registers an `onActivity` handler that calls `useNotifications().prependLive`, and `refreshUnreadCount()`. Renders an unread badge (capped display `"99+"`) and wraps `NotificationDropdown` in a `UPopover`.
- **`NotificationDropdown.vue`** — popover body. Calls `noti.loadFirst()` when empty, renders up to 20 groups from `groupActivities(noti.entries)`, "See all notifications" link to `/notifications` when `hasMore`, and a "Dismiss all" action. Imports `useRouter` explicitly from `#app/composables/router` (the Nuxt auto-import source) to avoid the `vue-router` mock mismatch documented in CLAUDE.md.
- **`NotificationItem.vue`** — a single grouped row. Props `group`, `showLibraryName?`, `showDismiss?`. Emits `dismiss(ids[])` and `navigate(href)`. Renders as `<a>` when `formatted.href` exists, else `<div>`. Shows the actor `UserAvatar` (or an icon for system events), a hover-reveal dismiss `×`, and relative time.

**Pages:**

- `frontend/app/pages/notifications.vue` — global feed. On mount: `useNotifications().loadFirst()` + connect socket; `socket.onActivity(a => noti.prependLive(a))`. Groups by library, then time-buckets via `groupActivities`. Cursor "Load older" via `noti.loadMore()`. Per-item dismiss + "Dismiss all". Renders `NotificationItem` with `show-dismiss: true`.
- `frontend/app/pages/libraries/[id]/feed.vue` — per-library feed. On mount: `useLibraryFeed(libraryId).loadFirst()`; connect socket and `subscribeRoom("library:<id>")`; `onActivity` prepends events whose `libraryId` matches. Groups via `groupActivities`, renders `NotificationItem` **without** dismiss. Cursor "Load older".

**Presentation util — `frontend/app/utils/activity-format.ts`:**

- `ActivityGroup = { head, items, count }` — a collapsed display row; `head` is the most recent entry; `count` sums `metadata.count` from backend-batched delete events.
- `groupActivities(rows)` — merges consecutive activities sharing `(actor.id, action, libraryId, parentFolderId)` within a **5-minute window**, up to 20 per group. Non-mergeable actions (`folder.renamed`, `folder.deleted`, all `member.*` and `system.*`) always start a new group. Input must be DESC by `createdAt`.
- `formatActivity(group)` → `{ icon, text, href }`. Deep links:
  - Files → `/libraries/:id?fileId=:fileId`
  - Folders → `/libraries/:id?folderId=:folderId` (or library root)
  - Moments → `/libraries/:id/edit/:fileId?momentId=:momentId`
  - Tags → `/libraries/:id/tags`
  - Members → `/libraries/:id/settings`
  - System events → the file deep link
- `relativeTime(iso)` — zero-dependency compact formatter (`"5m"`, `"3h"`, `"2d"`, `"1w"`, `"3mo"`, `"1y"`).

### End-to-end data flow (a member uploads a file)

1. Member uploads a file. `FileHandler` (or `TusHandler`) creates the `files` row and calls `activitySvc.EmitAsync` with `file.created`.
2. `Emit` inserts a `library_activities` row (durable).
3. With a Redis Bus configured, it publishes an envelope to `activity:library:<libId>`.
4. Every API replica's `Bus.Run` receives it via `PSUBSCRIBE activity:*` and dispatches:
   - Broadcasts to the `library:<libId>` Hub room → any client viewing that library's **feed** gets the live event.
   - `fanOutToUsers` looks up library members and pushes to each member's `user:<uid>` room — **except the uploader**, and only because `file.created` is not a `system.*` action.
5. Each recipient's `NotificationBell` `onActivity` handler calls `prependLive`, bumping the unread badge.
6. If a recipient's socket was down, they miss the push — but `GET /api/notifications` on next load returns the same event from `library_activities` (subject to dismissal + watermark filters).

### Related code (activity & notifications)

- Service package: `backend/internal/services/activity/` — `actions.go`, `service.go`, `hub.go`, `bus.go`, `client.go`, `envelope.go` (+ `*_test.go`, using `miniredis`)
- HTTP handler: `backend/internal/handlers/notifications.go` (`notifications_test.go`)
- Migration: `backend/migrations/00018_add_activity_feed.sql`
- Models: `LibraryActivity`, `UserNotificationDismissal`, `User.NotificationsClearedBefore` in `backend/internal/models/models.go`
- Wiring: `backend/cmd/server/main.go` (`activity.NewHub`, `activity.NewBus`, `activity.NewService`, `activityBus.Run`)
- Composables: `frontend/app/composables/useNotifications.ts`, `useNotificationsSocket.ts`, `useLibraryFeed.ts`
- Components: `frontend/app/components/notifications/NotificationBell.vue`, `NotificationDropdown.vue`, `NotificationItem.vue`
- Pages: `frontend/app/pages/notifications.vue`, `frontend/app/pages/libraries/[id]/feed.vue`
- Format util: `frontend/app/utils/activity-format.ts`
- Types: `Activity`, `ActivityAction`, `LibraryFeedResponse`, `NotificationsResponse`, `UnreadCountResponse` in `frontend/shared/types/api.ts`

### Configuration

The live path uses the same Redis/Dragonfly instance as the Asynq job queue:

- `ALCOVES_QUEUE_HOST` / `ALCOVES_QUEUE_PORT` / `ALCOVES_QUEUE_PASSWORD` — Redis-compatible queue used by the activity `Bus`. Without it, `Emit` still writes to `library_activities` (durable feed works) but there is no cross-process live fan-out.
- `ALCOVES_MODE` — `api` / `all` nodes host the Hub and serve `/api/ws`; `worker` nodes do not create a Hub (they still `Emit` via the Bus).

In dev, the frontend connects to `/api/ws` same-origin and Nitro proxies it to the Go API (`/api/**` proxy has `ws: true` in `nuxt.config.ts`). In production behind a reverse proxy, ensure WebSocket upgrade headers are forwarded for `/api/ws`.
