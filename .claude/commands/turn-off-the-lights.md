## Workflow

This workflow instructs agents to work on issues from githib in and end-to-end fashion

## Project Board Reference

- **Project number:** 4 (`PVT_kwHOAIy35s4BPqTK`)
- **Status field ID:** `PVTSSF_lAHOAIy35s4BPqTKzg-AY68`
- **Status option IDs:**
  - Ready: `61e4505c`
  - In progress: `47fc9ee4`
  - In review: `df73e18b`
  - Done: `98236657`

### 0. Prepare the workspace

- Stash any uncommitted changes on the current branch
- Checkout `main` and pull with rebase

### 1. Pick an issue from Ready

```bash
gh project item-list 4 --owner rustyguts --format json | jq '[.items[] | select(.status == "Ready" and .content.type == "Issue")]'
```

Pick the first item. Note its `id` (the project item ID, e.g. `PVTI_...`) and the issue number.

### 2. Read the ticket

```bash
gh issue view <issue-number> --repo rustyguts/alcoves
```

### 3. Move to "In Progress"

```bash
gh project item-edit \
  --id <project-item-id> \
  --field-id PVTSSF_lAHOAIy35s4BPqTKzg-AY68 \
  --project-id PVT_kwHOAIy35s4BPqTK \
  --single-select-option-id 47fc9ee4
```

### 4. Implement the ticket

Create a branch named after the issue (e.g. `git checkout -b issue-<number>-short-description`), then implement the changes.

### 5. Write tests for the code

Follow the testing conventions in this file. Run targeted tests first.

### 6. Run all linting and tests

**Frontend** (from `frontend/`):

```bash
bun run lint && bun run fmt:check && bun run typecheck && bun run test:unit
```

**Backend** (from `backend/`):

```bash
go test ./...
```

Fix any issues before proceeding.

### 7. Open a PR with the code changes

Include `Closes #<issue-number>` in the PR body to link the issue:

```bash
gh pr create \
  --repo rustyguts/alcoves \
  --title "<descriptive title>" \
  --body "$(cat <<'EOF'
## Summary
<bullet points>

## Test plan
<checklist>

Closes #<issue-number>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 8. Add the PR to the project board and move ticket to "In Review"

Add the PR to the project:

```bash
gh project item-add 4 --owner rustyguts --url <PR_URL>
```

Move the issue to "In Review":

```bash
gh project item-edit \
  --id <project-item-id> \
  --field-id PVTSSF_lAHOAIy35s4BPqTKzg-AY68 \
  --project-id PVT_kwHOAIy35s4BPqTK \
  --single-select-option-id df73e18b
```

### 9. Done

Report the PR URL to the user.