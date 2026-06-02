# Libraries, Roles & Access Control

Libraries are the unit of ownership and sharing in Alcoves. Every file, folder,
tag, moment, person, and activity event belongs to exactly one library, and a
library has exactly one owner. Sharing a library with another user is done by
granting them membership at a role — there is no per-file ACL. This document
covers the full lifecycle of libraries (CRUD), the role-based access control
(RBAC) model, how the access rules are enforced in middleware and the access
service, member management, and the invite-link flow used to add new members.

## At a glance

- A **library** is owned by one user (`libraries.owner_id`) and may have many
  **members** (`library_members`), each with a role.
- **Roles**: `owner` (implicit, the owner), `admin`, `viewer`.
- Every user gets a personal **default library** named `My Library` at
  registration. Default libraries are personal-only: they can never be shared
  and cannot be deleted.
- Read access (GET/HEAD/OPTIONS) requires `viewer` or higher. Writes
  (POST/PATCH/PUT/DELETE) require `admin` or higher. This is enforced once, in
  middleware, before any library-scoped handler runs.
- New members join via **invite links**: a library admin mints a tokenized URL
  with optional max-uses and expiry; an authenticated user redeems it to become
  a `viewer`.

---

## Libraries

### What a library is

A library groups a user's media and the people they collaborate with. The
`libraries` table (created in migration `00001`, extended by later migrations)
carries the per-library feature flags:

| Column | Meaning |
|---|---|
| `id` | UUID primary key |
| `name` | Display name |
| `emoji` | Optional emoji icon shown in the sidebar/header |
| `is_default` | `true` for the auto-created `My Library` (one per user) |
| `owner_id` | FK → `users.id`; the single owner |
| `face_recognition_enabled` | Gates the `face:detect` job pipeline |
| `object_detection_enabled` | Gates the `object:detect` job pipeline |
| `sharing_enabled` | Required before any moment share link can be created |

The corresponding Go model is `models.Library` in
`backend/internal/models/models.go`; the frontend type is `Library` in
`frontend/shared/types/api.ts`.

### The default "My Library"

Every account is created with a personal default library. This happens
atomically as part of registration so there are never orphaned users without a
library:

- `AuthHandler.Register` (`backend/internal/handlers/auth.go`) creates the
  `User`, an `Account(provider=credentials)`, and a `Library("My Library")`
  inside a single `db.Transaction` — a failure at any step rolls back all rows.
- `OAuthHandler.GoogleCallback` (`backend/internal/handlers/oauth.go`) follows
  the same atomic `user + account + library` pattern for first-time Google
  sign-ins.

The default library is marked `is_default = true`. As described under Access
rules below, default libraries are **personal**: even if a `library_members`
row somehow existed for a non-owner, the access service refuses to honor it.

### Library CRUD endpoints

