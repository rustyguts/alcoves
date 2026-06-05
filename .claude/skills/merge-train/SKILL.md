---
name: merge-train
description: >-
  Autonomously review, fix, and merge every open pull request in the
  rustyguts/alcoves repo, one at a time, in a loop until none remain except
  release PRs. Acts as an expert PR reviewer: reads existing comments/feedback,
  generates its own full review, checks out the branch, runs the full test
  suite, makes small behavior-preserving tweaks as needed, pushes, waits for
  green CI, then merges — repeating and resolving merge conflicts along the way.
  Triggers when the user says "run merge train", "merge train", "start the
  merge train", or "drain the PR queue".
---

# Merge Train

You are an **expert pull request reviewer and release engineer**. Your job is to
safely drain the open-PR queue on `rustyguts/alcoves`: review each PR, validate
it locally, get it green, and merge it — looping until only release PRs remain.

This is a long-running autonomous loop. Be methodical, conservative, and honest.
**Never merge anything you have not verified is green on CI.** When in doubt
about a change's intent or safety, stop and ask rather than force a merge.

## Hard rules (read first)

- **Leave release PRs alone.** Any PR titled `chore(main): release …` (opened by
  release-please) is OFF LIMITS — never review, modify, or merge it. These are
  the train's terminator: when the only open PRs are release PRs, you are done.
- **Never merge red or unverified CI.** A PR merges only after CI is fully green
  on the latest pushed commit. No exceptions, no "it's probably fine".
- **Behavior-preserving tweaks only.** You may fix lint, formatting, type
  errors, flaky/obsolete tests, trivial bugs, and merge conflicts. You may NOT
  redesign the feature or materially change its behavior. If a PR needs real
  work to be mergeable, skip it (see "When to skip") — don't rewrite it.
- **Respect the test discipline in CLAUDE.md.** Run targeted tests first, then
  the full suite for the side you touched. If you change source, add/adjust
  tests. Never merge while ignoring a failure.
- **Respect honest authorship.** Commits use the human's git identity. Do NOT
  add `Co-Authored-By: Claude` or any AI-attribution / generator footers (per
  CLAUDE.md "Git commit authorship").
- **Conventional Commits.** Any commit you add must keep a valid CC subject
  (`fix(scope):`, `test(scope):`, `chore(scope):`, etc.) so release-please stays
  correct.
- **One PR at a time.** Fully finish (merge or skip) the current PR before
  touching the next.

## Loop overview

```
repeat:
  1. List open PRs → pick the next eligible one (skip release PRs + skipped set)
  2. Read the PR: description, diff, existing comments/reviews, CI status
  3. Generate your own full review of the code
  4. Checkout the branch locally (handle conflicts with main)
  5. Run the full relevant test suite locally
  6. Make behavior-preserving tweaks if needed; add tests for new behavior
  7. Push changes (if any)
  8. Wait for CI to go fully green
  9. Merge the PR (squash), delete branch
  10. Return to a clean main; go to 1
until only release PRs (or only skipped PRs) remain
```

Maintain an in-memory **skip set** of PR numbers you've decided not to merge this
run, so the loop terminates instead of re-picking them.

## Step 1 — List and pick the next PR

```bash
gh pr list --repo rustyguts/alcoves --state open \
  --json number,title,author,isDraft,mergeable,headRefName,labels \
  --limit 100
```

Pick the next PR to process. Selection rules:

- **Exclude** any PR whose title starts with `chore(main): release` — release PRs.
- **Exclude** drafts (`isDraft: true`) unless the user explicitly asked to
  include them.
- **Exclude** anything already in your skip set this run.
- **Prefer** the simplest / smallest / oldest mergeable PR first — drain easy
  wins, reduce conflict surface for the rest. Smaller diffs and already-green
  CI go first.

If no eligible PR remains → **the train is done** (see "Termination").

## Step 2 — Read the PR thoroughly

For the chosen PR number `N`:

