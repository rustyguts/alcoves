# Authentication & Sessions

Alcoves authenticates users with email/password credentials or Google
OAuth, and keeps them signed in with AES-GCM encrypted, database-backed
session cookies. This document covers the entire identity surface: how
accounts are created, how the first user becomes the instance owner, how
registration is gated, how OAuth works, how the session cookie is built and
validated, and how the frontend consumes all of it.

## What it does (user-facing)

- **Sign up with email + password.** A new user registers with a display
  name, email, and password. The very first account created on a fresh
  instance automatically becomes the **owner** (full admin rights); every
  account after that is a **member**.
- **Sign up with Google.** If the instance operator has configured Google
  OAuth, a "Continue with Google" button appears on the login and register
  pages. The same first-user-becomes-owner rule applies.
- **Sign in / sign out.** Credentials log in, OAuth logs in, and logout
  clears the session.
- **Registration gating.** The owner controls who may self-register via an
  admin setting: `open` (anyone), `invite_only` (only with a valid invite
  link), or `closed` (nobody). The register page reflects the mode and
  hides/locks the form accordingly.
- **Invite-based join.** A library admin can mint an invite link. A new or
  existing user opening that link can register/log in and is added to the
  library as a viewer.
- **Profile management.** A signed-in user can change their display name,
  email, and avatar (uploaded image, normalized to WebP).
- **Multi-session management.** The profile page lists every active session
  (browser, IP, sign-in date) and lets the user revoke any session except
  the one they are currently using.

Every signed-in request carries the `alcoves-session` cookie; the Go API
decrypts it, validates the session row in the database, and attaches the
user to the request context. The frontend's global route middleware calls a
lightweight session endpoint on every navigation to decide whether to show
the app or redirect to `/login`.

## How it works

### Route surface

All auth routes are registered on the `/api/auth` group by
`AuthHandler.RegisterRoutes`, plus a standalone session route and the OAuth +
avatar routes registered by their own handlers.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create credentials account (bootstrap → owner) |
| POST | `/api/auth/login` | public | Email/password login |
| POST | `/api/auth/logout` | public | Delete session + clear cookie |
| GET | `/api/auth/providers` | public | `{ "google": bool }` — which OAuth providers are enabled |
| GET | `/api/auth/google` | public | Begin Google OAuth (sets CSRF state cookie, redirects) |
| GET | `/api/auth/google/callback` | public | Google OAuth callback (verifies state, creates/links user) |
| GET | `/api/auth/me` | required | Current user `{ id, email, displayName, avatarUrl, role }` |
| PATCH | `/api/auth/me` | required | Update `displayName` and/or `email` |
| POST | `/api/auth/me/avatar` | required | Upload avatar (multipart `avatar` or raw body) |
| GET | `/api/auth/me/avatar` | required | Serve current user's avatar (`image/webp`) |
| GET | `/api/auth/users/:userId/avatar` | required | Serve another user's avatar |
| GET | `/api/auth/sessions` | required | List all sessions with `isCurrent` flag |
| DELETE | `/api/auth/sessions/:id` | required | Revoke a session (cannot revoke the current one) |
| GET | `/api/_auth/session` | public | `{ user }` or `{}` — used by the Nuxt auth guard |

