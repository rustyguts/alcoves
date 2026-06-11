---
name: graphify-setup
description: Install, build, and refresh the graphify code knowledge graph for this repo so Claude Code can query it instead of grepping. Activates on "set up graphify", "install graphify", "build/regenerate the knowledge graph", "rebuild the graphify graph", "update graphify", or when graphify-out/ is missing/stale.
---

# graphify setup & maintenance

[graphify](https://github.com/safishamsi/graphify) turns this repo into a queryable
code knowledge graph (`graphify-out/graph.json`: nodes = files/functions/symbols,
edges = calls/relationships, Leiden community clusters). Claude Code is wired to
consult it before grepping — see the **graphify** section in `CLAUDE.md` and the
`PreToolUse` hooks in `.claude/settings.json` (committed; they no-op when the graph
is absent, so they're safe for contributors who haven't built it).

`graphify-out/` is **gitignored** — each machine builds its own copy with the steps
below. The graph build is local and (in the no-key path) makes **no API calls**.

## Prerequisites

- `uv` (https://docs.astral.sh/uv/) and Python ≥ 3.10 (`uv` will manage the runtime).
- *Optional*, only for semantic community names: an LLM key in the environment —
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, or `OPENAI_API_KEY`.
  Without one the graph still builds fully (AST + clustering); communities are just
  named `Community N` until you run `graphify label .` with a key set.

## 1. Install the CLI (once per machine)

```bash
uv tool install graphifyy        # PyPI package is `graphifyy` (double-y); CLI is `graphify`
graphify --version
```

## 2. Build the graph (run from the repo root)

```bash
# No-LLM structural build — AST extraction + clustering, no API cost. Preferred default.
graphify update .
```

`graphify update .` respects `.gitignore` (skips `node_modules/`, `.output/`,
`.claude/worktrees/`, etc.) and writes `graphify-out/graph.json` + `GRAPH_REPORT.md`.
For ~the alcoves repo this is ≈5.5k nodes / 12k edges and takes well under a minute.
(The HTML viz is auto-skipped above the 5000-node limit — the JSON is what Claude queries.)

**With an API key** (adds semantic community names): `export ANTHROPIC_API_KEY=…` then
`graphify .` for a full build, or `graphify label .` to name communities on an
existing graph. (`graphify .` defaults to AWS Bedrock if it finds no key and will
fail at the semantic step — use `graphify update .` when you have no key.)

## 3. Claude Code integration (already committed — re-run only if it's missing)

```bash
graphify claude install          # (re)writes the CLAUDE.md graphify section + PreToolUse hooks
```

After this, Claude consults the graph automatically. Use it directly too:

```bash
graphify query "how does the image proxy cache transformed images?"
graphify explain "NewServiceWithIngest"
graphify path "tusHandler" "filehash.Service"
graphify affected "models.File"      # what breaks if this changes
```

Optional MCP server (structured tools `query_graph`, `get_node`, `shortest_path`, …):
`python -m graphify.serve graphify-out/graph.json`.

## 4. Keep it current

- After code changes: `graphify update .` (fast, AST-only, no API cost).
- Or auto-rebuild on commit/checkout: `graphify hook install` (git hooks).
- `graphify watch .` rebuilds on file changes during a working session.

## Troubleshooting

- **`all semantic chunks failed for backend 'bedrock'`** — no API key; use
  `graphify update .` (no-LLM) instead of `graphify .`.
- **`graph has N nodes - too large for HTML viz`** — expected for this repo; the
  `graph.json` (what Claude uses) is still written. Raise `GRAPHIFY_VIZ_NODE_LIMIT`
  or pass `--no-viz` if you want the HTML anyway.
- **Hook noise for contributors without the graph** — none: the hooks guard on
  `[ -f graphify-out/graph.json ]` and no-op when it's absent.
