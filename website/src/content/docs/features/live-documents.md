---
title: "Live documents"
description: "Realtime collaborative markdown editing in your library — multiplayer cursors, autosave, and plain .md files you can download and take anywhere."
---

Live documents are markdown files that several people in a library can edit at the same time, live. Open one and you get an Obsidian-style source editor with a rendered preview; open the same document as a teammate and you see each other's cursors and text appear as it's typed. There is no save button and no "someone else is editing this" lock — everyone just writes.

Under the hood a live document is an ordinary `.md` file in your library. It sits in the browser next to your photos and videos, takes tags, goes to the trash and back, turns up in search, and **downloads as plain markdown**. Nothing about it is trapped in a proprietary format — the collaboration is a layer on top of a file you fully own.

## What you can do

| Action | How |
|---|---|
| Create a document | The **Document** button in a library's toolbar (owner/admin) — name it and start typing |
| Make any `.md` collaborative | Upload a markdown file; it becomes a live document the first time someone opens it |
| Edit together | Multiple members type at once; cursors, selections, and avatars are shown live |
| Switch how you view it | Toggle **Edit**, **Split**, and **Preview** modes |
| Save | Nothing to do — changes autosave continuously; a status badge tells you where you stand |
| Download | Export the document as clean markdown at any time, like any other file |
| Let an AI help | A connected MCP agent can create, read, and update documents under your access control |

---

## Creating a document

A library **owner** or **admin** can create a document:

1. Open the library and click **Document** in the toolbar.
2. Type a name in the **New Document** dialog and press Enter (or click **Create**). A `.md` extension is added for you if you leave it off.
3. Alcoves creates an empty markdown file in the folder you're currently viewing and drops you straight into the editor.

That's it — start typing. The document is a real file from the moment it's created, so it appears in the browser immediately for everyone with access.

:::tip
Already have markdown somewhere else? Upload a `.md` (or `.markdown`) file the normal way. It behaves like any other file until the first person opens it, at which point it becomes a live document seeded from its existing contents.
:::

### Opening a document

Click any markdown file in the browser to open the collaborative editor, or use **Open document** from its right-click menu. When you leave the editor, the **Back** button returns you to the folder you came from.

---

## The editor

