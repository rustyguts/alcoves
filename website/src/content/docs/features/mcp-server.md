---
title: "MCP Server"
description: "Connect Claude Desktop and AI agents to your Alcoves library using the Model Context Protocol — browse, upload, and download files securely."
---

Alcoves includes a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server, so AI clients like Claude Desktop can browse your libraries, upload files, and download content — all authenticated as you, against your own self-hosted instance.

Every MCP action respects the same role-based access control as the web app. Agents can only see and do what your account is permitted to do. No data leaves your server.

## What you can do

Once connected, an MCP-capable client can:

- **List your libraries** and see your role in each (owner, admin, or viewer)
- **Browse files and folders** with cursor-based pagination
- **Upload files** to a library (requires admin or owner role)
- **Download files** from a library (requires viewer role or above)

### Available tools

| Tool | Required role | Description |
|---|---|---|
| `list_libraries` | any | Lists all libraries you can access with your role in each. |
| `list_files` | viewer+ | Lists files and folders in a library or subfolder, with pagination. |
| `upload_file` | admin+ | Uploads a file to a library. |
| `download_file` | viewer+ | Downloads a file from a library. |

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

For remote agents or server-to-server integrations, Alcoves also supports an HTTP transport. When enabled, it is available at `POST /api/mcp`, `GET /api/mcp`, and `DELETE /api/mcp`. Clients authenticate using an `Authorization: Bearer <personal-access-token>` header.

The HTTP transport is disabled by default. Enable it on the server:

```bash
ALCOVES_MCP_HTTP_ENABLED=true
```

## How large file transfers work

The MCP protocol is not designed to carry raw file bytes — embedding gigabytes of binary data in JSON-RPC is not practical. Alcoves handles this transparently depending on how the client is connected.

### Local (stdio) client

When the `alcoves-mcp` binary runs on the same machine as your files, `upload_file` and `download_file` accept a local path directly. The server streams bytes between disk and storage without loading the entire file into memory and without the agent ever touching the raw bytes.

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
| `ALCOVES_MCP_SIGNING_SECRET` | HMAC key used to sign temporary file URLs. Falls back to `ALCOVES_SESSION_SECRET` if not set. |
| `ALCOVES_BASE_URL` | Public URL of your Alcoves instance. Required for the signed and TUS URLs returned to remote clients. |

:::note
`ALCOVES_BASE_URL` must be set correctly for remote file transfers to work. Without it, signed URLs cannot be constructed.
:::

## Security

- **Personal access tokens** are stored as SHA-256 hashes. The plaintext is shown only at creation time and is never logged or stored.
- **Signed URLs** are time-limited and scoped to a single file or destination. They cannot be used for other files or after expiry.
- **All role checks** are enforced per-request. An agent using a viewer token cannot upload or delete, regardless of the tool called.
- **The stdio binary** can read and write any path on the host that the process has access to. This is appropriate for a trusted local setup. The HTTP transport never performs local path I/O.

See the [configuration reference](/getting-started/configuration/) for the full list of environment variables.