All routes are registered by `LibraryHandler`
(`backend/internal/handlers/library.go`) on the `/api/libraries` group. The
handler holds `{db, accessSvc, faceSvc, objSvc}`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/libraries` | List owned + member libraries |
| POST | `/api/libraries` | Create a new (non-default, non-shared) library |
| GET | `/api/libraries/:id` | Get one library |
| PATCH | `/api/libraries/:id` | Update name/emoji/feature flags |
| DELETE | `/api/libraries/:id` | Delete (owner only; restricted) |

#### List — `GET /api/libraries`

Returns every library the user **owns** plus every library they are a **member**
of. For each row the handler injects the caller's computed access and returns:

```json
{
  "id": "…",
  "name": "…",
  "emoji": "📷",
  "isDefault": false,
  "faceRecognitionEnabled": false,
  "objectDetectionEnabled": false,
  "sharingEnabled": false,
  "ownerId": "…",
  "currentUserRole": "owner",
  "canManageUsers": true,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`currentUserRole` (`"owner" | "admin" | "viewer"`) comes from the resolved
`LibraryAccess.Role`, and `canManageUsers` is `IsAdmin && !IsDefault` — i.e. you
can manage members only on a collaborative (non-default) library where you are
admin or owner.

This endpoint backs the sidebar in `layouts/dashboard.vue`, which fetches
`GET /api/libraries`, renders the single `isDefault: true` library at top, and
lists the rest below.

#### Create — `POST /api/libraries`

Creates a library that is explicitly **not default** and **not shared**
(`is_default = false`, `sharing_enabled = false`). The creating user becomes the
owner with full access. The dashboard sidebar's `+` button calls this with
`{ name: "Untitled Library" }`, then refreshes the list via
`useLibrariesList().refreshLibraries()`.

#### Update — `PATCH /api/libraries/:id`

Accepts any of `name`, `emoji`, `faceRecognitionEnabled`,
`objectDetectionEnabled`, `sharingEnabled`. Two of these have side effects:

- Toggling **`faceRecognitionEnabled` to `true`** fires a goroutine calling
  `faceSvc.EnqueueExistingImages(libraryID)`, which backfills face detection
  across the library's existing images (`face:detect` tasks).
- Toggling **`objectDetectionEnabled` to `true`** likewise fires
  `objSvc.EnqueueExistingImages(libraryID)` (`object:detect` tasks).

`sharingEnabled` gates whether members can mint public moment share links (see
the moment-share handler, which rejects share creation when
`library.sharing_enabled` is false).

These toggles are surfaced in the library settings page
(`pages/libraries/[id]/settings.vue`), which also offers "reprocess" actions
(`POST /api/libraries/:id/people/reprocess`,
`POST /api/libraries/:id/objects/reprocess`).

#### Delete — `DELETE /api/libraries/:id`

Owner-only and intentionally restrictive. It is **blocked** when:

- the library is the default library (`is_default = true`), or
- the library is non-empty (`files.count > 0`).

The settings page mirrors these constraints client-side: the "Delete Library"
action is only enabled when `isDefault === false && ownerId === userId &&
fileCounts.totalCount === 0 && trashedCount === 0`.

---

## Roles & the access model

### The three roles

Defined in `backend/internal/services/access/access.go` as the
`LibraryAccessRole` string enum:

| Role | How you get it | Capabilities |
|---|---|---|
| `owner` | You are `libraries.owner_id` | Everything, including delete, member management, and reprocess/backfill |
| `admin` | A `library_members` row with `role = "admin"` (collaborative libraries only) | Read + write + member management; cannot delete the library |
| `viewer` | A `library_members` row with `role = "viewer"` (the role granted by invites) | Read-only |

The resolved access is returned as a `LibraryAccess` struct:

```go
type LibraryAccess struct {
    LibraryID   uuid.UUID
    LibraryName string
    OwnerID     uuid.UUID
    IsDefault   bool
    Role        string  // RoleOwner | RoleAdmin | RoleViewer
    IsOwner     bool
    IsAdmin     bool    // true for owner and admin
}
```

### Access rules

`Service.GetLibraryAccess(userID, libraryID)` is the single source of truth. It
returns `*LibraryAccess` or `nil` (nil = no access, surfaced as 404). The rules,
in order:

1. **Owner always wins.** If the user is the library's `owner_id`, they get
   `Role = "owner"` with both `IsOwner = true` and `IsAdmin = true`. No
   membership lookup needed.
2. **Default / personal libraries are never collaborative.** If the library is
   `is_default = true` and the caller is *not* the owner, the function returns
   `nil` regardless of any `library_members` row. Personal libraries simply
   cannot be shared.
3. **Members get their role from `library_members`.** For a non-owner on a
   non-default library, the role is read from `library_members.role`. A
   `role = "admin"` row sets `IsAdmin = true`; `viewer` does not.

A not-found library returns `nil` (no error), which callers turn into a 404.

### The Require* helpers

The access service exposes Echo-aware guards used by handlers that live outside
the standard middleware path (e.g. the file proxy):

| Function | Behavior |
|---|---|
| `RequireLibraryAccess(c, userID, libraryID)` | 500 on DB error, **404** if access is nil (viewer+) |
| `RequireLibraryAdmin(c, userID, libraryID)` | As above, then **403** if `!IsAdmin` |
| `RequireCollaborativeLibraryAdmin(c, userID, libraryID)` | As `RequireLibraryAdmin`, then **400** if `IsDefault` (a personal library) |

Note the deliberate 404 (not 403) for non-members: it avoids leaking the
existence of libraries the caller can't see.

### Middleware enforcement

`LibraryAccessMiddleware` (`backend/internal/middleware/library_access.go`) is
registered globally, right after `AuthMiddleware`, in
`backend/cmd/server/main.go`. It only activates for paths shaped like
`/api/libraries/:id/...` (it reads the library UUID from the third path
segment, `parts[2]`).

Its job is to enforce the read/write split before any library-scoped handler
runs:

- It requires an authenticated user (`GetUserID` → 401 if absent).
- `GET`, `HEAD`, `OPTIONS` → `accessSvc.RequireLibraryAccess` (**viewer+**).
- Every other method (POST, PUT, PATCH, DELETE) →
  `accessSvc.RequireLibraryAdmin` (**admin/owner only**).
- On success it stores the resolved access in the request context via
  `c.Set("libraryAccess", *access.LibraryAccess)`.

The `readMethods` map `{GET, HEAD, OPTIONS}` is what drives the write-guard
decision. Handlers retrieve the stored value with
`middleware.GetLibraryAccess(c)` rather than re-querying.

Because the middleware already gates writes at admin level, individual handlers
generally only need extra checks for **owner-only** actions (library delete,
video-thumbnail reprocess) or for the **non-default** constraint (member
management). The image/video file proxy at `/api/files/proxy/*` lives *outside*
`/api/libraries`, so `FileProxyHandler` calls
`access.NewService(h.db).GetLibraryAccess` manually and returns 404 to
non-members.

---

## Members

Member management is handled by `MemberHandler`
(`backend/internal/handlers/member.go`), holding `{db, accessSvc, activitySvc}`.
All routes are under the library group and therefore pass through
`LibraryAccessMiddleware` first (so all the write routes already require admin).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/libraries/:id/users` | List owner + members (+ invites for admins) |
| PATCH | `/api/libraries/:id/users/:memberUserId` | Change a member's role |
| DELETE | `/api/libraries/:id/users/:memberUserId` | Remove a member |
| POST | `/api/libraries/:id/users/invite-link` | Create an invite link |
| DELETE | `/api/libraries/:id/users/invites/:inviteId` | Revoke an invite link |

### Listing members — `GET /api/libraries/:id/users`

Returns the owner first, then every `library_members` row with the joined user
details. Admins additionally see all non-revoked `library_invites` with their
usage history (joined against `library_invite_uses`). The response also carries
`canManageUsers = la.IsAdmin && !la.IsDefault`.

The frontend type is `LibraryUsersResponse`:

```ts
{
  libraryId, canManageUsers,
  members: LibraryMemberWithUser[],
  inviteLinks: LibraryInviteLink[]
}
```

This backs the Members section of `pages/libraries/[id]/settings.vue`, which
renders `<LibraryMemberRow>` and `<InviteLinkRow>` components.

### Updating a role — `PATCH …/users/:memberUserId`

Validates `role` to be exactly `"admin"` or `"viewer"` — you cannot promote a
member to `owner` via this endpoint (there is exactly one owner, set at library
creation). The settings UI uses a per-member role dropdown with an optimistic
"role draft" pattern that reverts on API error (`useLibraryMembers.ts`).

### Removing a member — `DELETE …/users/:memberUserId`

Rejects **self-removal** (an admin cannot remove themselves through this route).
On success it emits an `ActionMemberRemoved` activity event. The frontend guard
in `useLibraryMembers.ts` also short-circuits when the target's role is
`"owner"`.

### Creating an invite link — `POST …/users/invite-link`

Validates the request:

- `maxUses` must be `> 0`.
- `expiresAt` must be in the future.

The token is generated as `uuid.New().String()`. The response is:

```json
{
  "id": "…",
  "token": "…",
  "inviteUrl": "…",
  "maxUses": 5,
  "expiresAt": "…"
}
```

`useLibraryMembers.createInviteLink({ maxUses?, expiresAt? })` calls this,
refreshes the user list, and copies the URL to the clipboard
(`navigator.clipboard.writeText`, with a `document.execCommand("copy")` fallback
for non-HTTPS contexts).

### Revoking an invite link — `DELETE …/users/invites/:inviteId`

Sets `revoked_at` on the invite row, guarded by `WHERE revoked_at IS NULL` so it
is idempotent. Revoked invites stop appearing in the admin's invite list and can
no longer be redeemed.

---

## Invite redemption

The redemption side is split between a thin HTTP handler and a transactional
service.

### Endpoints — `InviteHandler`

`backend/internal/handlers/invite.go` registers two routes on `/api/invites`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/invites/:token` | **No** (public) | Look up invite status |
| POST | `/api/invites/:token/accept` | **Yes** | Redeem the invite |

`GET /api/invites/:token` is allowlisted in `AuthMiddleware`'s `needsAuth` so an
anonymous visitor can preview an invite before logging in. The `POST .../accept`
route is *not* allowlisted for writes — it requires a valid session, enforced
inside the handler via `RequireUserID`.

#### Lookup — `GET /api/invites/:token`

Returns invite metadata and a computed status:

```json
{
  "id": "…", "status": "pending", "canAccept": true,
  "createdAt": "…", "expiresAt": "…",
  "maxUses": 5, "useCount": 1,
  "invitedBy": { },
  "library": { }
}
```

Status values (frontend `InviteLookupResponse.status`):

| Status | Meaning |
|---|---|
| `pending` | Valid and redeemable |
| `revoked` | `revoked_at` is set |
| `expired` | `expires_at` is in the past |
| `exhausted` | `use_count >= max_uses` |
| `already_member` | The current user already belongs to the library |

`canAccept` is true only when the invite is pending **and** the caller is not
already a member.

#### Accept — `POST /api/invites/:token/accept`

Runs `invites.LookupRedeemable` followed by `invites.Redeem`. Error mapping:

| Service error | HTTP |
|---|---|
| `ErrNotFound` | 404 |
| `ErrRevoked` / `ErrExpired` / `ErrExhausted` | 410 Gone |
| already-member | 200 (idempotent success) |

On a genuine new join it emits an `ActionMemberJoined` activity event.

### The invites service

`backend/internal/services/invites/` (package-level functions, no struct).

**`LookupRedeemable(db, token)`** queries `library_invites` and returns one of
the sentinel errors (`ErrNotFound`, `ErrRevoked`, `ErrExpired`, `ErrExhausted`)
or `(invite, nil)` when valid. It checks, in order: record exists →
`revoked_at == nil` → `expires_at` not past → `use_count < max_uses`.

**`Redeem(db, invite, userID)`** runs inside a DB transaction and is built to be
safe under concurrency:

1. **Owner check.** Loads `libraries.owner_id`; returns `ErrAlreadyMember` if the
   user is the owner (you can't be invited to your own library).
2. **Idempotent usage record.** Inserts into `library_invite_uses(invite_id,
   user_id, used_at)` with `ON CONFLICT (invite_id, user_id) DO NOTHING` — the
   UNIQUE constraint on `(invite_id, user_id)` means re-accepting is a no-op.
3. **TOCTOU guard.** If this was a *new* usage row and `max_uses` is set, it
   re-reads the live `use_count` and returns `ErrExhausted` if a concurrent
   redeem already consumed the last slot.
4. **Membership.** Inserts `library_members(library_id, user_id, role="viewer")`
   if not already present, setting `result.AddedMember = true`.
5. **Counter.** Increments `library_invites.use_count` only on first-time usage.

`RedeemResult.AddedMember` tells the handler whether to emit `member.joined`.

The invite-link schema lives in migration `00017` (the "invite-link overhaul"),
which added `max_uses`, `use_count`, `expires_at`, `revoked_at`, and the
`library_invite_uses` junction table while dropping the older single-use
`accepted_by_user_id` / `accepted_at` columns.

### Frontend redemption flow

- `pages/invites/[token].vue` is whitelisted in `middleware/auth.global.ts` so
  the landing page loads without a session, but it manually calls
  `fetchSession()`; unauthenticated visitors are sent to
  `/register?invite=:token`. It calls `api.invites.lookup`, shows the inviter,
  library, and status alert, and offers "Accept Invite" (only when `canAccept`)
  which POSTs to `…/accept`, refreshes the library list, and navigates to
  `/libraries/:libraryId`.
- `pages/login.vue` and `pages/register.vue` are invite-aware: they read
  `?invite=<token>`, look up the invite for context, and on successful
  auth call `POST /api/invites/:token/accept` before redirecting into the
  library. Registration also respects the instance `registration_mode`
  (`open` / `invite_only` / `closed`) from `GET /api/_meta/registration-mode`;
  in `invite_only` mode a valid `canAccept` invite is required to register.

---

## How registration ties in

The owner role is bootstrapped at the instance level: the very first user to
register becomes `role = "owner"` (a bootstrap bypass when zero users exist);
all subsequent users are `role = "member"`. This is the **instance** owner role
(used to gate `/api/admin/**`), distinct from per-library `owner`/`admin`/
`viewer` roles. See `AuthHandler.Register` in
`backend/internal/handlers/auth.go`.

Invite-based registration is honored end to end: `Register` validates the invite
token via `invites.LookupRedeemable`, creates the account+library transaction,
then redeems the invite best-effort and emits `ActionMemberJoined` when the join
succeeds.

---

## Data model summary

| Table | Role in access control |
|---|---|
| `libraries` | `owner_id`, `is_default`, and the three feature flags |
| `library_members` | `(library_id, user_id)` unique; `role` defaults to `viewer` |
| `library_invites` | `token` (unique), `max_uses`, `use_count`, `expires_at`, `revoked_at` |
| `library_invite_uses` | `(invite_id, user_id)` unique — idempotent redemption ledger |
| `users` | `role` = instance `owner`/`member` (admin gate, not library RBAC) |

Migrations: base tables in `00001`; `sharing_enabled` in `00008`;
`object_detection_enabled` in `00002`; invite-link overhaul + `library_invite_uses`
in `00017`.

---

## Related code

Backend:

- `backend/internal/handlers/library.go` — library CRUD, detection backfill on toggle
- `backend/internal/handlers/member.go` — member list/role/remove, invite-link create/revoke
- `backend/internal/handlers/invite.go` — public lookup + authenticated accept
- `backend/internal/handlers/auth.go`, `oauth.go` — registration/OAuth with atomic user+account+library, default `My Library`
- `backend/internal/services/access/access.go` — `LibraryAccess`, `GetLibraryAccess`, `Require*` guards
- `backend/internal/services/invites/redeem.go` — `LookupRedeemable`, `Redeem`, TOCTOU + idempotency
- `backend/internal/middleware/library_access.go` — read/write enforcement, `libraryAccess` context
- `backend/internal/middleware/auth.go` — `needsAuth` allowlist (invite GET, share, etc.)
- `backend/internal/models/models.go` — `Library`, `LibraryMember`, `LibraryInvite`, `LibraryInviteUse`
- `backend/migrations/00001…00017_*.sql` — schema

Frontend:

- `frontend/app/composables/useLibraryMembers.ts` — invite-link create/copy, role update, remove
- `frontend/app/composables/useLibraryExplorer.ts` — `canManageUsers` / `canManageLibrary` derivation
- `frontend/app/pages/libraries/[id]/settings.vue` — members, invites, feature toggles, delete
- `frontend/app/pages/invites/[token].vue` — invite landing + accept
- `frontend/app/components/library/settings/LibraryMemberRow.vue`, `InviteLinkRow.vue`
- `frontend/app/layouts/library.vue` — `canManageLibrary` provide (owner or owner/admin role)
- `frontend/app/api/index.ts` — `api.libraries`, `api.members`, `api.invites`
- `frontend/shared/types/api.ts` — `Library`, `LibraryUsersResponse`, `LibraryInviteLink`, `InviteLookupResponse`
