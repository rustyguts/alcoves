---
name: frontend-design-review
description: >-
  Visual design review of frontend UI changes via Playwright screenshot e2e
  tests. Use AFTER any change under frontend/app/ (component, page, layout,
  style, composable that affects rendering) and BEFORE reporting the task done.
  Regenerates the committed snapshot PNGs for the affected flow(s), then reads
  the images and compares them against the prior committed version to confirm
  the UI still looks reasonable (layout, alignment, overflow, contrast, light +
  dark, responsive). Triggers on "design review", "check the UI", "screenshot
  review", "does it look right", or whenever a frontend feature is built/edited.
---

# Frontend Design Review

The Alcoves e2e suite doubles as a **visual snapshot generator**. Tests tagged
`@screenshot` call `snap(page, flow, name)` which writes a committed PNG to
`frontend/test/e2e/snapshots/<flow>/<name>.png`. These are artifacts, not
assertions — Playwright does NOT diff them. **You** are the diff: regenerate the
PNGs, then look at them.

Every time a frontend feature is worked on, run this review before claiming done.

## Step 1 — Find what changed, map to flow(s)

```bash
cd /home/rusty/code/rustyguts/alcoves
git diff --name-only HEAD -- frontend/app | sort
```

Map changed source areas to the e2e flow that screenshots them. `FLOW` const in
each `frontend/test/e2e/flows/<flow>.e2e.spec.ts` matches the snapshot subdir:

| Changed area (frontend/app/…) | Flow |
|---|---|
| `components/library/`, library browser/grid/list, file cards | `library-browser` |
| `pages/libraries/[id]/edit/`, video editor, waveform | `editor` |
| `pages/libraries/[id]/people/`, person/object UI | `library-people-objects` |
| library settings, members, invites tabs | `library-settings` |
| search, invite-accept | `search-invites` |
| modals, dialogs, confirm/upload sheets | `modals` |
| auth pages (login/register/oauth) | `auth` |
| profile / account | `profile` |
| admin pages, job queue | `admin` |
| anything that must hold up at mobile/tablet widths | `responsive` |

If unsure which flow, or the change is cross-cutting (layout, theme, global
component), run **all** screenshot tests. When in doubt, run more.

## Step 2 — Regenerate the snapshots

From `frontend/`. Playwright auto-starts `bun run dev` on :4173 (all API mocked,
no backend needed). Viewport 1440×900, dates/RNG frozen for determinism.

Targeted (preferred — one flow):
```bash
cd frontend
bunx playwright test test/e2e/flows/<flow>.e2e.spec.ts --grep @screenshot
```

All visual flows:
```bash
cd frontend
bun run test:e2e:screenshots   # == playwright test --grep @screenshot
```

A failing test means the page errored before the shot — fix that first; a
red test produces no/garbage PNG.

## Step 3 — See which PNGs actually moved

```bash
cd /home/rusty/code/rustyguts/alcoves
git status --porcelain frontend/test/e2e/snapshots
```

- **Modified** PNG → existing screen changed. Compare old vs new (Step 4).
- **Untracked** PNG → brand-new screen. Just inspect the new one.
- **No change** → render is byte-identical; nothing to review for that shot.

## Step 4 — Look at the images (this is the review)

For each changed/new PNG, **Read the file** so the image renders. The Read tool
displays PNGs visually — use it, do not just stat the file.

To compare against the committed baseline, dump the old version to a temp path
and Read both:

```bash
P=frontend/test/e2e/snapshots/<flow>/<name>.png
git show HEAD:$P > /tmp/old-$(basename $P)   # baseline
# then Read /tmp/old-<name>.png  AND  Read <P>  and compare
```

Judge each shot against this checklist:

- **Layout** — nothing overlapping, clipped, or overflowing its container
- **Alignment & spacing** — consistent gaps, no jarring misalignment vs siblings
- **Text** — no truncation/wrapping that breaks meaning; labels readable
- **Contrast** — text legible on its background in **both light and dark**
  (flows shoot both themes via `setTheme`)
- **Empty / loading / error states** — skeleton and empty variants still sane
- **Responsive** — if `responsive` flow ran, check mobile/tablet widths don't
  collapse or horizontal-scroll
- **Intent** — the change you made is actually visible and looks deliberate

## Step 5 — Verdict

- **Looks right** → say so, name the shots you inspected, and (if baselines
  moved intentionally) note the snapshots are updated and should be committed
  with the feature.
- **Regression / ugly** → it's a real UI bug. Fix the **source**, then re-run
  Steps 2–4. Never "fix" by accepting a bad snapshot.
- **Baseline legitimately changed** (intended redesign) → the updated PNGs are
  the new truth; include them in the same commit as the code.

## Notes

- Snapshots are committed artifacts (94 of them today). A frontend PR that
  changes rendering and leaves snapshots untouched is suspicious — either the
  change isn't covered by a `@screenshot` test (add one) or it didn't actually
  render.
- New screen with no coverage? Add a `@screenshot` test to the matching flow so
  future regressions are caught — mirror the existing `snap(page, FLOW, "...")`
  pattern in that flow file.
- This review is visual only. It does **not** replace the required
  `typecheck && lint && test:unit && playwright test` gate in CLAUDE.md — run
  that too.
