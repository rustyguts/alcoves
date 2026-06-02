# Files, Folders, Tags & Resumable Uploads

This is the heart of Alcoves: the library browser where you organize, find,
tag, upload, and manage your files. This document covers the full content-
management experience end to end — how the directory listing is built and
paginated, how files and folders are created/renamed/moved/trashed/purged,
how tags work, and how the resumable upload pipeline gets bytes from your
browser into storage and kicks off all the downstream media processing.

---

## What you can do

- **Browse a library** as a merged list of folders and files, sorted folders-
  first then alphabetically, with breadcrumb navigation into subfolders.
- **Switch view modes** between a table ("file") view and a grid ("card")
  view. Your choice persists in `localStorage`.
- **Scroll forever** — listings are cursor-paginated and fetched lazily via an
  `IntersectionObserver` sentinel as you scroll.
- **Upload files** by drag-and-drop onto the page or via a file picker. Uploads
  are resumable (TUS), run 3-at-a-time, survive page reloads, and warn you
  before you close the tab mid-upload.
- **Organize** with folders (create, rename, move with cycle protection,
  recursive delete) and color-coded tags (auto-assigned colors, full-replace
  sync per file/folder).
- **Select** entries with click / Ctrl-click / Shift-click range select across
  the mixed folder+file list, then run bulk actions (move, tag, delete,
  download ZIP, transcribe, audio-detect).
- **Trash and restore** — deletes are soft (trashed), recoverable from the
  Trash view, and only become permanent via an explicit Purge.
- **Spot duplicates** — files that share a content hash with another file in
  the library show a duplicate badge.

---

## How it works

### The listing engine (`services/files/listing.go`)

A library directory is a **merge of two tables** — `folders` and `files` —
presented as one paginated stream. The work lives in
`files.Service.ListLibraryFiles(libraryID, c)`, called by the `List` handler.

**Endpoint:** `GET /api/libraries/:id/files`

Query parameters:

| Param | Meaning |
|---|---|
| `folder=<uuid>` | Browse a subfolder (ignored in trash view) |
| `trashed=true` | Switch to the trash view |
| `limit=<int>` | Page size, clamped to `[1, MaxLimit=200]`, default `DefaultLimit=50` |
| `cursor=<base64>` | Opaque pagination cursor |

The response is a `PaginatedFiles`:

```
{ entries: LibraryEntry[], nextCursor: string|null, totalCount, breadcrumbs, currentFolderId }
```

#### Cursor pagination

The cursor is a base64-encoded JSON `CursorPayload`:

```go
type CursorPayload struct {
    KindRank int    // 0 = folder, 1 = file
    SortName string // lower(name)
    Id       string // tiebreaker UUID
}
```

Ordering is **folders before files** (by `kindRank`), then within each kind by
`lower(name) ASC, id ASC`. The sort name is lowercased so ordering is case-
insensitive. The folder query's cursor condition is
`(lower(name) > ? OR (lower(name) = ? AND id > ?))`; once the cursor has
`kindRank=1` (i.e. pagination has moved past all folders), the folder clause
becomes `AND false` so no further folders are emitted.

Folder and file rows are fetched with separate parameterized raw-SQL queries
(`buildFolderQueries` / `buildFileQueries`, all `?` placeholders — no string
interpolation), then **merge-sorted in memory** by the same `(kindRank,
lower(name), id)` key, truncated to `limit`, and a `hasMore` flag drives
whether a `nextCursor` is encoded.

#### Derived files are hidden

The file query always excludes rows where `source_file_id IS NOT NULL`. Those
are derivatives — video proxies and generated thumbnails — and never appear as
browsable entries.

#### Breadcrumbs (recursive CTE)

For a non-trash subfolder view, `getFolderBreadcrumbs` runs a
`WITH RECURSIVE` CTE starting at the target folder (depth 0) and walks up
`parent_folder_id`, capped at depth 50 to guard against cycles. The result is
returned root → leaf and surfaced as `breadcrumbs`.

#### Batch hydration (no N+1)

After the page of entries is assembled, the service does a small fixed number
of batch queries:

- **Tags** — one join query each over `file_tags JOIN tags` and
  `folder_tags JOIN tags` for all IDs on the page.
- **Owners** — one `users WHERE id IN ?` query, attached as `owner`.
- **Duplicates** — a single `EXISTS` subquery computes a `hasDuplicates` flag
  for every file on the page that shares its `hash` with another non-trashed
  source file in the same library.

#### Trash view semantics

