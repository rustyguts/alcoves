# MCP Server (Model Context Protocol)

Alcoves exposes a Model Context Protocol server so MCP-capable clients (Claude
Desktop, agents, future integrations) can browse libraries and move files. It is
built on the official Go SDK [`github.com/modelcontextprotocol/go-sdk`](https://github.com/modelcontextprotocol/go-sdk).

This aligns with [docs/vision.md](vision.md): it is owner-gated (a personal
access token scoped to one user), privacy-first (runs against your own
self-hosted instance), and keeps heavy work out of the protocol.

## Tools (initial set)

| Tool | Access | What it does |
|------|--------|--------------|
| `list_libraries` | any | Lists the libraries the user can access, with role (owner/admin/viewer). |
| `list_files` | viewer+ | Lists files+folders in a library/folder with cursor pagination. |
| `upload_file` | admin+ | Uploads a file (see "Large files" below). |
| `download_file` | viewer+ | Downloads a file (see "Large files" below). |

The package (`backend/internal/mcpserver`) is structured so the full tool surface
can be added later without rework: tools are transport-agnostic and read the
acting user from an `Identity` carried on the request context.

## Transports

Two transports share one server (`mcpserver.NewServer`):

- **stdio** — the `alcoves-mcp` binary (`backend/cmd/mcp`), launched by a local
  client. Single-user: it authenticates once at startup with `ALCOVES_MCP_TOKEN`
  and serves over stdin/stdout. **stdout is reserved for JSON-RPC; all logs go to
  stderr.**
- **HTTP (streamable)** — mounted on the Echo app at `POST/GET/DELETE /api/mcp`
  when `ALCOVES_MCP_HTTP_ENABLED=true`. Authenticated by the global auth
  middleware via an `Authorization: Bearer <personal-access-token>` header; a
  per-request identity bridge carries the user into the tool handlers.

## Authentication — Personal Access Tokens

There is no API-token concept in the base app, so MCP adds **personal access
tokens (PATs)**: a long-lived bearer credential stored only as a SHA-256 hash
(`personal_access_tokens` table, migration `00020`). The auth middleware accepts
`Authorization: Bearer <pat>` everywhere in addition to the session cookie, which
also lets remote clients drive the tus resumable upload endpoint.

**Users mint and manage their own tokens** from their profile page
("MCP access tokens" section: create with an optional expiry, copy the plaintext
once, and revoke). These are self-service and scoped to the authenticated user —
`GET/POST/DELETE /api/auth/tokens`. Because a token authenticates the MCP server
*as that user*, every tool enforces the same access control, so MCP calls only
ever return data the user is authorized to view.

A CLI fallback exists for headless setups:

```bash
alcoves-mcp create-token --email you@example.com --name laptop
# prints the token once; store it securely
```

## Large files (25GB+)

The MCP protocol never carries file bytes (base64 in JSON-RPC is infeasible at
this size and would flow toward the model). How bytes actually move depends on
where the client runs:

- **Co-located stdio process** — `upload_file`/`download_file` accept a local
  host `path`/`destPath` and the server streams disk↔storage directly
  (constant memory, cancelable).
- **Remote (HTTP) client** — the tools return a **signed, curl-able URL** plus a
  ready-to-run command, so the model needs no protocol knowledge:
  - Download: a signed, range-capable GET → `curl -C - -o out "<url>"`
    (resumable). Served by `GET /api/files/signed?token=...`.
  - Upload: a signed PUT → `curl -T file "<url>"`. Served by
    `PUT /api/files/upload-signed?token=...`, which streams the body straight
    through the shared ingest pipeline (no buffering; optional max-size).
  - For very large/flaky uploads the `upload_file` result also includes a
    **resumable tus fallback** (URL + `Upload-Metadata` + Bearer auth) driven
    against the existing `/api/tus` endpoint.

Signed URLs are short-lived HMAC tokens (`internal/services/signing`) keyed by
`ALCOVES_MCP_SIGNING_SECRET` (falls back to `ALCOVES_SESSION_SECRET`); access is
authorized once, at mint time.

## Shared ingest pipeline

The upload-finalize logic (hash → store → File record → dedup → enqueue
face/object/proxy/transcribe/audio jobs → activity) lives in
`files.Service.IngestStream` and is shared by the tus handler, the signed PUT
endpoint, and the stdio `upload_file` local-path branch. The stdio process wires
storage-only ingest (no async job enqueues); the HTTP path wires the full
pipeline.

## Configuration

| Env var | Purpose |
|---------|---------|
| `ALCOVES_MCP_TOKEN` | PAT the stdio server authenticates as |
| `ALCOVES_MCP_HTTP_ENABLED` | enable the `/api/mcp` HTTP transport (default off) |
| `ALCOVES_MCP_SIGNING_SECRET` | HMAC key for signed URLs (falls back to session secret) |
| `ALCOVES_BASE_URL` | used to build absolute signed/tus URLs |

## Security notes

- The stdio local-path branches read/write any host path the process can access
  (absolute, cleaned). Acceptable for a trusted local operator; a path allowlist
  (`ALCOVES_MCP_ALLOWED_PATHS`) is deferred. The HTTP transport never does local
  path I/O.
- PATs are stored hashed and support optional expiry; signed URLs are
  time-limited and scoped to a single file/destination.

## Future work

Additional tools; PAT management UI/endpoints; path allowlist; MCP progress
notifications for long transfers; S3 download path.
