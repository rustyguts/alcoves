# Icon Audit — Lineicons (maintainer notes)

After the Lucide → Iconify **Lineicons** migration (#583, a 1:1 name swap),
several glyphs no longer matched their meaning. This is the record of the full
re-audit: every distinct UI role was re-evaluated against the complete
**962-icon** Lineicons set (rendered to contact sheets and viewed), and a
single source of truth was introduced at **`frontend/app/utils/icons.ts`**
(the `ICONS` map). Change icons there, never inline.

How to re-view the catalog: `cd frontend && bun install`, then render the
`@iconify-json/lineicons` `icons.json` into an HTML grid and screenshot it with
the bundled Playwright (the throwaway generator used for this pass is not
committed).

## Changes applied (mismatches fixed)

| Role (ICONS key) | Was | Now | Why |
|---|---|---|---|
| Close / dismiss / clear (`close`) | `x` | `xmark` | **`x` is the Twitter/X brand logo**, not a close glyph. 5 hand-rolled buttons used it; Nuxt UI internals already used `xmark`. |
| People / faces (`people`, `jobFace`) | `id-card` | `users` | An ID card doesn't read as "people". `users` is the friendly, conventional People glyph. |
| Object detection (`objectDetection`) | `magnifier` | `crop-2` | A magnifier means *search*. `crop-2` is a corner-bracket bounding box — the detection metaphor. |
| Restore from trash (`restore`) | `reply` | `reload` | `reply` is a message-reply arrow. A circular arrow reads as "bring back / undo delete". |
| Move file/folder (`move`) | `folder` | `move` | The Move action reused a plain folder with no move affordance; `move` is 4-direction arrows. |
| Audio event detection (`audioDetect`) | `pulse` | `volume-high` | Audio-detect and waveform both used `pulse`. Split them: `volume-high` (sound) for detection, `pulse` kept for the waveform. |
| Timeline view (`timeline`) | `alarm-clock` | `calendar-days` | An alarm clock implies an alarm; the Timeline is a date-scrubbed chronological gallery → a calendar reads better. (Job "waiting" state keeps `alarm-clock`.) |
| Duplicate-file badge (`duplicate`) | `clipboard` | `files` | A clipboard means *copy to clipboard*. Stacked `files` reads as "duplicate / multiple copies". |
| Load presets (`loadPresets`) | `brush` | `bookmark` | A paintbrush doesn't say "saved presets"; a bookmark does. |
| Library-switcher caret (`dropdownCaret`) | `sort-high-to-low` | `chevron-down` | A sort glyph was used as a plain dropdown trigger; a chevron is the expected caret. |
| External link (`external`) | `link` | `arrow-top-right` | A chain-link means *link*; an arrow-out is the conventional external-link glyph. |
| PowerPoint file type (`presentation`) | `image` | `blackboard` | PPT/PPTX rendered as a generic image; `blackboard` reads as slides/presentation. |
| Merge people (`mergePeople`) | `link` | `git` | A chain-link means *link*, not *merge*. `git` is the recognizable two-into-one merge symbol. Judgment call — the closest "merge" glyph Lineicons offers. |
| Folder-deleted activity (`folderDeleted`) | `folder` | `trash-can` | The file-deleted activity used a trash can; folder-deleted now matches. |

## Re-evaluated and kept (already the best fit)

`folder`, `tag`, `search`, `bell-1` (notifications), `trash-can`, `download`,
`upload`, `cloud-upload`, `play`, `stop`, `lock`, `envelope`, `key`, `share-2`,
`map-marker`, `library`, `plus`, `minus`, `check`, `warning`, `info`, `pencil`
(edit/rename), `video`, `camera-movie-1` (moment/movie), `music`, `image`,
`file-format-zip`, `comment-1-text` (transcript), `star-fat` (highlights),
`target` (snap to playhead), `keyboard`, `save`, `cog` (settings), `gears-3`
(models), `shield-2-check` (admin), `exit` (sign out), `user`/`user-4` (single
person), `users` (members), `colour-palette-3`, `monitor`/`sun`/`night` (theme),
`harddrive`, `layers` (generic job), `inbox`, `timer`, `radio-button`,
`rss-feed` (feed — kept; it's the recognized "feed" glyph).

## Constrained by the icon set (no better Lineicon exists)

| Role | Glyph kept | Note |
|---|---|---|
| `eyeOff` (hidden password) | `eye` | Lineicons has **no eye-slash**; show/hide share one glyph. |
| `hash` (heading anchor) | `link` | No `#` glyph (`pound` is the £ sign). Effectively unused in this app. |
| `drag` (drag handle) | `menu-meatballs-1` | No grip/dots-grip glyph exists. |
| `chevronDouble*` (paginate first/last) | `chevron-left`/`-right` | No double-chevron glyph. |

## Where icon names live now

- **`app/utils/icons.ts`** — `ICONS` map, the single source of truth.
- **`app/app.config.ts`** — Nuxt UI chrome slots reference `ICONS.*`.
- **`app/utils/mime-icons.ts`** — file-type lookup references `ICONS.*`.
- **`app/utils/activity-format.ts`** — activity-feed lookup references `ICONS.*`.
- **`app/components/admin/AdminJobsPanel.vue`** — queue/state maps reference `ICONS.*`.
- All component/page call sites pass `ICONS.*` (auto-imported) — no raw
  `i-lineicons-*` literals remain in app code.
