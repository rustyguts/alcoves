---
title: "Video editor & moments"
description: "Clip, export, and share highlights from any video with a zoomable timeline editor, smart highlight filters, and public share links."
---

The video editor turns any uploaded video into a workspace for clipping highlights. From a single page you can scrub a zoomable waveform timeline, mark named time ranges called **moments**, export each moment to a standalone MP4, and surface interesting segments automatically with **highlight filters** that match against the file's transcript and audio-event detections.

## Opening the editor

Open any video in your library browser and choose **Open in editor** from the right-click menu, or navigate directly to a video's edit page. The editor remembers which folder you came from, so the Back button returns you exactly where you started.

The editor layout splits into two halves:

- **Left** — a video player for playback and scrubbing.
- **Right** — a moments list showing every clip you've created for the video.

Below both, a full-width **timeline** shows the waveform with draggable moment bars on top.

---

## Moments

A **moment** is a named time range on a video. It has a start and end time (stored to millisecond precision), an optional description, and optional tags. Each moment can be independently exported, downloaded, and shared.

### Creating a moment

Press **M** (or **N**) to create a new moment at the current playhead position, then:

1. Press **I** to set the in-point (start) to the current playhead.
2. Scrub forward to where the highlight ends.
3. Press **O** to set the out-point (end).

You can also drag either edge of a moment bar on the timeline to resize it, or drag the bar body to shift it in time.

### Editing a moment

Click any moment in the list or on the timeline to select it. A form appears below the timeline where you can:

- Rename the moment and add a description.
- Type exact start/end times in seconds.
- Apply or remove tags.
- Export, download, or share the moment.

While you drag moment bars, edits appear **highlighted in orange** on the timeline to indicate unsaved changes. Click **Save changes** to commit all pending edits in one batch.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `M` or `N` | Create a new moment |
| `I` | Set in-point to current playhead |
| `O` | Set out-point to current playhead |
| `Space` | Toggle playback |
| `Z` / `X` | Zoom in / out on the timeline |
| `A` / `D` | Scroll the timeline left / right |
| `C` | Center the timeline on the playhead |

Shortcuts are disabled when focus is inside a text field. Press the **?** button in the editor header to open the full keyboard reference.

---

## The timeline

The timeline is a zoomable, scrollable ruler with the waveform underneath and your moment bars on top.

### Zoom and scroll

- **Zoom range:** 1x to 50x. Use `Z`/`X` on the keyboard or hold Ctrl/Cmd and scroll the mouse wheel. Zoom preserves the position of whatever you're looking at — the playhead stays anchored on screen.
- **Scroll:** use `A`/`D`, trackpad, or the scroll wheel. `C` snaps back to center on the playhead.
- When zoomed in, the timeline auto-scrolls to keep the playhead visible during playback.

### Waveform

The waveform canvas renders the audio amplitude of the video as a mirror-image bar chart. It updates to show only the visible region, so it stays fast even on long videos. Click anywhere on the waveform to seek.

:::note
The waveform must be generated before it appears. Click the **Waveform** button in the editor header to queue the generation job. This runs once per video and the result is stored for future visits.
:::

### Moment status pills

When a moment bar is wide enough, a status pill appears showing whether its export clip is `not processed`, `processing`, `ready`, or `failed`. A progress ring animates during encoding.

---

## Exporting and downloading clips

### Export a moment

Click **Export** in the moment edit form (or in the moments list). Alcoves queues an encoding job that:

1. Cuts the source video to the exact start/end times.
2. Re-encodes to H.264 video and AAC audio, clamped to a maximum of 1080p, with a web-optimized MP4 container (`faststart`).
3. Stores the result so future downloads are instant.

Export progress and an estimated time remaining are shown in the status pill while encoding runs.

:::tip
If you edit a moment's time range after exporting, the old export is automatically invalidated and the status resets. Export again to get a clip matching the new boundaries.
:::

### Download a clip