The editing surface is a [CodeMirror](https://codemirror.net/) source editor with markdown syntax highlighting — you write raw markdown and see it styled inline, close to the "source mode" feel of Obsidian. A live-rendered preview is one click away.

### View modes

A slim toggle in the header switches between three views:

- **Edit** — the source editor only.
- **Split** — source on the left, live rendered preview on the right, updating as you type.
- **Preview** — the rendered document only.

Viewers see a slightly different pair — **Preview** (the default) and a read-only **Source** view — because they can read but not write.

### Autosave and the status badge

There is no save button. Every change is written back continuously, and a small badge in the header always tells you the current state:

| Badge | Meaning |
|---|---|
| **All changes saved** | Everything you've typed has reached the server |
| **Saving…** | Recent edits are being written right now |
| **Offline — retrying** | The server can't be reached; your edits are held locally and retried automatically until it comes back |
| **Read-only** | You have viewer access — you can read and follow along, but not edit |

If you try to close the browser tab while a save is still in flight, Alcoves prompts you first so nothing is lost. Ordinary in-app navigation is always safe — leaving the editor flushes any last edits for you.

---

## Editing together

Everyone in the library who has the document open shares one live copy:

- **Live text.** Edits from other people stream in as they type — you don't refresh, and you don't reload.
- **Cursors and selections.** Each collaborator gets a color; you see their caret and highlighted selections move in real time.
- **Who's here.** The avatars of everyone currently in the document appear in the header (with a `+N` count when there are more than a few).

Live documents are built on [Yjs](https://yjs.dev/), a CRDT (conflict-free replicated data type). In plain terms: **there are no save collisions.** If two people edit the same paragraph — or even the same sentence — at the same time, both sets of changes merge cleanly instead of one person overwriting the other or being told to "resolve a conflict". The order you happen to type in doesn't matter; everyone converges on the same document.

:::note
Cursor and presence information is never stored — it lives only for the moment it's on screen. Only the document text itself is saved.
:::

---

## Permissions

Live documents follow the same roles as everything else in a library, so there's nothing new to configure. See [Libraries, roles & access control](/features/libraries-and-access-control/) for the full model.

| Role | In a document |
|---|---|
| **Owner / Admin** | Full editing. Can create documents and type into any of them |
| **Viewer** | Live **read-only** view — sees edits and cursors stream in, can read the source, but cannot type. Opens to the rendered Preview by default |

Access is enforced on the server before any request touches a document, exactly as it is for the rest of the library — a viewer's session simply has no way to write, regardless of the client.

---

## Your document is a real markdown file

Because a live document is a normal `.md` file, everything you already do with files just works:

- **Download it** any time and get clean, portable markdown — no export step, no lock-in.
- **Edit it elsewhere** (in Obsidian, an editor, a script) and re-upload it.
- **Tag it, trash and restore it, and find it** in the browser and search alongside the rest of your library.

The downloadable copy — the "materialized" file on disk — is updated from a periodic autosave checkpoint. During active typing it can trail the very latest keystroke by up to about a minute; once editing settles down, or everyone closes the document, the checkpoint catches up so the file on disk matches what people wrote.

:::note
This is why a download is always honest plain markdown rather than an opaque blob: Alcoves keeps the collaborative sync data separately and writes the readable text back into the file. The server never interprets your document's contents — it just stores and relays them.
:::

---

## AI agents (MCP)

If you've connected an AI assistant through the [MCP server](/features/mcp-server/), it can work with live documents under your own access control — no separate permissions, no bypass:

- **`create_document`** (admin/owner) — create a new markdown document, optionally with starting content and in a chosen folder.
- **`read_document`** (viewer and up) — read a document's markdown.
- **`update_document`** (admin/owner) — replace a document's contents wholesale.

When an agent replaces a document's contents, anyone editing it live is **resynced to the new version** automatically — their editor updates in place. Any keystrokes they hadn't finished typing are superseded by the agent's version, the same way overwriting a file replaces what was there. Because reads come from the last autosave checkpoint, a document being actively typed into may be up to about a minute behind when an agent reads it.

---

## Limits

Live documents are for notes, plans, and writing — not for shipping large binaries as text.

- A document holds up to roughly **16 MB of markdown text**. That is a very large amount of prose; ordinary notes and docs sit far below it.
- If you open a markdown file that is already larger than that limit, it won't load in the collaborative editor — you can still download it like any other file.

These limits are fixed rather than configurable: markdown-scale documents fit comfortably within them, and there's no knob to tune.

---

## Realtime sync and self-hosting

Live editing uses a WebSocket per open document to push edits and cursors out instantly. If your deployment sits behind a reverse proxy that can't upgrade WebSocket connections (common in a bare single-port setup), the editor notices within a few seconds and **transparently falls back to fast HTTP polling**.

When that happens, collaboration still works — everyone's edits continue to sync, just in short polling intervals rather than the instant. The one thing you lose in polling mode is live cursors and presence, which only travel over the WebSocket. No configuration change is required either way; the client handles the fallback on its own.

:::tip
For the smoothest experience, make sure your reverse proxy forwards WebSocket upgrades to the API, or point browsers at the API origin directly. See [Deploying Alcoves](/self-hosting/deploying-alcoves/) for proxy and topology guidance.
:::

---

## Privacy

Like everything in Alcoves, live documents live entirely on your own instance. The realtime sync runs between your members and your server — nothing is sent to any third party, and there is no external document service involved. Your writing stays where your files do.

---

## Related features

- [Files, folders, tags & uploads](/features/files-folders-and-uploads/) — documents are files, so uploads, tags, trash/restore, and downloads all apply
- [Libraries, roles & access control](/features/libraries-and-access-control/) — who can edit versus read a document
- [MCP server](/features/mcp-server/) — connect an AI agent to create, read, and update documents