The public/protected split is enforced globally by `AuthMiddleware` (see
[Global auth middleware](#global-auth-middleware) below), not per-route.

### Credentials registration

`AuthHandler.Register` (`backend/internal/handlers/auth.go`) does the
following, in order:

1. **Normalize the email** — lowercased and trimmed before any lookup or
   insert, so `Alice@Example.com ` and `alice@example.com` are the same
   identity.
2. **Determine the role** — if there are currently **zero** users in the
   `users` table, this registrant becomes `owner` (the bootstrap bypass);
   otherwise they become `member`. This is the only way to mint the owner
   role at registration time.
3. **Enforce registration mode** — read `registration_mode` from the
   settings service:
   - `open` — anyone may register.
   - `invite_only` — an invite token must be supplied and resolve as
     redeemable via `invites.LookupRedeemable`.
   - `closed` — registration is rejected.
   The bootstrap (first) user is allowed through regardless of mode so the
   instance is never un-bootstrappable.
4. **Hash the password** — bcrypt at cost 10 via `authservice.HashPassword`
   (`backend/internal/services/auth/auth.go`). Cost 10 is chosen for
   bcryptjs compatibility, so hashes are interchangeable with a Node-based
   tool if ever needed.
5. **Create everything in one transaction** — a single `db.Transaction`
   inserts the `User`, an `Account` row with `provider = credentials`, and a
   default `Library` named "My Library". If any step fails the whole thing
   rolls back, so a failed registration never leaves an orphaned user,
   account, or library.
6. **Redeem the invite (best effort)** — when an invite token was supplied,
   it is redeemed *after* account creation via `invites.Redeem`; on a real
   join, an `member.joined` activity event (`ActionMemberJoined`) is emitted.
7. **Set the session cookie** — via `authSvc.SetSessionCookie`, logging the
   user in immediately.

### Credentials login & logout

- **`Login`** verifies the submitted password against the stored
  `password_hash` using `authservice.VerifyPassword`
  (`bcrypt.CompareHashAndPassword`), then sets the AES-GCM session cookie.
- **`Logout`** reads the session token out of the cookie, hard-deletes the
  matching `sessions` row, and clears the cookie.

### Google OAuth

OAuth is handled by `OAuthHandler` (`backend/internal/handlers/oauth.go`).
It is enabled only when `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` and
`ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET` are set — `config.GoogleAuthEnabled` is
derived from a non-empty client ID, and the handler guards every entry point
with its `enabled` flag.

**`GoogleLogin` (`GET /api/auth/google`):**

1. Generates a 32-byte cryptographically random, URL-safe **state** value.
2. Stores it in an `HttpOnly` cookie named `alcoves-oauth-state` with a
   10-minute expiry.
3. Redirects the browser to Google's authorization endpoint. The redirect
   URI is built from `ALCOVES_BASE_URL`.

**`GoogleCallback` (`GET /api/auth/google/callback`):**

1. **Verifies the state cookie** against the returned `state` param using
   `crypto/subtle.ConstantTimeCompare` (constant-time to resist timing
   attacks; mismatch clears the cookie and aborts — this is the CSRF guard).
2. Exchanges the authorization `code` for an access token.
3. Fetches the user profile from
   `https://www.googleapis.com/oauth2/v2/userinfo`.
4. Looks up an existing account by `(provider = google,
   provider_account_id = google_id)`.
5. **New users** follow the same first-user bootstrap rule (first user →
   `owner`). The `User`, default `Library`, and the `Account` (provider
   `google`) are created together in a single transaction; rollback on any
   failure.
6. Creates a session, sets the session cookie, and redirects to `/`.

OAuth-only users have a `NULL` `password_hash` (which is also
`json:"-"`, so it never leaves the API).

### Session cookies (AES-GCM)

Session encryption lives in `backend/internal/services/auth/auth.go`.

- **Key derivation:** `NewService(db, secret)` derives a 32-byte AES key via
  `sha256.Sum256([]byte(secret))` where `secret` is
  `ALCOVES_SESSION_SECRET` (required at startup, minimum 32 bytes). SHA-256
  means any-length secret produces a valid 32-byte key.
- **Payload:** `SessionPayload{ SessionToken string (json "st"), UserID
  string (json "uid") }` — this small JSON object is what gets encrypted
  into the cookie.
- **`SetSessionCookie`:** JSON-marshals the payload, encrypts it with a
  fresh random nonce, **prepends the nonce to the ciphertext** (standard GCM
  pattern), base64-url-encodes the result, and writes it to the
  `alcoves-session` cookie with flags `HttpOnly`, `Secure` (only over
  HTTPS), `SameSite=Lax`, and `MaxAge` = 30 days
  (`SessionMaxAge = 30 * 24h`).
- **`GetSessionFromCookie`:** the exact reverse — decode, split nonce from
  ciphertext, decrypt, unmarshal — returning the `SessionPayload` or a
  parse/decrypt error.
- **`ClearSessionCookie`:** rewrites the cookie with `MaxAge: -1`.

Sessions are also **persisted in the database**. `CreateSession` inserts a
`Session` row capturing the `User-Agent` and client IP (`RealIP`), and
returns a UUIDv4 session token. The cookie therefore only carries a
*reference* (the token) plus the user ID; the server-side row is the
authority. There is **no sliding-window refresh** — a session expires at a
fixed 30-day wall-clock time from creation, and server-side revocation is
simply deleting the row.

**`ValidateSession`** looks up a token; if the row's `expires_at` is in the
past it **deletes the row and returns nil** (lazy expiry cleanup). The full
chain — cookie → decrypt → DB validate → user lookup — is
`GetUserBySession`, which returns `(nil, "", nil)` for any
invalid-but-not-error case so the middleware can cleanly treat it as
"unauthenticated."

Relevant constants (in `services/auth`):

- `SessionCookie = "alcoves-session"`
- `SessionMaxAge = 30 * 24 * time.Hour`
- `BcryptCost = 10`

### Multi-session list & revocation

- **`GET /api/auth/sessions`** returns every `sessions` row for the current
  user, each annotated with an `isCurrent` flag (matched against the
  request's own session token). The frontend surfaces this on the profile
  page as browser/IP/date entries.
- **`DELETE /api/auth/sessions/:id`** deletes a session by ID, scoped to the
  requesting user (`DeleteSessionByID` enforces ownership). It **refuses to
  revoke the current session** — sign-out is the path for that — so a user
  can't accidentally log themselves out from the sessions list.

### Global auth middleware

`AuthMiddleware` (`backend/internal/middleware/auth.go`) is registered on
the Echo instance globally and runs before every handler. It calls
`needsAuth(path)` to decide whether to enforce a session.

**Public (no-auth) paths — the `needsAuth` allowlist:**

- Any non-`/api/` path
- `/api/auth/login`, `/api/auth/register`, `/api/auth/providers`,
  `/api/auth/logout`, `/api/auth/google`, `/api/auth/google/callback`
- `/api/_auth/session` (the frontend session guard)
- `/api/health`, `/api/version`, `/api/_meta/**`
- `/api/invites/{token}` (GET lookup only; the POST `.../accept` requires
  auth, enforced inside the handler via `RequireUserID`)
- `/api/share/**` (public moment share endpoints)

On a protected path it calls `authSvc.GetUserBySession(c)`; failure →
`401 Unauthorized`. On success it sets the request context:

- `c.Set("userId", user.ID.String())` (`ContextKeyUserID`)
- `c.Set("user", user)` (`ContextKeyUser`)
- `c.Set("sessionToken", sessionToken)` (`ContextKeySessionToken`)

Helpers `GetUserID(c)` (returns `uuid.Nil` on failure) and
`RequireUserID(c)` (returns a 401 echo error when nil) are used by handlers
downstream. Library-scoped RBAC is layered on top by
`LibraryAccessMiddleware`, which is separate from authentication and covered
in the access-control docs.

### Avatars

`AvatarHandler` (`backend/internal/handlers/avatar.go`) handles avatar
upload and serving.

- **`Upload` (`POST /api/auth/me/avatar`):** accepts either a multipart
  `avatar` field or a raw request body. Bytes pass through
  `avatarproc.Process` (`backend/internal/services/avatarproc/`), which:
  rejects empty input (`ErrEmptyInput` → 400) and input over 8 MiB
  (`ErrInputTooLarge` → 413), decodes via libvips (`ErrInvalidImage` →
  400/decode failure), EXIF auto-rotates, center-crops to a square,
  downscales to at most 512 px (Lanczos3, never upscales), and exports
  **WebP at quality 85**. The result is stored under the user's UUID via
  `storageSvc.StoreAvatar`, and `users.avatar_url` is set to
  `/api/auth/me/avatar`.
- **`Serve` / `ServeByUserID`:** read the stored WebP via
  `storageSvc.ReadAvatarBuffer` and respond `image/webp` with
  `Cache-Control: private, max-age=300`.

### Profile updates

`UpdateMe` (`PATCH /api/auth/me`) accepts `displayName` and `email`
patches and returns the updated `userResponse`. `Me` (`GET /api/auth/me`)
returns the same shape: `{ id, email, displayName, avatarUrl, role }`.

### Data model

Auth touches these tables (GORM models in
`backend/internal/models/models.go`; migrations in `backend/migrations/`):

- **`users`** — `id`, `email` (unique), `password_hash` (nullable; `json:"-"`,
  null for OAuth-only accounts), `display_name`, `avatar_url`, `role`
  (default `member`, `owner` for the instance owner),
  `notifications_cleared_before`.
- **`accounts`** — provider linkage; `(provider, provider_account_id)`
  unique. `provider` is `credentials` or `google`.
- **`sessions`** — `user_id`, `session_token` (unique), `user_agent`,
  `ip_address`, `expires_at`. DB-backed sessions; revocation = row delete.
- **`libraries`** — the default "My Library" created at registration
  (`is_default = true`).
- **`library_invites` / `library_invite_uses` / `library_members`** — used
  by the invite-based join flow (see `backend/internal/services/invites/`).
- **`app_settings`** — single-row JSONB holding `registration_mode` (among
  other admin settings), read via `backend/internal/services/settings/`.

### Frontend

The frontend session store and auth UI live in `frontend/`:

- **`app/composables/useAuth.ts`** — singleton session store backed by
  `useState<AuthUser | null>("auth:user")`. Exports `{ user, loggedIn,
  login, register, logout, updateProfile, uploadAvatar, fetchSession,
  clearSession }`. Data flow:
  - `fetchSession()` → `GET /api/_auth/session` → sets `user`
  - `login(email, password)` → `POST /api/auth/login` → `fetchSession()`
  - `register(name, email, password, inviteToken?)` →
    `POST /api/auth/register` → `fetchSession()`
  - `logout()` → `POST /api/auth/logout` → clear → `router.replace("/login")`
  - `updateProfile({ displayName })` → `PATCH /api/auth/me`
  - `uploadAvatar(file)` → `POST /api/auth/me/avatar` (FormData)
- **`app/middleware/auth.global.ts`** — global Nuxt route middleware. Public
  routes (`/login`, `/register`, `/s/**`, `/invites/**`) bypass the check;
  everything else calls `fetchSession()` if not already logged in and
  redirects to `/login?redirect=...` when still unauthenticated. It also
  gates owner-only routes (`/admin`, `/admin/jobs`) by `user.role`.
- **`app/pages/login.vue`** — email/password form (Zod-validated), conditional
  Google button driven by `GET /api/auth/providers`, and invite-awareness
  via `?invite=<token>`.
- **`app/pages/register.vue`** — same plus registration-mode handling
  (`open` shows the form, `invite_only` requires a redeemable invite,
  `closed` locks it), fetched from `GET /api/auth/providers` and
  `GET /api/_meta/registration-mode`.
- **`app/pages/profile.vue`** — avatar upload (client preview, 25 MB picker
  cap), display-name edit, theme toggle, and the active-sessions list with
  per-session revoke.
- **`app/components/OAuthGoogleButton.vue`** — full-page navigation to
  `apiUrl("/api/auth/google")` to start the OAuth flow.
- **`app/api/index.ts`** — the `api.auth` namespace centralizes every auth
  route path; **`shared/types/api.ts`** defines `AuthUser`, `SessionInfo`,
  and `AuthProvidersResponse`.

### SSR note

Only `/s/**` (public share pages) are server-rendered. For those, the
isomorphic fetch wrapper (`app/utils/api-fetch.ts`) forwards the incoming
request's `Cookie` header to the Go backend via
`useRequestHeaders(["cookie"])` — that is the sole mechanism by which the
session cookie reaches the backend during SSR. Every other route is
client-rendered and talks to the API through the Nitro proxy with the cookie
attached normally.

## Environment variables

| Variable | Purpose |
|---|---|
| `ALCOVES_SESSION_SECRET` | **Required.** Source material for the AES-GCM key (SHA-256 derived to 32 bytes). Minimum 32 chars; `config.Load()` fails without it. Generate with `openssl rand -base64 32`. |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` | Google OAuth client ID; presence enables OAuth (`GoogleAuthEnabled`). |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `ALCOVES_BASE_URL` | Public-facing URL; used to build the OAuth redirect URI. |
| `ALCOVES_AVATAR_STORAGE_PATH` | Local avatar storage root (defaults under the data dir). |

## Related code

**Backend**

- `backend/internal/handlers/auth.go` — register, login, logout, me/update,
  sessions list/revoke, providers, `/api/_auth/session`.
- `backend/internal/handlers/oauth.go` — Google login + callback.
- `backend/internal/handlers/avatar.go` — avatar upload/serve.
- `backend/internal/services/auth/auth.go` — password hashing (bcrypt cost
  10), AES-GCM cookie encryption, `SessionPayload`,
  `SetSessionCookie`/`GetSessionFromCookie`, `CreateSession`,
  `ValidateSession`, `DeleteSession`/`DeleteSessionByID`, `GetUserBySession`.
- `backend/internal/services/avatarproc/avatarproc.go` — WebP avatar
  normalization.
- `backend/internal/services/invites/redeem.go` — invite lookup + redemption.
- `backend/internal/services/settings/settings.go` — `registration_mode`.
- `backend/internal/middleware/auth.go` — `AuthMiddleware`, `needsAuth`
  allowlist, context helpers.
- `backend/internal/models/models.go` — `User`, `Account`, `Session`.
- `backend/migrations/00001_initial_schema.sql` (users/accounts/sessions),
  `00016_app_settings.sql`, `00017_invite_link_overhaul.sql`.

**Frontend**

- `frontend/app/composables/useAuth.ts`
- `frontend/app/middleware/auth.global.ts`
- `frontend/app/pages/login.vue`, `register.vue`, `profile.vue`
- `frontend/app/components/OAuthGoogleButton.vue`,
  `AuthCardShell.vue`, `UserAvatar.vue`
- `frontend/app/api/index.ts` (`api.auth`)
- `frontend/app/utils/api-fetch.ts` (SSR cookie forwarding)
- `frontend/shared/types/api.ts` (`AuthUser`, `SessionInfo`,
  `AuthProvidersResponse`)
