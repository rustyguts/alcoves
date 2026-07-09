#!/usr/bin/env bash
#
# Deterministic visual-regression run. Baselines must be generated AND compared in
# the same environment, so this script always runs Playwright inside the pinned
# Playwright container (matching CI) against a host-run stack:
#
#   - The seeded Go API/Postgres/Dragonfly on host :3001 (docker compose).
#   - A production SvelteKit server on host :4173 (started here, under Bun).
#   - Playwright in mcr.microsoft.com/playwright:<pinned> via --network host.
#
# Usage:
#   scripts/screenshots.sh            # compare against committed baselines
#   scripts/screenshots.sh --update   # (re)generate baselines
#
# Prereqs: `docker compose up -d postgres dragonfly backend` (seeded) is running.
set -euo pipefail

PW_IMAGE="mcr.microsoft.com/playwright:v1.60.0-noble"
API_URL="${INTERNAL_API_URL:-http://localhost:3001}"
FRONT_PORT="${FRONTEND_PORT:-4173}"
UPDATE_ARG=""
if [[ "${1:-}" == "--update" ]]; then
	# `--update-snapshots` alone only rewrites baselines Playwright's pixel diff
	# flags as "changed" — it silently skips ones that are stale for a reason
	# the diff can't see (e.g. a still-passing-by-luck screenshot of the wrong
	# theme). That left 16 stale baselines uncaught this rework cycle. `all`
	# forces every baseline in the run to be rewritten unconditionally.
	UPDATE_ARG="--update-snapshots all"
fi

cd "$(dirname "$0")/.."

echo "→ Waiting for the seeded API at ${API_URL} ..."
for _ in $(seq 1 60); do
	if curl -sf "${API_URL}/api/health" >/dev/null 2>&1; then break; fi
	sleep 2
done
curl -sf "${API_URL}/api/health" >/dev/null || {
	echo "✗ API not reachable at ${API_URL}. Run: docker compose up -d postgres dragonfly backend" >&2
	exit 1
}

echo "→ Building the production SvelteKit server ..."
bun run build

echo "→ Starting SvelteKit on :${FRONT_PORT} ..."
FRONTEND_PORT="${FRONT_PORT}" INTERNAL_API_URL="${API_URL}" bun ./build/index.js >/tmp/alcoves_sk_server.log 2>&1 &
SK_PID=$!
trap 'kill ${SK_PID} 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
	if curl -sf "http://localhost:${FRONT_PORT}/login" >/dev/null 2>&1; then break; fi
	sleep 1
done
curl -sf "http://localhost:${FRONT_PORT}/login" >/dev/null || {
	echo "✗ SvelteKit server failed to start; see /tmp/alcoves_sk_server.log" >&2
	cat /tmp/alcoves_sk_server.log >&2 || true
	exit 1
}

echo "→ Running Playwright in ${PW_IMAGE} ..."
docker run --rm --network host --ipc=host \
	-e CI=1 \
	-e E2E_BASE_URL="http://localhost:${FRONT_PORT}" \
	-e INTERNAL_API_URL="${API_URL}" \
	-e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
	-e HOME=/tmp \
	-v "$(pwd)":/work -w /work \
	"${PW_IMAGE}" \
	npx playwright test ${UPDATE_ARG} \
	--project=desktop-light --project=desktop-dark \
	--project=mobile-light --project=mobile-dark

STATUS=$?

# The container writes baselines as root; hand them back to the invoking user.
if command -v sudo >/dev/null 2>&1; then
	sudo chown -R "$(id -u):$(id -g)" test/e2e/__screenshots__ test-results 2>/dev/null || true
else
	docker run --rm -v "$(pwd)":/work -w /work "${PW_IMAGE}" \
		chown -R "$(id -u):$(id -g)" test/e2e/__screenshots__ test-results 2>/dev/null || true
fi

exit "${STATUS}"
