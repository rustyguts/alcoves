# CODEX.md

OpenAI Codex-specific working guidance for this repository.

Codex should treat `AGENTS.md` as the primary repository instruction set.
This file adds Codex-focused operational notes.

## Codex Execution Notes

- Follow `AGENTS.md` for architecture, commands, and repo rules.
- Prefer `rg`/`rg --files` for search and discovery.
- Use minimal, targeted edits; avoid unrelated code movement.
- Before finalizing, run the most relevant lint/tests for changed areas.
- Report exactly what was changed, which commands were run, and any remaining risks.

## Fast Command Reference

- `bun run dev`
- `bun run typecheck`
- `bun run lint`
- `bun run test:unit`
- `bun run test:e2e`
- `bun run test`

## Safety

- Do not revert unrelated user changes.
- Do not run destructive git commands unless explicitly requested.
- If blocked by missing env/services (DB, OAuth, storage), continue as far as possible and report the blocker clearly.
