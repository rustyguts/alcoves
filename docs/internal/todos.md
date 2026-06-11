# Alcoves — Open Improvements

Generated 2026-04-25; **audited 2026-06-04** against the current code (items 3–7
from the original list shipped and were moved to Completed). Completed items
archived at the bottom.

## 1. Rate limiting on auth + share endpoints (Security) — OPEN

- **What:** Still no rate-limit middleware anywhere in the backend (verified
  2026-06-04: no `RateLimiter` usage, no `ratelimit.go`, no limiter dependency in
  `go.mod`). Add an Echo rate limiter to `/api/auth/login`,
  `/api/auth/register`, `/api/share/:token/*`, `/api/invites`.
- **Why now:** Self-hosted but exposed-to-internet by design. Brute force on
  login + share-token enumeration both trivial today.
- **Effort:** S
- **Risk:** Low if applied per-route. Keep limits generous initially.
- **Files:** `backend/cmd/server/main.go`, new `backend/internal/middleware/ratelimit.go`.


## 2. Testing — remaining gaps (Testing) — PARTIAL

Most of the original cold spots are closed: every backend service package and all
21 handlers now have tests; backend coverage is 80%+ (#551) and frontend unit
coverage 90%+ (#549). What remains (audited 2026-06-04):

### Nuxt 4 route-mock limitation — STILL OPEN (highest-leverage)

23 unit tests are skipped (down from 25), 12 of them in
`useLibraryExplorer.spec.ts`, because `useRoute`/`useRouter` auto-import from
`#app/composables/router` and aren't intercepted by `vue-router`/`#imports`
mocks (mocking the real module breaks Nuxt plugins). No
`mountSuspended`-with-injected-`_route` helper has been adopted yet. Other
skipped files: `pages/login.spec.ts` (3), `pages/library-tags.spec.ts` (2),
`layouts/library.spec.ts` (2), `composables/useAuth.spec.ts` (1),
`pages/invites-token.spec.ts` (1), `pages/search.spec.ts` (1),
`e2e/tus-upload.e2e.spec.ts` (1).

**Follow-up:** adopt `mountSuspended` from `@nuxt/test-utils/runtime` with a
custom test app injecting a real `_route` ref into `useNuxtApp()`, then un-skip
the route-dependent specs. Each `it.skip` already carries a comment + this todo
line as the breadcrumb.

### Thin spots worth lifting

- `internal/services/objectdetection` measured **56.1%** (2026-06-04) — below the
  60% per-file floor; add a few more cases. (`facedetection` 68.2%, `filehash`
  92.4% are fine; `transcribe`/`audiodetection`/`momentexport`/`auth` have
  substantial suites but weren't re-measured — DB/ffmpeg/onnxruntime-bound.)
- `useLibrariesList` composable has no spec — a trivial 12-line register/refresh
  helper; add a small test or accept the gap.

### E2e

E2e green. Watch for snapshot drift after Tailwind/font changes —
`bunx playwright test --update-snapshots <flow>` to re-baseline.


## 8. Map view leaks photo locations to the public OSM tile server by default (Privacy)

- **What:** The library Map view (`frontend/app/components/LibraryMap.client.vue`) defaults its raster tiles to `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (`NUXT_PUBLIC_MAP_TILE_URL` in `nuxt.config.ts`). Every pan/zoom sends the viewed bounding box — i.e. roughly *where the user's private photos were taken* — to a third-party server. Self-hosters can override the URL, but the **default** still leaks, which is in tension with the vision's privacy-first pillar (`docs/vision.md`).
- **Why not fixed now:** the obvious privacy-preserving alternative — self-hosting a tile server — incurs real cost/ops (storage + bandwidth for the planet, or a paid tile provider). Needs a product call on the right default before changing it.
- **Options to weigh:**
  - Ship **no tiles until configured** (map shows markers on a blank/grey canvas with a "configure a tile server" hint) — privacy-safe default, degraded out-of-box UX.
  - Keep OSM as default but add a **prominent one-time in-UI notice** that tile requests reveal the viewed area to openstreetmap.org, with a link to the override env var.
  - Document/recommend a cheap self-host (e.g. a `protomaps`/`pmtiles` single-file basemap served from existing storage) and a paid-provider option (MapTiler/Stadia) for those who prefer it.
  - Also: verify the public OSM tile **usage policy** is acceptable for a self-hosted app (bulk/systematic use is discouraged; a valid identifying header is required).
- **Effort:** S (notice) → M (pmtiles basemap path).
- **Risk:** Low code-wise; this is mainly a product/privacy decision. Tracked from the PR #552 review.


## 9. Publish the catalogued-but-missing audio-tagger models (ML) — OPEN

- **What:** Five of the seven models in `audiodetection.Registry` were never
  uploaded to the model bucket — `efficientat_mn04_as.onnx`,
  `efficientat_mn40_as_ext.onnx`, `ced_tiny.onnx`, `ced_small.onnx`,
  `ced_base.onnx` all 404 at `https://s3.rustyguts.net/models/` (verified
  2026-06-04 against the live bucket listing; only `efficientat_mn10_as.onnx`
  and `panns_cnn14.onnx` are present). Selecting any of them used to fail every
  audio-detect job with a 404 at model-download time ("ced_base.onnx 404").
- **Interim fix (2026-06-04):** added `ModelSpec.Available` and gated the
  catalog — `IsValidModelID` rejects unavailable models, `LookupSpec` falls
  back to the default for a stored-but-unavailable selection (self-heals an
  admin who already picked `ced_base`), and the admin picker renders them
  disabled ("— not yet available"). Jobs no longer fail; the unpublished models
  are simply not selectable yet.
- **To actually ship them:** run the export + publish flow in
  `docs/internal/publishing-models.md` (`scripts/export-audio-tagger.py` →
  rclone to `rustyguts:models/`), then flip `Available: true` on the matching
  registry entries AND set `available: true` in the `audioTaggers` array in
  `frontend/app/pages/admin/index.vue`, in the SAME change. Update the Status
  columns in `website/.../features/audio-detection-and-transcription.md` and
  `website/.../architecture/ml-models-runtime.md`.
- **Effort:** M (export needs a torch venv; uploads are 5–330 MB each).
- **Risk:** Low — gated behind `Available`; a half-finished upload just stays
  unselectable.


## 10. SvelteKit `client/` — restore dropped full-stack e2e flows (Testing) — OPEN

- **What:** The SvelteKit rewrite (`client/`) ships a leaner Playwright suite than
  the old Nuxt app had. The full-stack flows currently covered are **auth**
  (`auth.e2e.ts`), **library browser** (`library.e2e.ts`), **public share**
  (`share.e2e.ts`), and **admin owner-gating** (`admin.e2e.ts`). The unit suite is
  comprehensive (≥90% line coverage, per-file 60% floor), so these gaps are
  e2e-only — the underlying logic is unit-tested, but the real-stack golden path
  isn't exercised end-to-end.
- **Dropped vs. the old Nuxt flows** (`frontend/test/e2e/flows/`, now removed):
  `editor` (timeline editor + moment export), `people-objects` (face grid + object
  labels), `settings` (library settings + reprocess), `modals` (confirm/share/upload
  dialogs), `notifications` (bell + WS/SSE feed), `profile` (avatar upload + profile
  edit), `responsive` (mobile drawer / breakpoints), `search-invites` (cross-library
  search + invite redemption). The old `screenshots` snapshot flow was also not
  ported.
- **Why now:** the rewrite landed with the four highest-value smokes green against
  the seeded stack; the rest were deferred to keep the cutover PR reviewable. Each
  is a straightforward port — `login()` helper + navigate + assert against seed data
  (`backend/internal/seed`). Add them back incrementally.
- **Effort:** S–M per flow (mostly selector/seed-data wiring; no new infra — the CI
  `e2e` job already boots postgres + dragonfly + the Go API with `ALCOVES_SEED=true`).
- **Risk:** Low — additive test coverage only.
- **Files:** `client/test/e2e/*.e2e.ts`, `client/test/e2e/helpers/`.


## 11. MCP OAuth 2.1 — deferred hardening (Security/Ops) — OPEN

The OAuth authorization server (shipped in `feat/mcp-oauth`, gated by
`ALCOVES_MCP_OAUTH_ENABLED`) closed its high/medium review findings in the same
PR (loopback-spoof redirect bypass, RFC 8707 audience validation on both
issue+validate sides, bearer-verifier error masking, startup fail-fast, refresh
reuse cascading to access tokens, non-positive TTL clamp, scope normalization,
atomic code consume+issue, consent `state` binding). These lower-severity items
were consciously deferred:

- **Public DCR has no rate-limit or client cap** — `POST /api/oauth/register`
  mints an `oauth_clients` row per call with no throttle. Bounded-trust
  deployment limits the blast radius, but pairs with item 1 (general rate
  limiting). Files: `backend/internal/handlers/oauth_server.go`.
- **No GC of expired/consumed/revoked OAuth rows** — `oauth_authorization_codes`
  (consumed), `oauth_access_tokens`/`oauth_refresh_tokens` (expired/revoked)
  accumulate forever; expired rows are logically rejected but never deleted. Add
  a `Service.PurgeExpired(ctx)` swept by the existing maintenance loop
  (`metadata.StartMaintenance`/`jobreaper` pattern in `main.go`).
- **Consent token is stateless (not single-use)** — a captured consent token can
  mint multiple codes within its 10-min window (each code is still independently
  single-use + PKCE + redirect-bound). Track a server-side `jti` or bind it to
  the issued code if true one-time semantics are wanted (plan S6).
- **`grant_types` / `token_endpoint_auth_method` registered but not enforced** —
  the token endpoint accepts any grant regardless of the client's registered
  `grant_types`, and DCR silently downgrades a confidential-client request to
  public (`none`) instead of `invalid_client_metadata`. Harmless for the single
  public-client model; reject/enforce if multiple client types are introduced.
- **Echo `Logger` logs the `/api/oauth/authorize` query string** (`state`,
  `code_challenge` — both non-secret). No token/code is logged, but a Skipper
  redacting `/api/oauth/*` + `/api/mcp` query strings is cheap defense-in-depth.
- **No client-existence check on the refresh grant** — a refresh token survives
  out-of-band deletion of its `oauth_clients` row until expiry (no in-app client
  deletion path exists today). Look up the client in the token handler if one is
  added.
- **Migration `00025` is not exercised by a migration test** — the OAuth tests
  build their schema via GORM `AutoMigrate`, so SQL/model drift in
  `00025_oauth_mcp.sql` would go uncaught (existing repo-wide pattern).

- **Effort:** S–M each. **Risk:** Low (feature is default-off, bounded-trust).
- **Files:** `backend/internal/services/oauth/*`, `backend/internal/handlers/oauth_server.go`, `backend/cmd/server/main.go`.


---

## Completed

- **Bulk transcribe + audio-detect for admins** (verified 2026-06-04) —
  `POST /api/libraries/:id/files/bulk-transcribe` + `bulk-audio-detect`
  (`backend/internal/handlers/file.go`), where an empty `fileIds` array means
  "every eligible file in the library"; asynq-deduped, returns HTTP 202 with
  `{enqueued, skipped}`. Frontend file-grid context-menu actions ("Transcribe /
  Detect audio in N file(s)") in `libraries/[id]/index.vue` and library-settings
  reprocess cards in `settings.vue`. Handler tests in
  `file_full_test.go` / `file_enqueue_test.go`.
- **Editor back button respects current folder** (verified 2026-06-04) —
  `goBack()` in `edit/[fileId].vue` reads `route.query.from` and returns to that
  folder (falling back to library root only when absent); `index.vue` seeds
  `?from=<folderId>` when opening the editor.
- **File-list border softened in both themes** (verified 2026-06-04) —
  `LibraryEntriesTable.vue` uses `divide-default/60` + `border-default` (soft
  semantic tokens that adapt light/dark); no hard `border-neutral-*` remains.
- **Editor video frame 16:9, fits without crop** (verified 2026-06-04) —
  `VideoEditorPlayer.vue` computes the largest 16:9 box via a ResizeObserver and
  letterboxes the `<video>` with `object-fit: contain`; the cell is height-capped
  (`max-h-[600px]`) in `index.vue`, so vertical/square/odd sources never overflow
  or crop.
- **Library/grid cards 16:9 + width cap** (verified 2026-06-04) —
  `LibraryEntryCard.vue` thumbnail is `aspect-video`; `LibraryEntriesGrid.vue`
  caps card width via `grid-cols-[repeat(auto-fill,minmax(220px,320px))]` (the cap
  is enforced through the grid track range rather than a `max-w-*` utility).
- **OAuth CSRF state fix** (2026-04-25) — 32-byte crypto-random state, HttpOnly cookie, constant-time compare, 5 unit tests.
- **Handler test coverage for security-critical paths** (2026-04-25) — `oauth_test.go`, `share_test.go`, `moment_share_test.go`, `member_test.go`, `library_test.go` added; cleanup migrated to `TRUNCATE … CASCADE`; `download.go` Serve now `HasProcessor()`-guarded.
- **Whisper model upgrade to large-v3-turbo-q5_0** (2026-04-25, **rolled back 2026-04-26**) — large-v3-turbo-q5_0 ran at ~0.5× realtime on production CPU and got OOM-killed on long files, despite the docs/benchmark claim of 10× realtime. Rolled `ALCOVES_WHISPER_MODEL` default back to `base` in `config.go` + `helm/values.yaml`; updated `docs/internal/models.md` + `models/README.md` to reflect status. `ggml-large-v3-turbo-q5_0.bin` (574 MB) stays published at `https://s3.rustyguts.net/models/` for opt-in via `ALCOVES_WHISPER_MODEL=large-v3-turbo-q5_0` on capable hardware.
- **Transcribe progress reporting fix** (2026-04-26) — two bugs surfaced by the bigger model: (a) whisper-cli's stdout/stderr were fully-buffered when piped, hiding per-segment lines for many minutes; (b) `-pp` only ticks every 5%, which on slow CPU = many minutes between updates. Fix in `backend/internal/services/transcribe/worker.go`: wrap whisper-cli with `stdbuf -oL -eL` (LD_PRELOAD-injected libstdbuf.so flushes on every newline), parse `[hh:mm:ss --> hh:mm:ss]` segment lines for smooth per-chunk progress, derive audio duration from the extracted WAV's file size. Extracted `progressTracker` struct with monotonic emit + 99% clamp; 6 new unit tests in `worker_test.go`.
- **Split 699-line video editor page** (2026-04-25) — page 699 → 338 lines; logic extracted into 7 composables + 1 util + 1 header component; `job-status-button.spec.ts` covers the pure mapper.
- **Backend tests in CI** (2026-04-25) — new `backend-test` workflow job: pgvector :5455, libvips-dev, onnxruntime v1.25.0, `go test ./... -race -count=1`.
- **Test discipline added to CLAUDE.md** (2026-04-26) — mandatory targeted-then-full test gate, fix-or-update-or-skip-with-paper-trail rule, Nuxt 4 mocking gotchas.
- **Avatar WebP conversion** (2026-04-26) — new `backend/internal/services/avatarproc/` package: validates input (≤8 MB, decodable image), EXIF auto-rotate, center-crop to square, downscale to ≤512px, WebP quality 85. 9 unit tests on the pure function. Handler updated to call `avatarproc.Process` and translate `ErrEmptyInput`/`ErrInputTooLarge`/`ErrInvalidImage` into 400/413/400 HTTP errors. Bonus: added missing `GET /api/auth/me/avatar` + `GET /api/auth/users/:userId/avatar` endpoints (the upload always wrote `avatarUrl` but no read route existed); responses set `Content-Type: image/webp` and `Cache-Control: private, max-age=300`.
- **README accuracy** (2026-04-26) — fixed "Vue 3 + Vite SPA" → "Nuxt 4 (Vue 3 + Nitro server)"; updated all "localhost:3001" / "localhost:5173" user-facing URLs to "localhost:3000" (Nuxt); rewrote container-image section to clarify the published image is API-only and the frontend ships as a separate image (`frontend/Dockerfile`); production docker-compose example now includes both `api` and `frontend` services with reverse-proxy guidance; project structure no longer references the deleted `internal/spa/` directory; dropped DaisyUI from acknowledgments.