When `trashed=true`, only **top-level** trashed items are shown — items whose
parent is *not also* trashed (enforced by `NOT EXISTS` subqueries). Nested
trashed items surface under their (trashed) parent rather than cluttering the
root list.

- **Folders:** `trashed_at IS NOT NULL` and parent not also trashed.
- **Files:** `trashed_at IS NOT NULL` and `source_file_id IS NULL` and parent
  folder not trashed.

In trash view each folder also gets a `trashFileCount` — a recursive count of
trashed descendant files. `getTrashedFolderFileCounts` loads the folder tree,
builds a parent→children map in Go, does a BFS subtree expansion per root, and
runs one grouped count query.

#### Input validation

- `normalizeFolderID` rejects any non-UUID `folder` value with HTTP 400 —
  prevents traversal/injection via the path param.
- `parseCursor` validates the decoded UUID, requires `kindRank ∈ {0,1}`, and
  caps `SortName` length at `maxSortNameLen = 500`.

### File operations (`handlers/file.go`)

`FileHandler` registers these under `/api/libraries`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/:id/files` | Paginated listing (delegates to listing service) |
| POST | `/:id/files` | Streaming upload |
| GET | `/:id/files/:fileId` | Metadata, or `?inline=true` to stream bytes |
| PATCH | `/:id/files/:fileId` | Rename / move (`name`, `parentFolderId`) |
| DELETE | `/:id/files/:fileId` | Soft-delete (single or bulk via `fileIds`) |
| POST | `/:id/files/purge` | Permanent deletion |
| POST | `/:id/files/restore` | Restore from trash to root |

**Streaming upload** (`Upload`): reads `X-Upload-Name`, `X-Upload-Mime-Type`,
and `X-Upload-Folder-Id` headers, streams the request body through
`filehash.NewHashingReader` straight to storage (computing the SHA-256 inline),
then creates the `File` record. For images it enqueues face/object detection
when the library has those enabled; for video it enqueues proxy, thumbnail,
and waveform jobs. It runs `filehash.FindDuplicates` and emits an
`ActionFileCreated` activity. (Most uploads go through TUS — see below — but
this simple streaming path also exists.)

**Get with HTTP Range** (`Get`): metadata by default; with `?inline=true` it
streams the blob with full HTTP Range support, returning `206 Partial Content`.
Range parsing uses the regex `bytes=(\d+)-(\d*)`.

**Soft-delete** (`Delete`): sets `trashed_at`. Accepts a single `:fileId` or a
JSON body `{ fileIds: [...] }` for bulk. Emits `ActionFileDeleted`.

**Purge** (`Purge`): permanent and irreversible. Three modes by request body:
explicit `fileIds`, explicit `folderIds`, or an empty body meaning "all
trashed". The order matters for safety:

1. Delete storage blobs **first** (fail-fast — if a blob delete errors, the DB
   rows survive).
2. Clean derived files (proxies/thumbnails identified by `source_file_id`).
3. Delete `file_tags` / `folder_tags` join rows.
4. Delete the file/folder DB records inside a transaction.
5. Post-transaction, best-effort cleanup of face- and object-detection data
   (errors logged, do not fail the request).

**Restore** (`Restore`): un-trashes files and moves them to root
(`parent_folder_id = NULL`).

`fileToJSON` serializes the rich `File` model including every async-pipeline
status block (`proxyStatus/Progress/EtaSeconds`, transcribe/audioDetect/
waveform status+version fields), `thumbnailFileId`, `sourceFileId`, `hash`,
`duplicateOfFileIds`, and `hasDuplicates`.

### Folder operations (`handlers/folder.go`)

`FolderHandler` registers under `/api/libraries`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/:id/folders` | All non-trashed folders (owner preloaded) |
| POST | `/:id/folders` | Create (validates parent belongs to library) |
| PATCH | `/:id/folders/:folderId` | Rename |
| DELETE | `/:id/folders/:folderId` | Recursive soft-delete |
| POST | `/:id/folders/:folderId/move` | Move with cycle detection |
| POST | `/:id/folders/restore` | Recursive restore |

- **Create** validates the parent folder belongs to the same library and emits
  `ActionFolderCreated`.
- **Update** renames; emits `ActionFolderRenamed` only when the name actually
  changed (snapshot comparison).
- **Delete** soft-deletes the folder, then recursively soft-deletes descendant
  folders and all files within them (BFS via `getDescendantFolderIDs`). Emits
  `ActionFolderDeleted`.
- **Move** runs `assertMoveParentValid`: it walks up the destination's ancestor
  chain and rejects the move if any ancestor equals the folder being moved —
  preventing a folder from being nested inside itself.
