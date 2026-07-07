---
title: "MCP Server"
description: "Connect Claude Desktop and AI agents to your Alcoves library using the Model Context Protocol — browse, search, organize, read AI insights, edit collaborative documents, upload, and download, all under your own access control."
---

Alcoves includes a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server, so AI clients like Claude Desktop can explore your libraries, search across them, read the AI metadata Alcoves generates (transcripts, detected objects, people, sound events), organize content, create and edit collaborative documents, and move files in and out — all authenticated as you, against your own self-hosted instance.

Every MCP action respects the **same role-based access control as the web app**. An agent can only see and do what your account is permitted to do, scoped per library. No data leaves your server.

## What you can do

Once connected, an MCP-capable client can, on your behalf:

- **Discover** the libraries you can access and your role in each, and read a single library's details and members.
- **Search** across every library you can access — by file name, folder name, and AI-detected object labels.
- **Browse & inspect** files and folders (cursor-paginated), get full file details, walk the date-ordered media timeline, and list geotagged files.
- **Read AI insights** Alcoves has generated: speech transcripts, detected sound events, recognized people (face clusters), and detected objects.
- **Organize**: create folders, create and apply tags, rename and move files, and trash / restore files (a reversible soft-delete).
- **Author documents**: create, read, and update collaborative markdown documents ([Live documents](/features/live-documents/)) — the same files your teammates edit live in the web app.
- **Transfer**: upload files into a library and download files out of it (local path or signed URL — see [How large file transfers work](#how-large-file-transfers-work)).

## Tool catalog (v1)

All tools enforce access per library. **viewer+** means any member (viewer, admin, or owner); **admin+** means admin or owner. `search` needs only a valid account — it automatically scopes results to the libraries you can access.

### Discovery & libraries

| Tool | Role | Description |
|---|---|---|
| `list_libraries` | any | List every library you can access, each with your role. Start here to get library IDs. |
| `get_library` | viewer+ | A single library's details: name, emoji, owner, your role, and which AI features (face recognition, object detection, sharing) are enabled. |
| `list_members` | viewer+ | The members of a library and their roles (owner first). |
| `search` | account | Cross-library search by file name, folder name, and detected object labels (with singular/plural matching, e.g. `dogs`→`dog`). Returns the library each hit lives in. |

### Files & folders

| Tool | Role | Description |
|---|---|---|
| `list_files` | viewer+ | List files and folders in a library or subfolder, cursor-paginated. Set `trashed: true` for the trash view. |
| `get_file` | viewer+ | Full details for one file: size, type, dimensions/duration, capture date, GPS, camera, AI-pipeline status, tags, and duplicate matches. |
| `get_timeline` | viewer+ | A library's media (images + videos) newest-first by capture date, cursor-paginated. `includeAll: true` to include non-media files. |
| `list_map_points` | viewer+ | The geotagged files in a library (lat/lon), newest-first. Capped at 5000 with a `truncated` flag. |
| `upload_file` | admin+ | Upload a file into a library (local path or signed URL). |
| `download_file` | viewer+ | Download a file from a library (local path or signed URL). |
| `create_folder` | admin+ | Create a folder, optionally nested under a parent. |
| `update_file` | admin+ | Rename a file and/or move it to another folder (or the library root). |
| `trash_file` | admin+ | Move one or more files to the trash (reversible soft-delete). |
| `restore_file` | admin+ | Restore trashed files (back to the library root, matching the web app). |

### Documents

[Live documents](/features/live-documents/) are collaborative markdown files. Because a document _is_ a `text/markdown` file, the file tools above (`list_files`, `search`, `update_file`, `trash_file`, …) apply to it too — these three add content-level create / read / update.

| Tool | Role | Description |
|---|---|---|
| `create_document` | admin+ | Create a markdown document in a library, optionally inside a folder and with initial content. It opens in the collaborative editor like any other document. `.md` is appended to the name if you leave it off. |
| `read_document` | viewer+ | Read a document's markdown. For a document being edited live, the content reflects the last autosave checkpoint (at most ~a minute behind active typing). |
| `update_document` | admin+ | Replace a document's contents wholesale. Anyone editing it live is resynced to the new version — their in-flight keystrokes are superseded, like overwriting a file while someone is typing. |

### Tags

| Tool | Role | Description |
|---|---|---|
| `list_tags` | viewer+ | List a library's tags (id, name, color). |
| `create_tag` | admin+ | Create a tag; a palette color is auto-assigned if you don't supply one. Names are unique per library. |
| `set_file_tags` | admin+ | Replace the complete set of tags on a file with the given tag IDs (empty array clears all tags). |

### AI insights (read-only)

| Tool | Role | Description |
|---|---|---|
| `get_transcript` | viewer+ | The speech transcript of an audio/video file (plain text + WebVTT). Returns `ready: false` with the current status if transcription hasn't finished. |
| `list_audio_events` | viewer+ | Detected sound events in a file (speech, music, applause, …) with timestamps and confidence. |
| `list_people` | viewer+ | The people (face-recognition clusters) in a library, with names (if set) and face counts. |
| `list_objects` | viewer+ | With a library, the distinct object labels and how many files contain each. With a `fileId`, the individual detections (label, confidence, bounding box) in that file. |

### Moments

| Tool | Role | Description |
|---|---|---|
| `list_moments` | viewer+ | The moments (named clips / time ranges) on a video file, with their tags and export status. |

### A typical agent workflow

1. `list_libraries` → pick a library ID.
2. `search` (or `get_timeline` / `list_files`) → find files of interest.
3. `get_file`, `get_transcript`, `list_objects`, `list_people` → understand the content.
4. `create_tag` + `set_file_tags`, `create_folder` + `update_file`, or `trash_file` → organize.
5. `download_file` / `upload_file` → move bytes in or out.

### Not in v1

The following are intentionally deferred (use the web app for now): creating or deleting libraries, changing member roles and managing invites, creating moments / minting public share links, permanently purging trashed items, folder rename/move/trash, triggering AI re-processing jobs (transcription, detection), and editing face-recognition clusters (merge / split / rename a person). The v1 set favors safe, reversible operations and the read paths that surface Alcoves' AI metadata.

## Connecting with a personal access token

MCP clients authenticate using a **personal access token (PAT)** — a long-lived credential tied to your account. Tokens are stored only as a secure hash; Alcoves never retains the plaintext after creation.

### Create a token from your profile

1. Open your **Profile** page.
2. Scroll to the **MCP access tokens** section.
3. Click **Create token**, give it a name, and optionally set an expiry date.
4. Copy the token immediately — it is shown only once.

You can revoke any token from the same section at any time.

### Create a token from the command line

If you are setting up a headless server or scripting the connection, use the `alcoves-mcp` binary:

```bash
alcoves-mcp create-token --email you@example.com --name my-laptop
# Prints the token once. Store it securely.
```

:::caution
Copy your token before closing the creation dialog or terminal — it cannot be retrieved again. If you lose a token, revoke it and create a new one.
:::

## Connecting Claude Desktop (stdio)

The stdio transport is the recommended way to connect Claude Desktop or any local MCP client. The `alcoves-mcp` binary runs as a child process, authenticates once at startup using your personal access token, and communicates over stdin/stdout.

Add the following to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "alcoves": {
      "command": "/path/to/alcoves-mcp",
      "env": {
        "ALCOVES_MCP_TOKEN": "your-personal-access-token",
        "ALCOVES_BASE_URL": "https://your-alcoves-instance.example.com"
      }
    }
  }
}
```

Replace `/path/to/alcoves-mcp` with the path to the binary on your machine, and set `ALCOVES_BASE_URL` to the public URL of your Alcoves instance.

:::tip
The stdio binary writes all logs to **stderr**, keeping stdout reserved for JSON-RPC messages. Claude Desktop and most MCP clients handle this automatically.
:::

## Connecting a remote agent (HTTP transport)

For remote agents or server-to-server integrations, Alcoves also supports an HTTP transport. When enabled, it is available at `POST /api/mcp`, `GET /api/mcp`, and `DELETE /api/mcp`. Clients authenticate using an `Authorization: Bearer <personal-access-token>` header. Every request resolves its own identity from the bearer token, so one HTTP endpoint serves many users, each scoped to their own access.

The HTTP transport is disabled by default. Enable it on the server:

```bash
ALCOVES_MCP_HTTP_ENABLED=true
```

## Connecting Claude's custom connector (OAuth)

The simplest way to connect a remote client like **Claude's "Add custom connector"** is OAuth. When enabled, Alcoves acts as an **OAuth 2.1 authorization server** for its MCP endpoint, so you paste your instance URL and approve a browser consent screen — no token to copy, no bridge tool.

Enable it on the server (both flags are required — OAuth secures the HTTP transport rather than turning it on for you):

```bash
ALCOVES_MCP_HTTP_ENABLED=true
ALCOVES_MCP_OAUTH_ENABLED=true
ALCOVES_BASE_URL=https://your-alcoves-instance.example.com   # required — the OAuth issuer
```

Then, in Claude, choose **Add custom connector**, name it (e.g. "Alcoves"), and enter your instance URL as the **Remote MCP server URL**. Claude discovers the authorization server automatically (RFC 9728 / RFC 8414), registers itself (RFC 7591 Dynamic Client Registration), and opens an Alcoves consent screen in your browser. Approve it and the connector is ready.

How it works:

- Alcoves implements the OAuth 2.1 **authorization code flow with PKCE (S256)** — the flow Claude's connector requires.
- The **consent screen** authenticates you with your existing Alcoves session (you'll be asked to log in first if you aren't). Approving grants the client an access token that **acts as you** — every tool call is still scoped by your per-library roles.
- Access tokens are **short-lived** and refreshed automatically; they are **audience-bound to the MCP endpoint** (they don't work against the rest of the API).
- You can **revoke** a connected app any time from **Profile → Connected apps**.

By default any redirect URI registered by the client is accepted (exact-matched). To restrict registrations to specific hosts, set `ALCOVES_MCP_OAUTH_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com`.

:::note
The well-known discovery documents are served at your instance root
(`/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`).
The bundled SvelteKit front end forwards them to the API automatically, so a
standard single-origin deployment needs no extra reverse-proxy rules.
:::

PATs and the `mcp-remote` bridge still work for clients that prefer a static token; OAuth is purely additive.

## How large file transfers work

The MCP protocol is not designed to carry raw file bytes — embedding gigabytes of binary data in JSON-RPC is not practical. `upload_file` and `download_file` handle this transparently depending on how the client is connected.

### Local (stdio) client

When the `alcoves-mcp` binary runs on the same machine as your files, `upload_file` accepts a local `path` and `download_file` accepts a local `destPath` directly. The server streams bytes between disk and storage without loading the entire file into memory and without the agent ever touching the raw bytes.

### Remote (HTTP) client

For remote clients, the tools return a **signed URL** and a ready-to-run `curl` command. The agent instructs the user (or automation) to run the command — no custom protocol knowledge required.

- **Download:** a range-capable signed URL, used with:
  ```bash
  curl -C - -o output-file "https://your-alcoves-instance.example.com/api/files/signed?token=..."
  ```
  The `-C -` flag makes the download resumable if interrupted.

- **Upload:** a signed PUT URL:
  ```bash
  curl -T local-file "https://your-alcoves-instance.example.com/api/files/upload-signed?token=..."
  ```

For very large or unreliable uploads, the `upload_file` result also includes a **resumable TUS endpoint** — the same one used by the web app's upload queue — with the necessary headers pre-filled.

Signed URLs are short-lived and scoped to a single file operation. They expire automatically and cannot be reused.

## Operator configuration

| Environment variable | Purpose |
|---|---|
| `ALCOVES_MCP_TOKEN` | Personal access token used by the stdio server at startup. |
| `ALCOVES_MCP_HTTP_ENABLED` | Set to `true` to enable the HTTP transport at `/api/mcp`. Defaults to `false`. |
| `ALCOVES_MCP_OAUTH_ENABLED` | Set to `true` to enable the OAuth 2.1 authorization server (custom-connector one-click auth). Requires `ALCOVES_MCP_HTTP_ENABLED` and `ALCOVES_BASE_URL`. Defaults to `false`. |
| `ALCOVES_MCP_OAUTH_ACCESS_TTL` / `_REFRESH_TTL` / `_CODE_TTL` | OAuth access-token, refresh-token, and authorization-code lifetimes (Go durations). Default `1h` / `720h` / `5m`. |
| `ALCOVES_MCP_OAUTH_DCR_ENABLED` | Allow Dynamic Client Registration (RFC 7591). Defaults to `true`. |
| `ALCOVES_MCP_OAUTH_ALLOWED_REDIRECT_HOSTS` | Optional comma-separated allowlist of redirect-URI hosts (e.g. `claude.ai,claude.com`). Empty = allow any exact-matched URI. |
| `ALCOVES_MCP_SIGNING_SECRET` | HMAC key used to sign temporary file URLs. Falls back to `ALCOVES_SESSION_SECRET` if not set. |
| `ALCOVES_BASE_URL` | Public URL of your Alcoves instance. The OAuth issuer, and required for the signed and TUS URLs returned to remote clients. |

:::note
`ALCOVES_BASE_URL` must be set correctly for remote file transfers to work. Without it, signed URLs cannot be constructed.
:::

## Security

- **Role enforcement is per request, per library.** Read tools require viewer access to the target library; write tools require admin. An agent using a viewer token cannot create folders, tag, move, or trash, regardless of the tool called. `search` only ever returns results from libraries you can access.
- **Personal access tokens** are stored as SHA-256 hashes. The plaintext is shown only at creation time and is never logged or stored.
- **Signed URLs** are time-limited and scoped to a single file or destination. They cannot be used for other files or after expiry.
- **Reversible by default.** `trash_file` is a soft-delete recoverable with `restore_file`; there is no permanent-delete (purge) tool in v1 — use the web app for that.
- **The stdio binary** can read and write any path on the host that the process has access to. This is appropriate for a trusted local setup. The HTTP transport never performs local path I/O.
- **Write activity is logged.** Folder/tag creation and trashing record entries in the library's activity feed, just like the web app, so collaborators can see what an agent did.

See the [configuration reference](/getting-started/configuration/) for the full list of environment variables.
