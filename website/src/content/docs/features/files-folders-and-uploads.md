---
title: "Files, folders, tags & uploads"
description: "Browse, organize, and upload files with folders, color-coded tags, resumable TUS uploads, trash/restore, and duplicate detection."
---

The library browser is the heart of Alcoves. From here you upload files, arrange them into folders, label them with color-coded tags, browse at your own pace with infinite scroll, and recover anything you accidentally delete — all without touching a command line.

## What you can do

| Action | How |
|---|---|
| Browse files and folders | Paginated, folders-first listing with breadcrumb navigation into subfolders |
| Switch views | Toggle between grid (card) and table view — your preference is remembered |
| Upload | Drag-and-drop onto the page or use the file picker |
| Organize | Create, rename, and move folders; tag files and folders with color labels |
| Select and act in bulk | Click, Ctrl-click, or Shift-click to multi-select, then move, tag, download, delete, transcribe, or trigger audio detection |
| Recover deleted files | Trash is soft — restore any item; permanent deletion requires an explicit Purge |
| Spot duplicates | Files with identical content show a duplicate badge in the listing |

---

## Browsing and navigation

The library listing merges folders and files into a single scrollable view. Folders always appear first, sorted alphabetically, followed by files in the same order. As you scroll toward the bottom the next page loads automatically — there is no "next page" button to click.

When you navigate into a subfolder, a breadcrumb trail appears at the top so you can jump back to any ancestor level. Click any crumb to return there instantly.

### View modes

Use the view-toggle in the toolbar to switch between:

- **Card (grid) view** — larger thumbnails, good for photo and video libraries.
- **Table (list) view** — compact rows with metadata columns, useful for mixed-type libraries.

Your preference is saved in the browser and restored the next time you open the library.

### Timeline view

The **Timeline** tab presents a library's photos and videos as a Google-Photos-style gallery, newest first:

- **Grouped by day.** Each day is its own section with a date heading (for example, *Wed, Jan 14*) and a count. Photos are laid out in justified rows that fill the full width of the window — including the last row of each day — so there are no ragged gaps.
- **Video duration.** Video tiles show their length (for example, *1:35*) in the bottom-right corner.
- **Date scrubber.** A slim rail down the right edge maps the library's whole date range to the scroll position. It shows year labels, per-month density marks (longer marks mean more photos that month), and a draggable handle. Drag the handle — or click a year — to jump to that period; a floating bubble shows the date under the handle. The rail appears only when a library spans more than one month, and it can be operated with the keyboard (arrow keys, Page Up/Down, Home/End).

Timeline groups files by their capture date (from photo/video metadata), falling back to the upload date when no capture date is available.

---

## Uploading files

Alcoves uses the **TUS resumable upload protocol**, which means uploads survive page reloads, browser crashes, and flaky connections. If you lose your connection mid-upload, Alcoves picks up from where it left off when you reconnect.

### How to start an upload

1. Drag one or more files onto the library browser, or click the **Upload** button and use the file picker.
2. Alcoves begins uploading up to three files at a time. A floating panel in the bottom-right corner shows per-file progress and the aggregate upload speed.
3. If a file was already uploaded before (identical content), you see a warning toast — the duplicate is still stored but flagged.

### Resumable uploads

Uploads run in 50 MB chunks. If your connection drops, the upload pauses automatically. It retries up to three times with increasing back-off delays before marking the file as failed. You can retry a failed upload manually from the progress panel.

:::note
Closing the browser tab while an upload is in progress shows a confirmation prompt so you do not accidentally lose an in-flight transfer.
:::

### Who can upload

Only library **owners** and **admins** can upload files. Library viewers can browse and download but cannot add content.

### After upload: automatic processing

As soon as a file lands in storage, Alcoves kicks off any processing your library has enabled:

- **Images** — face detection and object (COCO) detection run asynchronously if enabled.
- **Video** — a playback proxy is generated (when needed), along with a thumbnail, a zoomable audio waveform, and optional transcription and audio-event detection.

