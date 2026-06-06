#!/usr/bin/env bash
# Alcoves unified-image supervisor.
#
# The production image bundles the Go API/worker binary AND the SvelteKit
# (adapter-node) server, so a single container can run the whole stack. The first
# argument selects which role(s) to run:
#
#   all     (default) — Go API+worker on :3001 AND SvelteKit on :3000, supervised
#                       together. If either process exits, the other is stopped
#                       and the container exits non-zero so the orchestrator
#                       restarts it (we never limp along serving half the stack).
#   web                — only the SvelteKit server (frontend + SSR share pages)
#   api                — only the Go process with ALCOVES_MODE=api
#   worker             — only the Go process with ALCOVES_MODE=worker
#
# `web | api | worker` exist so the same image can back split Kubernetes
# deployments (independent scaling, the worker's large memory budget, etc.).
#
# tini is PID 1 (see the image ENTRYPOINT): it reaps zombies and delivers
# signals here. The single-role paths `exec` their process so signals reach it
# directly; the `all` path traps SIGTERM/SIGINT and forwards them to both
# children for a graceful shutdown.

set -euo pipefail

ROLE="${1:-all}"

GO_BIN="/app/alcoves"
SVELTE_ENTRY="/app/build/index.js"

case "${ROLE}" in
  web)
    # The SvelteKit adapter-node server reads FRONTEND_HOST/FRONTEND_PORT/etc. and
    # INTERNAL_API_URL from the environment (defaulted in the Dockerfile,
    # overridable per-deployment).
    exec bun "${SVELTE_ENTRY}"
    ;;
  api)
    export ALCOVES_MODE="api"
    exec "${GO_BIN}"
    ;;
  worker)
    export ALCOVES_MODE="worker"
    exec "${GO_BIN}"
    ;;
  all)
    : # fall through to the supervisor below
    ;;
  *)
    echo "alcoves entrypoint: unknown role '${ROLE}' (want: all | web | api | worker)" >&2
    exit 64
    ;;
esac

# ---------------------------------------------------------------------------
# role=all — run both processes under a tiny supervisor.
# ---------------------------------------------------------------------------

# ALCOVES_MODE defaults to "all" (API + worker in one Go process). Honor an
# explicit override (e.g. run the Go side api-only while still serving the UI).
export ALCOVES_MODE="${ALCOVES_MODE:-all}"

pids=()

shutdown() {
  trap - TERM INT
  for pid in "${pids[@]}"; do
    kill -TERM "${pid}" 2>/dev/null || true
  done
  wait || true
}

trap 'shutdown; exit 0' TERM INT

echo "alcoves: starting Go (ALCOVES_MODE=${ALCOVES_MODE}) on :${PORT:-3001} and SvelteKit on :${FRONTEND_PORT:-3000}"

"${GO_BIN}" &
pids+=("$!")

bun "${SVELTE_ENTRY}" &
pids+=("$!")

# Wait for the first child to exit, capture its status, then tear the other one
# down so the container as a whole restarts.
set +e
wait -n
first_status=$?
set -e

echo "alcoves: a supervised process exited (status ${first_status}); stopping the container" >&2
shutdown

# Propagate a non-zero status so Docker/Kubernetes restart policies engage even
# when the first process exited cleanly — a half-running stack is still a fault.
if [ "${first_status}" -eq 0 ]; then
  exit 1
fi
exit "${first_status}"
