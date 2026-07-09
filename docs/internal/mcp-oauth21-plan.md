# Implementation Plan — OAuth 2.1 authorization for MCP connections

**Status:** Shipped (gated by `ALCOVES_MCP_OAUTH_ENABLED`, default off) · **Branch:** `feat/mcp-oauth`

> This document is kept as the design record. Where the implementation diverged
> from the original draft it has been reconciled below (e.g. the authorization-code
> TTL shipped as `5m`, and the redirect-host allowlist defaults to empty/allow-any
> exact match rather than `claude.ai,claude.com`).

## Goal

Let Claude's **"Add custom connector"** dialog (and any spec-compliant remote MCP
client) connect to a self-hosted Alcoves instance with a one-click browser
consent flow, instead of requiring a hand-pasted personal access token or an
`mcp-remote` bridge. To do this, Alcoves must become an **OAuth 2.1
Authorization Server (AS) _and_ Resource Server (RS)** for its MCP endpoint,
per the MCP authorization spec (2025-06-18).

This is purely additive: PATs and the stdio transport keep working unchanged.
The whole AS is gated behind a config flag so it ships dark and is enabled per
deployment.

> Context: today `/api/mcp` authenticates with a static `Authorization: Bearer
> <PAT>` (or session cookie) resolved by the global auth middleware. Claude's
> web/desktop connector UI speaks **OAuth 2.1 only** — there is no field for a
> static bearer token (upstream: anthropics/claude-ai-mcp#112). That mismatch is
> exactly what this plan closes. The current workarounds (stdio binary,
> `mcp-remote` header bridge) are documented in
> `website/src/content/docs/features/mcp-server.md` and stay valid.

## What the spec actually requires (and what Claude enforces)

From the MCP authorization spec (2025-06-18) and Claude's connector docs:

- **OAuth 2.1 authorization-code flow with PKCE `S256`** — mandatory, on every
  authorization request, regardless of registration mechanism. Reject `plain`.
- **Protected Resource Metadata (RFC 9728)** — the RS MUST serve
  `/.well-known/oauth-protected-resource` listing its `authorization_servers`,
  and MUST return `401` with a `WWW-Authenticate: Bearer
  resource_metadata="…"` header when unauthenticated.
- **Authorization Server Metadata (RFC 8414)** — the AS MUST serve
  `/.well-known/oauth-authorization-server` advertising the authorize/token/
  registration endpoints and `code_challenge_methods_supported: ["S256"]`.
- **Dynamic Client Registration (RFC 7591)** — SHOULD be supported. Claude uses
  DCR (POST client metadata to `registration_endpoint`) so the user never pastes
  a client ID. (Claude also supports CIMD and Anthropic-held creds; **DCR is the
  most compatible first target.**)
- **Resource Indicators (RFC 8707)** — clients send `resource`; tokens are
  audience-bound to the MCP resource URL.
- **Exact redirect-URI matching** against registered values. Claude's callback is
  `https://claude.ai/api/mcp/auth_callback` (and a future
  `https://claude.com/api/mcp/auth_callback`); Claude Desktop uses a loopback
  redirect. DCR registers whatever the client sends — we store and exact-match.

References:
- MCP spec — Authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Claude — Building custom connectors via remote MCP: https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- Claude — Authentication for connectors: https://claude.com/docs/connectors/building/authentication
- RFC 9728 (PRM), RFC 8414 (AS metadata), RFC 7591 (DCR), RFC 7636 (PKCE), RFC 8707 (Resource Indicators).

## Big lever: the Go MCP SDK already ships the resource-server half

Alcoves pins `github.com/modelcontextprotocol/go-sdk v1.6.1` (`backend/go.mod:13`),
which includes:

- `auth.RequireBearerToken(verifier, opts)` — middleware that 401s with the
  correct `WWW-Authenticate` pointing at PRM (`opts.ResourceMetadataURL`).
- `auth.ProtectedResourceMetadataHandler(*oauthex.ProtectedResourceMetadata)` —
  serves RFC 9728 metadata with CORS.
- `auth.TokenVerifier` / `auth.TokenInfo{Scopes, Expiration, UserID, Extra}` and
  `auth.TokenInfoFromContext`.
- `oauthex` — wire structs for `ProtectedResourceMetadata` (RFC 9728),
  `AuthServerMeta` (RFC 8414), and DCR (`oauthex/dcr.go`).
- The streamable transport is already auth-aware (`mcp/streamable.go` pulls
  `auth.TokenInfoFromContext`).

So we **reuse the SDK for RS + all wire formats** and only hand-build the AS
flow logic (authorize/token/register + consent). We do **not** pull in a heavy
framework like `ory/fosite` (see Decision D1).

## Existing building blocks we extend (grounded references)

| Concern | Where it lives today | How we reuse it |
| --- | --- | --- |
| Bearer token hashing | `auth/token.go:26` `hashToken` (SHA-256 hex); `token.go:34` `CreatePersonalAccessToken` | New OAuth code/access/refresh tokens hashed identically; store hash only |
| Bearer resolution | `middleware/auth.go:57` `resolveBearerUser` → `auth.ValidateMCPToken` (`token.go:62`) | MCP route gains an OAuth-aware verifier (keeps PAT path for back-compat) |
| MCP identity bridge | `cmd/server/main.go:573` `mcpEchoHandler` → `mcpserver.WithIdentity`/`NewStaticIdentity` (`mcpserver/identity.go:23-34`) | Verifier loads the user; bridge injects it into tool ctx as today |
| OAuth client patterns | `handlers/oauth.go` (Google login as **client**): random state (`:78`), cookie + `subtle.ConstantTimeCompare` (`:96`), `enabled` gate, transactional user create | Mirror state/CSRF, the `enabled` config gate, and the redirect-tail patterns for the **server** side |
| Per-library RBAC | `mcpserver/server.go:103` `identity()` → `Access.GetLibraryAccess` on every tool | Unchanged — OAuth only changes _authentication_, not the per-tool _authorization_ |
| Config | `config/config.go:111` `Load()`, `getEnv` (`:222`), `BaseURL` (`:53`), `SessionSecret` (`:23`) | Add `ALCOVES_MCP_OAUTH_*` fields |
| Migrations | Goose SQL, `//go:embed *.sql` (`migrations/embed.go`); highest is `00024_…` | Add `00025_oauth_mcp.sql` |
| Consent UI | SvelteKit `(app)/` group, login redirect pattern (`/login?redirect=…`), profile PAT section | New consent route + a "Connected apps" profile section |

## Architecture

Alcoves is **both** AS and RS (single self-hosted instance; issuer = `ALCOVES_BASE_URL`).

```
Claude connector                         Alcoves (one origin)
   │  1. POST /api/mcp (no token)  ─────▶  401 + WWW-Authenticate: resource_metadata=…
   │  2. GET /.well-known/oauth-protected-resource ─▶ { authorization_servers:[issuer] }
   │  3. GET /.well-known/oauth-authorization-server ─▶ { authorize, token, register, S256 }
   │  4. POST /api/oauth/register (DCR) ─▶ { client_id, … }            [RFC 7591]
   │  5. browser ▶ /oauth/authorize?client_id&redirect_uri&code_challenge&resource&state
   │                ├─ not logged in → /login?redirect=…
   │                └─ consent page → POST /api/oauth/authorize/decision → 302 redirect_uri?code&state
   │  6. POST /api/oauth/token (code + PKCE verifier) ─▶ { access_token, refresh_token, expires_in }
   │  7. POST /api/mcp  Authorization: Bearer <access_token> ─▶ tools run as the user
```

### Endpoint map & routing topology (important wrinkle)

The SvelteKit front door (`:3000`) only proxies `/api/*` to the Go API
(`client/src/routes/api/[...path]/+server.ts`); the Go server today has **no
routes outside `/api/*`**. But the two `/.well-known/*` discovery docs MUST live
at the **domain root**. Plan:

| Path | Served by | Reachable because |
| --- | --- | --- |
| `/.well-known/oauth-protected-resource` | Go (root route on `e`) | **New:** SvelteKit forwards `/.well-known/oauth-*` to the API (see below) |
| `/.well-known/oauth-authorization-server` | Go (root route on `e`) | same |
| `/oauth/authorize` (browser consent UI) | **SvelteKit page** | it's a normal SvelteKit route |
| `/api/oauth/authorize` (GET validate) · `/api/oauth/authorize/decision` (POST) | Go | rides existing `/api` proxy |
| `/api/oauth/token` · `/api/oauth/register` | Go (JSON, server-to-server) | rides existing `/api` proxy |
| `/api/mcp` | Go (already) | rides existing `/api` proxy |

**Well-known forwarding** — chosen approach: intercept `/.well-known/oauth-*` in
`client/src/hooks.server.ts` `handle` and forward to `INTERNAL_API_URL`
(mirroring how `handleFetch` already rewrites `/api/*`). This keeps OAuth
discovery working through the single front door with zero operator config.
- *Alternative considered:* document a reverse-proxy / Helm-ingress rule routing
  `/.well-known/oauth-*` to the API service. Rejected as the default because it
  pushes setup onto every self-hoster; keep as a documented escape hatch.
- The AS metadata advertises absolute URLs built from `ALCOVES_BASE_URL`, so the
  `authorization_endpoint` points at the SvelteKit `/oauth/authorize` page and
  token/register at `/api/oauth/*`.

### Token model

Opaque, hashed-at-rest tokens (Decision D2) in new tables, reusing `hashToken`:

- **Authorization code** — single-use, short TTL (shipped default `5m`), bound to
  `client_id + redirect_uri + code_challenge + user_id + scope + resource`.
- **Access token** — short TTL (default 1h), audience = MCP resource. Accepted
  **only at `/api/mcp`** (not as a general API bearer — see Security S3).
- **Refresh token** — long TTL (default 30d), **rotating** (RFC 9700), revocable.

### New DB tables — migration `00025_oauth_mcp.sql`

(GORM models added to `backend/internal/models/models.go`; UUID PKs via
`gen_random_uuid()` + `BeforeCreate`, matching `PersonalAccessToken`.)

- `oauth_clients` — `client_id` (public), `client_name`, `redirect_uris text[]`,
  `grant_types text[]`, `token_endpoint_auth_method` (`none` for public),
  `scope`, `registration_via` (`dcr`/`cimd`), timestamps. No secret for public
  clients (Claude is public + PKCE).
- `oauth_authorization_codes` — `code_hash` (unique), `client_id`, `user_id`,
  `redirect_uri`, `code_challenge`, `code_challenge_method`, `scope`, `resource`,
  `expires_at`, `consumed_at`.
- `oauth_access_tokens` — `token_hash` (unique), `client_id`, `user_id`, `scope`,
  `resource`, `expires_at`, `last_used_at`, `refresh_token_id`.
- `oauth_refresh_tokens` — `token_hash` (unique), `client_id`, `user_id`,
  `scope`, `expires_at`, `rotated_from`, `revoked_at`.

Indexes on every `*_hash`, plus `user_id` and `client_id`. FKs `ON DELETE
CASCADE` to `users` (mirror `00020_add_personal_access_tokens.sql`).

### Scopes & consent

- **v1: a single coarse scope** (e.g. `mcp`) meaning "act as me through MCP."
  Fine-grained scopes (read-only, per-library) are a future enhancement — the
  per-tool, per-library RBAC at `mcpserver/server.go:117/135` still fully applies
  regardless of token, so this is safe.
- **Consent** is per-user (any authenticated user may connect their own account,
  exactly like minting a PAT — *not* owner-gated). Screen shows the client name
  (from DCR), the single scope, the signed-in identity, and Approve/Deny.

## Backend service shape

New package `backend/internal/services/oauth/` (peer of `auth/`):
- `client.go` — DCR: validate + persist client metadata, generate `client_id`.
- `code.go` — mint/validate/consume authorization codes (PKCE `S256` verify).
- `token.go` — mint access/refresh, refresh-token rotation, revocation; reuse
  `auth.hashToken` (export it or add an `oauth`-local equivalent).
- `metadata.go` — build `oauthex.ProtectedResourceMetadata` + `AuthServerMeta`
  from `ALCOVES_BASE_URL`.

New handlers `backend/internal/handlers/oauth_server.go` (distinct from the
existing Google-client `oauth.go`):
- `GET /api/oauth/authorize` → validate request (client, redirect exact-match,
  PKCE present, resource), require session, return consent payload.
- `POST /api/oauth/authorize/decision` → on approve, mint code, return redirect
  `Location`; on deny, redirect with `error=access_denied`.
- `POST /api/oauth/token` → `authorization_code` + `refresh_token` grants.
- `POST /api/oauth/register` → DCR.

RS wiring change in `cmd/server/main.go` (the `if cfg.MCPHTTPEnabled` block,
`:513-533`): remove `/api/mcp` from the global auth path (add to `needsAuth`
skip list, `middleware/auth.go:74`) and wrap the streamable handler with
`auth.RequireBearerToken(verifier, &auth.RequireBearerTokenOptions{
ResourceMetadataURL: …})`. The verifier accepts an **OAuth access token** (and a
**PAT**, for back-compat), loads the user, and the existing identity bridge
injects it. Register the two `/.well-known/*` handlers directly on `e` (root).

## Frontend work (`client/`)

- **`/oauth/authorize` consent route** — fetch request details from
  `GET /api/oauth/authorize`; if anon, redirect `/login?redirect=…` (existing
  pattern); render consent with Skeleton UI (this plan predates the
  shadcn-svelte rewrite — the shipped route uses shadcn-svelte); Approve/Deny
  POST to the decision
  endpoint and follow the returned `Location`. Reuse `createApi` + a new
  `oauth` namespace in `src/lib/api/`.
- **Well-known forwarding** in `hooks.server.ts` (above).
- **Profile "Connected apps"** — a section mirroring the existing "MCP access
  tokens" PAT UI: list active OAuth grants (client name, last used) with revoke.
- Tests per the frontend conventions (`*.svelte.test.ts` for the consent page,
  `*.test.ts` for hooks/proxy + the api namespace).

## Config additions (`ALCOVES_MCP_OAUTH_*`)

Add to `Config` + `Load()` (`config/config.go`):

| Var | Default | Purpose |
| --- | --- | --- |
| `ALCOVES_MCP_OAUTH_ENABLED` | `false` | Master gate for the AS + RS OAuth path |
| `ALCOVES_MCP_OAUTH_ACCESS_TTL` | `1h` | Access-token lifetime |
| `ALCOVES_MCP_OAUTH_REFRESH_TTL` | `720h` | Refresh-token lifetime |
| `ALCOVES_MCP_OAUTH_CODE_TTL` | `5m` | Authorization-code lifetime |
| `ALCOVES_MCP_OAUTH_DCR_ENABLED` | `true` | Allow Dynamic Client Registration |
| `ALCOVES_MCP_OAUTH_ALLOWED_REDIRECT_HOSTS` | _(empty)_ | Optional allowlist for DCR redirect hosts; empty = allow any exact-URI-matched host |

Issuer = `ALCOVES_BASE_URL` (must be HTTPS in prod). `config.Load()` fails fast
when OAuth is enabled but `ALCOVES_MCP_HTTP_ENABLED` is off or `BaseURL` is not a
valid absolute URL (and, in production, not HTTPS).

## Security checklist

- **S1 — PKCE `S256` mandatory.** Reject missing/`plain` challenges. Advertise
  only `S256`.
- **S2 — Exact redirect-URI match** against the registered client. No prefix/
  wildcard. Optional host allowlist (`…ALLOWED_REDIRECT_HOSTS`).
- **S3 — Audience binding (RFC 8707).** Validate `resource`; OAuth access tokens
  are accepted **only at `/api/mcp`**, never as a general `/api/*` bearer. (PATs
  retain today's broader scope; that's unchanged.)
- **S4 — Single-use, short-TTL codes** bound to user+client+redirect+challenge;
  mark `consumed_at` atomically; reject replay.
- **S5 — Rotating refresh tokens** (detect reuse → revoke the chain). Hash at
  rest; never log plaintext (mirror `token.go`).
- **S6 — Consent CSRF.** The decision POST carries a one-time, session-bound
  request token; constant-time compare (mirror `oauth.go:96`).
- **S7 — DCR abuse.** Rate-limit `/api/oauth/register`; cap clients; allow
  disabling via config. Validate submitted metadata.
- **S8 — TLS-only** for all token transport; `Secure` cookies as today.
- **S9 — Revocation UX** (profile "Connected apps") + optional RFC 7009
  `/api/oauth/revoke`.
- **S10 — No PAT-list contamination.** OAuth tokens live in their own tables and
  do **not** appear in the user's PAT list.

## Decision points (recommendation in **bold**)

- **D1 — AS implementation: hand-rolled (using `oauthex` wire types) vs
  `ory/fosite`.** **Hand-rolled.** The flow set is narrow (auth-code + PKCE +
  refresh + DCR), the SDK already provides RS middleware + metadata/DCR structs,
  and fosite is heavy and storage-opinionated. Fosite stays the conservative
  fallback if hand-rolling reveals sharp edges.
- **D2 — Token format: opaque-hashed vs JWT.** **Opaque-hashed.** Reuses the PAT
  hashing path, trivially revocable, no JWKS endpoint/key rotation. JWT would add
  `/.well-known/jwks.json` + signing-key management for no benefit at this scale.
- **D3 — Registration: DCR vs CIMD vs Anthropic-held.** **DCR first** (most
  broadly compatible; Claude supports it). CIMD is a later optimization.
- **D4 — Consent UI home: SvelteKit page vs Go-rendered HTML.** **SvelteKit
  page** — fits the SPA, reuses auth/session/UI; Go stays pure-JSON API.

## Phased delivery (each phase independently testable)

1. **Phase 0 — Foundations.** Config flags; migration `00025` + models; `oauth`
   service (hashing, code/access/refresh mint+validate+rotate). Backend unit
   tests. *No external surface yet.*
2. **Phase 1 — Resource Server.** PRM well-known + `/api/mcp` 401/`WWW-
   Authenticate` via SDK `RequireBearerToken`; verifier accepts OAuth tokens
   **and** PATs. *Acceptance: a hand-minted OAuth access token reaches MCP tools;
   PATs still work.*
3. **Phase 2 — Authorization Server core.** AS metadata; `/api/oauth/authorize`
   (validate + decision) and `/api/oauth/token` (code+PKCE, refresh). *Acceptance:
   scripted auth-code+PKCE dance yields a working token.*
4. **Phase 3 — DCR + consent UI.** `/api/oauth/register`; SvelteKit
   `/oauth/authorize` consent page; well-known forwarding in `hooks.server.ts`.
5. **Phase 4 — Revocation + polish.** Profile "Connected apps" + revoke; rate
   limits; optional `/api/oauth/revoke`.
6. **Phase 5 — End-to-end with Claude.** Deploy to a test instance; connect the
   real Claude custom connector; iterate on quirks (redirect host, metadata
   shape, DCR fields).

## Test plan

- **Backend (`go test ./internal/services/oauth/... ./internal/handlers/...
  -race`):** PKCE verify (S256 happy + tamper), code single-use/replay/expiry,
  exact redirect match, refresh rotation + reuse-detection, DCR validation,
  audience binding (OAuth token rejected on non-MCP `/api/*`), metadata doc shape,
  `WWW-Authenticate` on 401. Use `internal/testsupport` DB harness.
- **Frontend:** consent page (`page.svelte.test.ts`), `hooks.server.ts`
  well-known forwarding (`*.test.ts`), the `oauth` api namespace.
- **Integration/E2E:** a Playwright/Go test that runs the full dance against the
  **real seeded stack** — DCR → authorize (with a seeded logged-in session) →
  token → call `/api/mcp` — asserting a tool result. Cannot drive Claude itself,
  so this stands in for the connector.
- **Manual acceptance (Phase 5):** connect Claude's custom connector to a live
  instance end-to-end. This is the real definition of done.

## Docs to update (same PR(s) as the behavior)

- `website/src/content/docs/features/mcp-server.md` — replace the current
  "custom connector needs OAuth → use `mcp-remote`" note with **one-click custom-
  connector instructions** (paste the instance URL, approve consent); keep stdio
  + `mcp-remote` as alternatives; document `ALCOVES_MCP_OAUTH_*`.
- Config reference page + `.env.example`.
- `CLAUDE.md` — drop the "MCP is PAT-only / custom connector unsupported"
  framing once shipped; note new route groups (`/api/oauth/*`, well-known).
- Extend the seeder if any OAuth rows aid local dev (likely just an enabled flag;
  no seed rows needed since clients self-register via DCR).

## Open questions for review

- Confirm **single coarse `mcp` scope** for v1 (vs investing in read-only / per-
  library scopes now).
- Confirm the **well-known forwarding via `hooks.server.ts`** approach vs
  documenting an ingress rule (affects self-host ergonomics).
- Confirm **default redirect-host allowlist** (`claude.ai,claude.com`) vs
  allow-any-exact-match-by-default.
- Decide whether to expose **RFC 7009 revocation** in v1 or rely solely on the
  profile UI.