You can watch the status of each job on the file's detail view. Processing happens in the background; you can keep browsing while it runs.

---

## Folders

Folders let you structure a library any way you like — by date, project, person, or event. They can be nested to any depth.

### Creating and renaming

Click **New Folder** in the toolbar, type a name, and press Enter. To rename, right-click (or use the context menu) and choose **Rename**, then type the new name inline.

### Moving

Drag a file card onto a folder to move it there, or use **Move** from the context menu to pick a destination from a list. You can move files and folders in bulk by selecting multiple items first.

:::caution
You cannot move a folder into one of its own subfolders. Alcoves checks the ancestor chain and rejects moves that would create a cycle.
:::

### Deleting folders

Deleting a folder sends it — and every file and subfolder inside it — to the Trash. Nothing is permanently removed yet. You can restore the entire tree from the Trash view.

---

## Tags

Tags are library-scoped colored labels you can apply to any file or folder. Use them to cross-cut your folder structure — for example, tag clips from multiple folders with `highlight` or `review`.

### Creating tags

Open the **Tags** page from the library sidebar. Click **New Tag**, type a name, and Alcoves assigns a color from a 12-color palette automatically. Colors cycle through unused hues first so tags stay visually distinct. You can recolor or rename any tag from the same page.

### Applying tags

Right-click any file or folder and open the **Tag** submenu. Toggle tags on or off. You can tag multiple selected items at once — the toggle applies to all of them.

### Viewing tag usage

The Tags management page shows a count of how many files and folders each tag is applied to. This count is computed across the entire library.

:::tip
Tags survive moves. If you reorganize your folder structure, all tag assignments on files and folders are preserved.
:::

---

## Trash and permanent deletion

Deleting a file or folder in Alcoves is a two-step process designed to protect you from accidents.

### Step 1 — Move to Trash

When you delete an item, it moves to the **Trash** view. It is hidden from the main browser but not gone. You can access the Trash from the library sidebar.

In the Trash, each trashed folder shows how many files are nested inside it. Nested items do not appear separately at the root of the Trash — they surface under their parent folder, just as they would in the normal browser.

### Step 2 — Restore or Purge

From the Trash you have two choices:

- **Restore** — moves the item (and any nested content) back into the library at the top level. All original tag assignments are preserved.
- **Purge** — permanently and irreversibly removes the item from storage. You can purge specific items or purge everything in the Trash at once.

:::caution
Purge is permanent. Alcoves deletes the storage blob first, then the database record. There is no undo.
:::

---

## Duplicate detection

Every file you upload gets a SHA-256 content hash computed as the bytes stream into storage — no extra pass required. If two files in the same library have the same content, Alcoves flags them with a **duplicate badge** in the listing and on the file detail view.

Duplicates do not prevent upload; they are surfaced as information so you can decide what to do. You can delete either copy at any time.

:::note
If you have files uploaded before duplicate detection was introduced, an admin can trigger a backfill from the Admin panel to compute missing hashes.
:::

---

## Bulk actions

Select multiple files and folders using standard keyboard conventions:

- **Click** — select a single item (deselects others).
- **Ctrl-click** (or Cmd-click on macOS) — toggle an item in/out of the selection.
- **Shift-click** — range-select everything between the last clicked item and the current one, across the combined folder+file list.

With items selected, the context menu and toolbar expose bulk options:

| Action | Applies to |
|---|---|
| Move | Files and folders |
| Tag | Files and folders |
| Download as ZIP | Files |
| Delete | Files and folders |
| Transcribe | Video files |
| Detect audio events | Video/audio files |

---

## Related features

- **AI processing** — face detection, object detection, transcription, and audio-event tagging all start automatically after upload when enabled on the library. See the AI features pages for details.
- **Video editor and moments** — once a video is processed you can open it in the timeline editor to cut named moment clips.
- **Libraries and roles** — upload permissions are governed by your role in the library (owner or admin required). See the Libraries & access control page for how roles work.
- **Search** — tags, filenames, and AI-detected content are all searchable from the global search bar.