Once a moment's status shows **ready**, click **Download** to save the MP4 file. If the clip isn't exported yet, Alcoves queues the export and downloads it automatically as soon as encoding finishes — you don't need to wait on the page.

---

## Public share links

You can share an exported moment with anyone, even people who don't have an Alcoves account.

:::note
Sharing must be enabled on the library before share links can be created. A library owner or admin can toggle this in library settings.
:::

In the moment edit form, click **Share** to open the share link panel. From there you can:

- **Create** a new share link — generates a unique token URL at `/s/<token>`.
- **Revoke** any existing link to immediately invalidate it.

The public share page at `/s/<token>` includes an embedded video player and is optimized for link previews in social apps and messaging tools (OpenGraph and Twitter player tags are server-rendered).

The video, thumbnail, and metadata are served without authentication. Only moments that have been successfully exported appear as playable on the share page.

---

## Highlight filters

Highlight filters automatically surface interesting segments by matching against the video's **transcript** and **audio-event detections**. Results update instantly as data loads — the matching runs entirely in the browser with no extra round-trips.

:::note
Highlight filters require a transcript and/or audio detections for the video. Use the **Transcribe** and **Audio Detect** buttons in the editor header to generate these. See the [audio detection & transcription](/features/audio-detection-and-transcription/) page for details on how Alcoves runs these locally.
:::

### Writing a filter expression

Each filter has a name, a color, and an **expression**. The expression is a short DSL:

```
audio:Laughter:40, word:goal
```

- **Comma (`,`) means OR** — the filter matches segments where either condition is true.
- **Ampersand (`&`) means AND** — both conditions must occur close together in time.
- **`audio:Label`** matches an audio-event detection whose label contains the word. A bare word without a prefix also defaults to an audio match.
- **`word:foo`**, **`keyword:foo`**, or **`text:foo`** match a transcript cue containing the word.
- **`:NN`** after an audio term sets the minimum confidence score as a percentage. For example, `audio:Laughter:40` requires at least 40% confidence. The default is 20%.
- Values with spaces can be quoted: `word:"oh no"`.

#### Examples

| Expression | Meaning |
|------------|---------|
| `audio:Laughter` | Any detected laughter at 20%+ confidence |
| `audio:Laughter:50` | Laughter at 50%+ confidence |
| `audio:Cheering, audio:Applause` | Cheering OR applause |
| `audio:Laughter & word:goal` | Laughter AND the word "goal" within 5 seconds of each other |
| `word:"oh no", audio:Screaming` | The phrase "oh no" OR screaming |

### Proximity matching

When you combine terms with `&`, Alcoves checks that both conditions occur within a configurable **proximity window** (default: 5 seconds) of each other. You can adjust the proximity per filter in the filter settings panel. This lets you write filters like "applause during or just after a score" without matching applause that happens far away from any relevant spoken word.

### Viewing results

Matched segments appear as a list of clickable timestamps below the filter. Click any match to jump the player to that point. Each match shows the matched evidence (the audio label or the transcript text) and a confidence score.

Filters show aggregate stats — match count, average score, and peak score — at a glance so you can quickly see which ones are producing useful results.

### Built-in presets

When no filters exist for a library yet, the panel offers a **Load presets** button. This creates seven ready-to-use filters:

- Laughter
- Screaming
- Cheering
- Gunshot
- Profanity
- Reactions
- Funny clip (a combination filter)

Presets are a starting point — you can edit, rename, or delete any of them after loading.

---

## Transcript and audio detections panels

The editor includes two additional panels beneath the timeline:

**Transcript panel** — shows the full speech transcript as time-aligned cues. You can search the transcript to find specific words, and the active cue highlights as the video plays. A "Top words" tab shows the most frequent words in the transcript.

**Audio detections panel** — groups audio events by label (e.g., "Laughter", "Applause") and shows a timeline strip of every occurrence. Click any occurrence to seek to it.

Both panels are populated by the same AI jobs that power highlight filters. Run **Transcribe** and **Audio Detect** from the editor header to generate them. These jobs run locally on your server using CPU-only inference — no data leaves your instance.