- **Restore** un-trashes the folder, its descendant folders, and their files,
  moving the restored root to top level.

### Tags (`handlers/tag.go`)

`TagHandler` registers under `/api/libraries`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/:id/tags` | List tags |
| POST | `/:id/tags` | Create (auto-color) |
| PATCH | `/:id/tags/:tagId` | Rename / recolor |
| DELETE | `/:id/tags/:tagId` | Delete |
| PUT | `/:id/files/:fileId/tags` | Replace a file's tags |
| PUT | `/:id/folders/:folderId/tags` | Replace a folder's tags |

- **Auto-color**: on create, a color is assigned from `TagColorPalette` (12
  predefined hex colors) by cycling through the not-yet-used colors; if all 12
  are in use it wraps to the first. The same 12-color palette is mirrored on
  the frontend as `TAG_COLOR_PALETTE` in `shared/tag-colors.ts`.
- **Sync is full replacement**: `SyncFileTags` / `SyncFolderTags` delete all
  existing associations for the entity and insert the new set, returning the
  updated tag list. The frontend `useLibraryTags` toggle helpers translate
  add/remove gestures into these full-replacement `PUT` calls.
- Emits `ActionTagCreated` on create.

The dedicated **Tags page** (`pages/libraries/[id]/tags.vue`, manager-only)
adds CRUD UI plus a usage-count column computed by a client-side BFS crawl over
`GET /api/libraries/:id/files` (200 per page, cursor-based) counting how often
each tag is assigned.

---

## TUS resumable uploads

Most uploads flow through the **TUS 1.0.0** resumable protocol, which lets a
large file survive flaky networks and page reloads by uploading in chunks and
tracking a server-side offset.

### Backend (`handlers/tus.go`)

`TusHandler` registers under `/api/tus`:

| Method | Path |
|---|---|
| POST | `` / `/` (create) |
| HEAD | `/:id` (query offset) |
| PATCH | `/:id` (append chunk) |
| OPTIONS | `` / `/` / `/:id` |

- **Protocol:** version `1.0.0`; advertised extensions
  `creation,creation-with-upload`.
- **Create** requires `Tus-Resumable: 1.0.0`, parses `Upload-Metadata`
  (`libraryId`, `filename`, `mimeType`, `folderId`, `lastModified`), and gates
  access via `checkLibraryAdmin` — the uploader must be the library owner or
  have the `admin` role in `library_members`. It creates a staging file at
  `{dataDir}/.tus-uploads/{uploadId}`, optionally writes initial body bytes
  (creation-with-upload), and responds `201` with `Location: /api/tus/{id}` and
  `Upload-Offset`.
- **Patch** validates `Content-Type: application/offset+octet-stream` and the
  offset, then appends to the staging file. On completion it calls
  `finishUpload`.
- **`Upload-Metadata` parsing** (`parseTusMetadata`): `key base64val,key
  base64val` format using **`base64.StdEncoding`** (not URL-safe).

### The finishUpload pipeline

When the last chunk lands, `finishUpload` streams the staging file through
`filehash.NewHashingReader` into permanent storage, creates the `File` record
(with `Hash` and optional `OriginalCreatedAt` from the `lastModified` ms
timestamp), and **triggers downstream jobs** based on the library's settings
and the file's MIME type:

- **Images** → face detection + object detection (if enabled on the library).
- **Video** → thumbnail, proxy (when `videoproxy.ShouldCreateProxyByDefault`
  returns true — i.e. not already an MP4/WebM/Ogg), waveform, transcription,
  and audio-event detection.

Each triggered job sets the corresponding status column on the file. Finally it
runs `filehash.FindDuplicates`, and if the new file collides with an existing
one it sets the **`X-Alcoves-Duplicate-Count`** response header. The staging
file is then removed.

### Staging lifecycle & orphan cleanup

A background goroutine runs every hour (`tusCleanupInterval`) and removes
uploads older than 24h (`tusUploadMaxAge`). `cleanOrphanedStagingFiles` deletes
staging files that have no matching in-memory entry — this reclaims storage
after a server restart drops the in-memory `uploads` map.

### Frontend upload queue (`useUploadQueue.ts`)

A module-level singleton built on [tus-js-client](https://github.com/tus/tus-js-client):

- **Endpoint:** `/api/tus`. **Concurrency:** `CONCURRENCY = 3`. **Chunk
  size:** 50 MB. **Retries:** `MAX_RETRIES = 3` with TUS retry delays
  `[0, 1000, 3000, 5000, 10000]` ms.
- **Metadata sent:** `libraryId`, `filename`, `mimeType` (via
  `getMimeTypeFromFilename`), `lastModified`, and `folderId` when set.
- `onBeforeRequest` sets `xhr.withCredentials = true` so the session cookie
  rides along cross-origin.
- `onShouldRetry` suppresses retries on `401/403/404/413` (auth/permission/
  payload-too-large are not transient).
- `onAfterResponse` reads **`X-Alcoves-Duplicate-Count`**; if `> 0` it shows a
  warning toast.
- `drainQueue()` keeps up to 3 slots filled, preferring `pending` items over
  `error` retries. A speed sampler accumulates progress deltas every 500 ms to
  produce `uploadSpeed` (bytes/sec). Completed items are removed after
  `DONE_CLEANUP_MS = 2000`.
- `app.vue` registers a `beforeunload` handler that cancels navigation while
  `hasInFlightUploads` is true, so you don't lose an upload by closing the tab.

`UploadModal.vue` is the file picker (calls `addFiles`), and
`UploadProgress.vue` is the persistent floating bottom-right panel showing
per-file progress, errors with Retry/Remove, and the aggregate speed.

### Drag-and-drop (`useFileDrop.ts`)

`useFileDrop({ enabled, onDrop })` provides spread-ready
`dropZoneProps` (`onDragenter/over/leave/drop`) plus `isOverDropZone` and a
`dragDepth` counter that prevents flicker when the cursor crosses child
elements. `extractDroppedFiles` reads `dataTransfer.files` and uses
`webkitGetAsEntry()` only to *exclude* directory entries — it deliberately
avoids `getAsFile()`, which yields zero-size File objects on Safari/Linux
Chromium.

---

## Content hashing & duplicate detection (`services/filehash/`)

Every file gets a SHA-256 content hash, used to surface duplicates.

- **`HashingReader`** (`reader.go`) wraps an `io.Reader` with
  `io.TeeReader(r, sha256.New())`; `HexSum()` returns the hex digest once all
  bytes have been consumed. Both the streaming and TUS upload paths read
  through it, so hashing is free (no extra pass).
- **Async backfill** — task type `file:hash`. `TaskHandler.ProcessTask` skips
  files that already have a hash, otherwise streams the blob through a
  `HashingReader` into `io.Discard` and writes `files.hash`.
  `EnqueueUnhashedFiles` (exposed to admins via `POST /api/admin/backfill-hashes`)
  enqueues a hash job for every `hash IS NULL AND trashed_at IS NULL` file.
- **`FindDuplicates`** (`dedup.go`): returns IDs of other non-trashed *source*
  files (`source_file_id IS NULL`) in the same library sharing a hash —
  used on single-file views.
- **`HasDuplicatesByID`**: batch duplicate detection for list endpoints via a
  single raw-SQL `EXISTS` subquery (avoids N+1). This is what powers the
  `hasDuplicates` flag in the listing engine.

Both dedup queries exclude trashed and derived files from consideration. The
supporting index is `files_library_hash_idx ON files(library_id, hash) WHERE
hash IS NOT NULL AND trashed_at IS NULL` (migration `00014`).

---

## The library browser frontend

### `useLibraryExplorer.ts`

The central state manager for `pages/libraries/[id]/index.vue`. It loads
library metadata, members, the paginated entries, tags, and folders, and
exposes ~35 reactive values. Highlights:

- **View modes:** `viewMode` (`files | trash | tags | users`) and
  `entryViewMode` (`file | card`). The latter persists to `localStorage` key
  `alcoves.library.entry-view`.
- **Cursor pagination:** `loadMore()` appends the next page; `resetAndFetch()`
  resets and re-fetches. A `silent` option suppresses the loading state (used
  after uploads) and `preserveEntries` keeps existing entries during refresh.
- **View cache:** a `reactive` record keyed by
  `"<libId>:files:<folderId|__root__>"` or `"<libId>:trash"` restores entries
  on folder back-navigation to avoid a flash-of-empty.
- **Selection:** `selectedFiles` / `selectedFolders` are `Set<string>`, with a
  `lastClickedIndex` anchor enabling Shift-click range selection across the
  flat (folders + files) `entries` array. Click = single select, Ctrl/Meta-
  click = toggle, Shift-click = range.
- **Permissions:** `canManageLibrary` is true when the user is the owner (by
  `ownerId`) or has role `owner`/`admin`; `canManageUsers` additionally
  requires the library not be the default personal library.

### Drag-and-drop move

The index page implements HTML5 drag to move files into folders: dragging file
entries onto a folder card issues `PATCH /api/libraries/:id/files/:fileId
{ parentFolderId }` per file, with a `dropTargetFolderId` highlight. The
entry components (`LibraryEntryCard.vue`, `LibraryEntriesTable.vue`) expose the
full DnD event surface but hold no DnD logic — it all lives in the page.

### Infinite scroll & rendering

An `IntersectionObserver` on a bottom sentinel calls `loadMore()` when visible.
Entries render via `LibraryEntriesGrid.vue` (card mode, split into folder and
file sections) or `LibraryEntriesTable.vue` (table mode), with
`LibraryEntriesSkeleton.vue` during loading and `LibraryEmptyState.vue` when
empty. Each entry shows tag dots, a duplicate badge when `hasDuplicates`, and an
inline rename `<input>`. Thumbnails route through the authenticated image proxy
via `AlcovesImage.vue`.

### Supporting composables

- **`useLibraryFolderActions.ts`** — create/move/delete folder state +
  actions. `moveDestinationOptions` excludes the moving folder and all its
  descendants (via `collectDescendantIds`) so you can't move a folder into
  itself; the `__root__` sentinel maps to a `null` parent.
- **`useLibraryTags.ts`** — tag CRUD plus `toggleTagForFiles` /
  `toggleTagForFolder`, which compute the add-vs-remove decision and issue the
  full-replacement `PUT .../tags` syncs.

### Context menu & bulk actions

The browser's `UContextMenu` adapts to context (trash view, read-only,
multi-select, single folder, single file) and exposes open, download, download
ZIP, rename, move, editor (video), transcribe, audio-detect, tag submenu, and
delete. Bulk transcribe / audio-detect post to
`/api/libraries/:id/files/bulk-transcribe` and `.../bulk-audio-detect` (an
empty `fileIds` means "all eligible files").

---

## Data model

| Table | Relevant columns |
|---|---|
| `files` | `id, library_id, parent_folder_id, name, mime_type, size (bigint), owner_id, duration, width, height, source_file_id, thumbnail_file_id, hash, original_created_at, trashed_at` + async pipeline status blocks |
| `folders` | `id, library_id, parent_folder_id, owner_id, name, trashed_at` |
| `tags` | `id, library_id, name, color` (unique `(library_id, name)`) |
| `file_tags` / `folder_tags` | junction rows, unique per `(file_id|folder_id, tag_id)` |
| `library_members` | `library_id, user_id, role` (gates TUS admin upload) |

Soft-delete is `trashed_at TIMESTAMPTZ` on `files` and `folders`; composite
indexes include `trashed_at` to keep trash-filtered browsing fast
(`files_library_parent_trash_name_idx`,
`folders_library_trash_parent_name_idx`).

---

## Related code

**Backend**

- `backend/internal/services/files/listing.go` — paginated merge listing,
  cursor, breadcrumbs, trash semantics, hydration
- `backend/internal/handlers/file.go` — upload, get/range, rename/move,
  soft-delete, purge, restore
- `backend/internal/handlers/folder.go` — folder CRUD, recursive delete,
  cycle-safe move, restore
- `backend/internal/handlers/tag.go` — tag CRUD + full-replacement sync
- `backend/internal/handlers/tus.go` — TUS protocol, staging lifecycle,
  finishUpload pipeline, orphan cleanup
- `backend/internal/services/filehash/` — `reader.go` (HashingReader),
  `dedup.go` (FindDuplicates / HasDuplicatesByID), `worker.go`, `bulk.go`
- `backend/migrations/00007_*`, `00014_*` — file hash column + dedup index

**Frontend**

- `frontend/app/pages/libraries/[id]/index.vue` — library browser
- `frontend/app/pages/libraries/[id]/tags.vue` — tag management
- `frontend/app/composables/useLibraryExplorer.ts` — browser state
- `frontend/app/composables/useUploadQueue.ts` — TUS upload queue
- `frontend/app/composables/useFileDrop.ts` — drag-and-drop zone
- `frontend/app/composables/useLibraryFolderActions.ts` — folder actions
- `frontend/app/composables/useLibraryTags.ts` — tag actions
- `frontend/app/components/library/` — entry cards, table, grid, skeleton,
  empty state, tag color picker
- `frontend/app/components/UploadModal.vue`, `UploadProgress.vue`
- `frontend/shared/tag-colors.ts` — shared `TAG_COLOR_PALETTE`
- `frontend/shared/types/api.ts` — `LibraryFile`, `LibraryFolder`,
  `LibraryEntry`, `PaginatedFiles`, `LibraryTag`
