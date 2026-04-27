# Alcoves — Open Improvements

Generated 2026-04-25 from repo snapshot. Completed items archived after merge.

## 1. Rate limiting on auth + share endpoints (Security)

- **What:** No `RateLimit` middleware anywhere in backend. Add Echo rate limiter to `/api/auth/login`, `/api/auth/register`, `/api/share/:token/*`, `/api/invites`.
- **Why now:** Self-hosted but exposed-to-internet by design. Brute force on login + share-token enumeration both trivial today.
- **Effort:** S
- **Risk:** Low if applied per-route. Keep limits generous initially.
- **Files:** `backend/cmd/server/main.go`, new `backend/internal/middleware/ratelimit.go`.


## 2. Testing gaps — fill the cold spots (Testing) — PARTIAL 2026-04-26

**Status:** Frontend 511 pass / 25 skip / 0 fail. Backend all packages green. Suite rot cleared. Coverage still uneven.

### Remaining backend test gaps

| Package | Coverage | Status |
|---|---:|---|
| `internal/services/transcribe` | smoke only | needs end-to-end worker test with fixture audio |
| `internal/services/audiodetection` | smoke only | same |
| `internal/services/momentexport` | smoke only | same — exercise ffmpeg path |
| `internal/services/objectdetection` | 0% | no tests at all |
| `internal/services/facedetection` | 9.3% | thin |
| `internal/services/filehash` | 6.6% | thin |
| `internal/services/auth` | 12.8% | partial |
| `internal/handlers` | 19.9% | broad-but-shallow |

**Untested handlers (10 of 21):** `admin`, `admin_jobs`, `avatar`, `file`, `folder`, `highlight_filter`, `moment`, `objects`, `people`, `validator`. Start with `file`, `folder`, `moment`, `highlight_filter`, `avatar` — user-data CRUD.

### Skipped frontend tests (25) — Nuxt 4 route-mock limitation

Nuxt auto-imports `useRoute`/`useRouter` from `#app/composables/router`. `vue-router`/`#imports` mocks don't intercept. Mocking `#app/composables/router` directly breaks Nuxt plugins. Affected files:

- `useLibraryExplorer.spec.ts` — 12 skipped
- `library.spec.ts` layout — 4 skipped
- `LibraryTabs.spec.ts` — 4 skipped
- `pages/search.spec.ts` — 1 skipped
- `pages/library-tags.spec.ts` — 2 skipped
- `pages/invites-token.spec.ts` — 1 skipped
- `composables/useAuth.spec.ts` — 1 skipped

**Follow-up:** adopt `mountSuspended` from `@nuxt/test-utils/runtime` with a custom test app injecting a real `_route` ref into `useNuxtApp()`. Each `it.skip` has a comment + this todo line as the breadcrumb.

### Untested frontend composables (8 of 23)

`useAsyncJobStatus`, `useAudioDetections`, `useAudioDetectJob`, `useEditorHighlights`, `useHighlightFilters`, `useLibrariesList`, `useLibraryMoments`, `useTranscribeJob`, `useTranscript`. Most are editor composables from refactor #5.

### E2e

E2e currently green (94 pass / 5 skip / 0 fail). Watch for snapshot drift after Tailwind/font changes — `bunx playwright test --update-snapshots <flow>` to re-baseline.

---

## Completed

- **OAuth CSRF state fix** (2026-04-25) — 32-byte crypto-random state, HttpOnly cookie, constant-time compare, 5 unit tests.
- **Handler test coverage for security-critical paths** (2026-04-25) — `oauth_test.go`, `share_test.go`, `moment_share_test.go`, `member_test.go`, `library_test.go` added; cleanup migrated to `TRUNCATE … CASCADE`; `download.go` Serve now `HasProcessor()`-guarded.
- **Whisper model upgrade to large-v3-turbo-q5_0** (2026-04-25, **rolled back 2026-04-26**) — large-v3-turbo-q5_0 ran at ~0.5× realtime on production CPU and got OOM-killed on long files, despite the docs/benchmark claim of 10× realtime. Rolled `ALCOVES_WHISPER_MODEL` default back to `base` in `config.go` + `helm/values.yaml`; updated `docs/models.md` + `models/README.md` to reflect status. `ggml-large-v3-turbo-q5_0.bin` (574 MB) stays published at `https://s3.rustyguts.net/models/` for opt-in via `ALCOVES_WHISPER_MODEL=large-v3-turbo-q5_0` on capable hardware.
- **Transcribe progress reporting fix** (2026-04-26) — two bugs surfaced by the bigger model: (a) whisper-cli's stdout/stderr were fully-buffered when piped, hiding per-segment lines for many minutes; (b) `-pp` only ticks every 5%, which on slow CPU = many minutes between updates. Fix in `backend/internal/services/transcribe/worker.go`: wrap whisper-cli with `stdbuf -oL -eL` (LD_PRELOAD-injected libstdbuf.so flushes on every newline), parse `[hh:mm:ss --> hh:mm:ss]` segment lines for smooth per-chunk progress, derive audio duration from the extracted WAV's file size. Extracted `progressTracker` struct with monotonic emit + 99% clamp; 6 new unit tests in `worker_test.go`.
- **Split 699-line video editor page** (2026-04-25) — page 699 → 338 lines; logic extracted into 7 composables + 1 util + 1 header component; `job-status-button.spec.ts` covers the pure mapper.
- **Backend tests in CI** (2026-04-25) — new `backend-test` workflow job: pgvector :5455, libvips-dev, onnxruntime v1.24.1, `go test ./... -race -count=1`.
- **Test discipline added to CLAUDE.md** (2026-04-26) — mandatory targeted-then-full test gate, fix-or-update-or-skip-with-paper-trail rule, Nuxt 4 mocking gotchas.
- **Avatar WebP conversion** (2026-04-26) — new `backend/internal/services/avatarproc/` package: validates input (≤8 MB, decodable image), EXIF auto-rotate, center-crop to square, downscale to ≤512px, WebP quality 85. 9 unit tests on the pure function. Handler updated to call `avatarproc.Process` and translate `ErrEmptyInput`/`ErrInputTooLarge`/`ErrInvalidImage` into 400/413/400 HTTP errors. Bonus: added missing `GET /api/auth/me/avatar` + `GET /api/auth/users/:userId/avatar` endpoints (the upload always wrote `avatarUrl` but no read route existed); responses set `Content-Type: image/webp` and `Cache-Control: private, max-age=300`.
- **README accuracy** (2026-04-26) — fixed "Vue 3 + Vite SPA" → "Nuxt 4 (Vue 3 + Nitro server)"; updated all "localhost:3001" / "localhost:5173" user-facing URLs to "localhost:3000" (Nuxt); rewrote container-image section to clarify the published image is API-only and the frontend ships as a separate image (`frontend/Dockerfile`); production docker-compose example now includes both `api` and `frontend` services with reverse-proxy guidance; project structure no longer references the deleted `internal/spa/` directory; dropped DaisyUI from acknowledgments.
