#!/usr/bin/env bash
# factory.sh — Poll the Alcoves project board for Ready issues and dispatch
# them to Claude Code via the /turn-off-the-lights skill.
#
# Usage:
#   ./scripts/factory.sh              # default 30-second poll interval
#   POLL_INTERVAL=60 ./scripts/factory.sh
#
# Stop with Ctrl-C or SIGTERM.

set -euo pipefail

REPO="rustyguts/alcoves"
PROJECT_NUMBER=4
PROJECT_OWNER="rustyguts"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

# Absolute path to this repo (so claude is always invoked in the right dir)
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

get_ready_issues() {
  gh project item-list "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" \
    --format json \
    --limit 100 \
    2>/dev/null \
  | jq -c '[.items[] | select(.status == "Ready" and .content.type == "Issue")] | first // empty'
}

handle_sigint() {
  echo ""
  log "Interrupted — shutting down factory."
  exit 0
}

trap handle_sigint INT TERM

log "Alcoves Software Factory started (repo: $REPO, poll interval: ${POLL_INTERVAL}s)"
log "Press Ctrl-C to stop."

while true; do
  log "Checking project board for Ready issues..."

  item="$(get_ready_issues)"

  if [[ -z "$item" ]]; then
    log "No Ready issues found. Sleeping ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
    continue
  fi

  issue_number="$(echo "$item" | jq -r '.content.number')"
  issue_title="$(echo "$item" | jq -r '.content.title')"

  log "Found Ready issue #${issue_number}: ${issue_title}"
  log "Dispatching to Claude Code..."

  (
    cd "$REPO_DIR"
    claude --dangerously-skip-permissions \
      --print \
      "/turn-off-the-lights"
  )

  log "Claude Code session complete. Resuming poll loop..."
  sleep "$POLL_INTERVAL"
done