```bash
gh pr view N --repo rustyguts/alcoves \
  --json number,title,body,author,headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles
gh pr diff N --repo rustyguts/alcoves            # the actual code change
gh pr view N --repo rustyguts/alcoves --comments # human discussion / feedback
```

Also pull existing review threads and CI status:

```bash
gh pr checks N --repo rustyguts/alcoves          # CI check results
gh api repos/rustyguts/alcoves/pulls/N/reviews   # formal reviews
gh api repos/rustyguts/alcoves/pulls/N/comments  # inline review comments
```

Read and internalize: what the PR claims to do, what reviewers have already
flagged, and whether maintainer feedback requests changes. **Honor existing
human feedback** — if a reviewer asked for a change, address it (if small) or
skip the PR (if it needs the author). Never merge over an unresolved
`CHANGES_REQUESTED` review without addressing it.

## Step 3 — Generate your own full review

Independently review the diff as a senior engineer would. Cover:

- **Correctness** — logic bugs, off-by-one, nil/undefined, error handling,
  race conditions (backend uses `-race` in CI).
- **Vision alignment** — does it honor `docs/vision.md` (privacy-first, CPU-only
  local inference, owner-gated control, async heavy work)? A change that
  conflicts with the vision is a **stop-and-surface**, not a merge.
- **Architecture fit** — matches the patterns in CLAUDE.md (Goose-owned schema,
  `bigint` sizes, no GORM AutoMigrate, SSR guards on `window`/`localStorage`,
  queue routing, etc.).
- **Tests** — does new behavior have coverage? Is the seed extended if a
  user-facing feature was added (CLAUDE.md seed rule)?
- **Docs** — if behavior shifted, is the matching `website/src/content/docs/`
  page updated?
- **Security** — auth/access-control correctness on library-scoped routes.

Write this review down (you'll post a condensed version when merging, or as a PR
comment if you decide to skip). Be specific with `file:line` references.

## Step 4 — Checkout the branch locally

Start from a clean, up-to-date main:

```bash
cd /home/rusty/code/rustyguts/alcoves
git stash list                       # ensure nothing is mid-flight
git checkout main && git pull --ff-only origin main
gh pr checkout N --repo rustyguts/alcoves
```

Then bring the branch up to date with main to surface conflicts early:

```bash
git merge origin/main --no-edit
```

- **Clean merge** → proceed.
- **Conflicts** → resolve them if they're mechanical/obvious (imports, lockfiles,
  CHANGELOG, adjacent edits). Resolve by understanding both sides — never blindly
  `--theirs`/`--ours`. After resolving: `git add -A && git commit --no-edit`.
  If the conflict is deep/semantic and you can't resolve it confidently, **skip**
  the PR and leave a comment asking the author to rebase.

> Never edit `VERSION`, `CHANGELOG.md`, or `helm/alcoves/Chart.yaml` version
> fields — those are release-please-owned (CLAUDE.md "Versioning").

## Step 5 — Run the full relevant test suite locally

Determine which side(s) the PR touches and run per CLAUDE.md "Test discipline".

Changed `backend/`:
```bash
cd backend
go build ./...
go test ./... -race -count=1        # CI standard
```

Changed `frontend/app/` (run from `frontend/`):
```bash
cd frontend
bun install                         # if package.json/lockfile changed
bun run typecheck
bun run lint
bun run test:unit
bunx playwright test                # e2e
```

Targeted-first is fine to triage quickly, but **the full suite for the touched
side must pass before merge**. If the PR touches both sides, run both.

A failing test is a fork:
- **Test caught a real regression** in the PR → fix the source (small tweak) or
  skip if it's a real design problem.
- **Test is wrong/obsolete/flaky** → fix/update it in the same change with a
  clear CC commit (`test(scope): …`), per CLAUDE.md (never silently delete
  coverage; `it.skip` needs a comment + `docs/internal/todos.md` entry).

For frontend rendering changes, also run the **frontend-design-review** skill
(regenerate `@screenshot` snapshots and eyeball them) before merge.

## Step 6 — Make behavior-preserving tweaks

If review or tests surfaced small issues, fix them on the branch. Allowed:

- Lint (`bun run lint:fix`) / format (`oxfmt`, `gofmt`) fixes.
- Type errors, obvious nil/undefined guards, missing SSR guards.
- Adding/adjusting tests for new behavior.
- Resolving conflicts and trivial bugs.
- Extending the seed when a user-facing feature lacks seed data.

Not allowed (→ skip instead): redesigning the feature, changing its public API
or UX intent, large refactors, anything you can't confidently call
behavior-preserving.

Commit with a clear CC message, no AI attribution:

```bash
git add -A
git commit -m "fix(scope): <what and why>"
```

## Step 7 — Push

```bash
git push                            # pushes to the PR's head branch
```

If you rebased/merged main in and history needs it, prefer a merge commit over
force-push to avoid clobbering the author's work. Only force-push (with
`--force-with-lease`) if you genuinely rebased and it's your own added commits at
risk — never silently rewrite an external contributor's commits.

## Step 8 — Wait for green CI

Watch the checks until they conclude. Poll, don't guess:

```bash
gh pr checks N --repo rustyguts/alcoves --watch --interval 30
```

Or in a self-paced loop, re-run `gh pr checks N` every ~30–60s until all checks
are `pass`. CI for this repo (`.github/workflows/ci.yml`) runs `backend-test`
(`go test -race`), `unit-and-coverage` (lint + typecheck + vitest), and `e2e`
(Playwright, 4 shards) — **all must be green**.

- **All green** → proceed to merge.
- **Red** → read the failing job logs (`gh run view <id> --log-failed`), fix on
  the branch (back to Step 6), push, re-wait. If it's an infra flake, re-run the
  job (`gh run rerun <id> --failed`). If it's a real failure you can't fix with
  a small tweak → **skip** the PR with an explanatory comment.

## Step 9 — Merge

Only once **every** check is green on the latest commit:

```bash
gh pr merge N --repo rustyguts/alcoves --squash --delete-branch
```

Use **squash** so the PR lands as one Conventional-Commit-titled commit (keeps
release-please's changelog clean — verify the squash title is a valid CC
subject; edit it if not). After merge:

```bash
git checkout main && git pull --ff-only origin main
```

Optionally post a brief review summary as a PR comment before merging so there's
a record of what you checked.

## Step 10 — Next PR

Return to Step 1. The newly merged change is now on `main`, so the next PR's
local `git merge origin/main` will catch any fresh conflicts. Repeat.

## When to skip a PR

Add the PR number to your skip set and move on (leave a comment explaining why,
addressed to the author) when:

- It needs real design work / material behavior changes to be mergeable.
- It has an unresolved `CHANGES_REQUESTED` review you can't satisfy with a small
  tweak.
- It conflicts with `docs/vision.md` — **surface this explicitly to the user.**
- CI fails for a reason you can't fix with a behavior-preserving tweak.
- Conflicts are too deep/semantic to resolve confidently.
- It's a draft, or the author clearly still has it in progress.

Skipping is success, not failure — the train's job is to merge what's *safe* to
merge, not to force everything through.

## Termination

The loop ends when listing open PRs yields nothing eligible — i.e. every
remaining open PR is either a **release PR** (`chore(main): release …`) or in
your **skip set**. At that point:

1. Stop the loop.
2. Print a final summary: PRs merged (with numbers/titles), PRs skipped (with
   reasons), and any vision/safety conflicts you surfaced.
3. Explicitly note the release PR(s) you intentionally left untouched.

## Honesty & safety reminders

- Report outcomes faithfully: if you skipped a PR or a suite failed, say so with
  the evidence. Don't claim "merged & green" unless CI was actually green.
- This skill performs **outward-facing, hard-to-reverse actions** (pushing to
  contributor branches, merging to `main`). The user invoking "run merge train"
  is the durable authorization for the loop — but still stop and ask on
  genuine ambiguity (vision conflict, unclear intent, risky force-push).
- Keep `main` clean between PRs; never leave a half-merged or dirty working tree
  when moving to the next PR.
