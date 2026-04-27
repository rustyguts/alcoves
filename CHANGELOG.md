# Changelog

All notable changes to Alcoves are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html), capped
at `0.x.y` until an explicit `1.0.0` decision (alpha software).

The history below covers the modern Alcoves era — the current Go (Echo) +
Vue/Nuxt stack — beginning October 2025. Earlier history (a video site under
the `bken-io` name plus several abandoned framework experiments — Remix,
SvelteKit, Django, Go templ) is collapsed into the `0.0.0` entry.

## [Unreleased]

## [0.14.1] — 2026-04-27

### Fixed

- Card-mode file drag no longer activates the upload dropzone overlay.
  Thumbnail `<img>` elements were independently draggable, letting the
  browser fall back to its default image drag, which Chrome populates
  with `Files` in `dataTransfer.types`. Added `draggable="false"` on
  thumbnail imgs (`AlcovesImage`, fallback `<img>` in
  `LibraryEntriesGrid`) and gated the library upload dropzone on
  `draggedFileIds.length === 0` for defense-in-depth.

## [0.14.0] — 2026-04-27

### Added

- Bulk transcribe + audio-detect across an entire library — new
  `POST /api/libraries/:id/files/bulk-transcribe` and `bulk-audio-detect`
  endpoints, surfaced as Reprocess Transcripts / Reprocess Audio
  Detections cards in library settings, plus per-selection actions in the
  file-grid context menu.
- Editor video player now sizes to its grid cell with a ResizeObserver
  driven 16:9 fit — biggest letterbox box that fits without clipping.
- App version (`/VERSION`) embedded into the binary alongside commit and
  build time, surfaced via `version.App()`.

### Changed

- Editor page restructured to CSS grid: video on the left 60%, moments
  list on the right 40%, with timeline / highlight filters / transcript /
  audio events stacking 100% wide below. Mobile collapses to a single
  column with the video on top.
- `EditorSidebar` rewritten as a `MomentsList` UCard component; resize
  + collapse logic dropped in favour of fixed-fraction grid placement.
- Editor back button now restores the originating folder via a `from`
  query param, instead of dumping users at the library root.
- Library file-grid cards constrained to a 220–320px width band with
  16:9 thumbnails (auto-fill grid), so cards stop stretching on
  ultrawide viewports.
- File-list sticky-header divider toned down from `accented/70` to
  `default/30` in both light and dark modes.
- Default whisper model bumped to `medium`; helm worker requests bumped
  to `cpu: 2 / memory: 4Gi` with no CPU limit.

### Fixed

- Moments empty-state panel now uses Nuxt UI v4 UCard so corners and
  borders match other cards in the editor.
- Editor header no longer renders the `Library · Editor · {duration}s`
  subtitle row.

## [0.13.0] — 2026-04-27

### Added

- `/api/version` endpoint exposing the running commit, build time, and dirty
  flag (`bbacfebf`).

### Fixed

- Whisper repetition loop on transcription via VAD pre-processing
  (`bbacfebf`).
- Concurrent audio-detection job enqueues for the same file are now deduped
  (`213e2d01`).
- Production image now sets `LD_LIBRARY_PATH` and bumps whisper.cpp to v1.8.4
  (`6d479058`).
- `onnxruntime.so` symlinked in the runtime image so the dynamic loader can
  find it (`75c26d8d`).

## [0.12.0] — 2026-04-27

### Changed

- Frontend container runtime switched from Node 22 to Bun (`6c25ac0d`).
- CI actions upgraded to Node 24 majors and libheif AVIF/HEVC encoder plugins
  installed for image processing (`4b616b6c`, `0b01e529`).
- whisper.cpp pinned to a portable AVX2 baseline with explicit `WHISPER_*`
  cmake flags so production images run on older CPUs (`2c658885`,
  `ca5aa55f`).
- Frontend image now publishes alongside the backend image (`ab0c6468`).
- Go test packages serialized with `-p 1` to stop intermittent CI flakes
  (`041e8d92`).
- E2E sharded across 4 parallel jobs with Playwright workers tuned (3 commits
  in this range converged on workers=1 sharded across 4 jobs)
  (`3153d37a`, `fa93c2b3`, `a2e1579c`).

### Dependencies

- `golang.org/x/image` 0.36.0 → 0.38.0 (`02053a1e`).
- `github.com/jackc/pgx/v5` 5.8.0 → 5.9.2 (`df51365e`).

## [0.11.1] — 2026-04-26

### Added

- Audio detection + transcription features for library files (`5d2df813`).

## [0.11.0] — 2026-04-24

### Added

- Video editor page with cut / trim / highlight filter primitives
  (`a17aa21c`).
- Whisper-cpp transcription pipeline (initial integration)
  (`a17aa21c`).
- Audio detection background worker (`a17aa21c`).
- Helm chart (`helm/alcoves/`) for Kubernetes deploys (`a17aa21c`).

### Changed

- Frontend UI library swapped from raw Tailwind components to **Nuxt UI v4**
  module (`623bf002`).
- Context menu components refactored to a shared primitive (`5a73e83f`).
- Frontend test scaffolding added (Vitest + Playwright) (`623bf002`).

## [0.10.1] — 2026-02-23

### Added

- File hashing service integrated into the upload pipeline (`e40d7c4c`).

### Changed

- Logo and favicon assets refreshed (`edee8a05`, `abd10cc7`).
- Dependency bumps across frontend + backend (`0cb925ac`, `df2a56bb`).

## [0.10.0] — 2026-02-19

### Added

- Image proxy service with on-disk cache + asynchronous processing
  (`0d6ffc14`, `79f4b932`).
- Image proxy Redis pub/sub + NFS caching for cross-replica cache reuse
  (`91af3428`).
- TUS upload reliability improvements for large files (`554d4605`).
- `FilePreview` component holds refs to preloaded images to prevent
  GC-canceled requests (`98ac346d`).
- `resetAndFetch` composable gains a `silent` option for smoother UI updates
  (`b3fd84b6`).
- Factory script polls the GitHub project board for "Ready" issues and
  dispatches them to Claude Code (`e7a6ed4d`, `e0054d03`).
- Workflow documentation for issue handling and project management
  (`031624e3`).

### Changed

- README updated to reflect the Go + Vue 3 + Vite stack (`31bf1561`).
- Bun and Go packages upgraded across the board (`df2a56bb`).

## [0.9.1] — 2026-02-12

### Added

- TUS resumable uploader on the frontend (`211b0b2d`).
- Streaming video file responses from the backend (`7434c4e4`).
- `ffprobe` / `ffmpeg` shipped in the docker image (`7dc5cc80`).
- E2E test suite (`39322634`).

### Fixed

- Upload content type handling (`308c80e5`).
- Build issues on dev-nuxt branch (`5f8048e4`).
- Dockerfile node base image (`962d9b32`).

### Changed

- Multipart upload reworked to XHR streaming (`cbd97cfd`).
- `storeCacheStream` cleaned up (`2fbfe548`).
- Pre-commit hook updated (`595065a7`).

## [0.9.0] — 2026-02-11

### Added

- Multipart upload rewrite (`f269c6db`).
- Video proxy service for HLS-style on-the-fly transcoding (`db716348`).

### Fixed

- Database migrations now bundled into the docker dist stage (`983baa1d`).

### Changed

- `dev-nuxt` branch merged into `main` (`42942064`, `d3588763`).
- Migration housekeeping (`8dfa929d`).

## [0.8.0] — 2026-02-10

### Added

- Facial recognition pipeline using ONNX Runtime (`183d06c5`).
- Face splitting + reprocess flow for misidentified faces (`04e1bd54`).

### Changed

- Storage layer refactored — `LocalStorageDriver` slicing streamlined,
  storage interface tightened (`da4d0e70`, `947f1696`).
- Docker compose updated (`7d71ab27`).
- Nitro preset enabled for the frontend; upload handling streamlined
  (`50f4a0d8`).

## [0.7.0] — 2026-02-09

### Added

- Admin dashboard with stats (`ae8dabd2`).
- Draggable file rearrangement in the library view (`ae8dabd2`).
- pgvector extension wired up for face/object embeddings (`feb19c47`).

### Changed

- Test cases updated to reflect role changes (`f8f09a77`).

## [0.6.1] — 2026-02-09

### Added

- Library access management (members + invites) and folder/tag CRUD
  (`c8b07aa2`).
- Filename sanitization + RFC-5987 encoding for downloads (`714f78db`).

### Fixed

- E2E tests stabilized (`d62d1c68`).
- Trash-aware file purge (`714f78db`).

### Changed

- Migrated to Bun for frontend package management (`0121a467`).
- TypeScript config tightened (`a4683c8e`, `c8fff629`).
- Removed unused unique index on `library_invites.token` (`714f78db`).

## [0.6.0] — 2026-02-08

### Added

- Storage drivers: pluggable interface with **local** and **S3** backends
  (`4127e2b4`).

## [0.5.0] — 2026-02-07

### Added

- File tagging functionality for library files (`dbde37c4`, `956a2b85`).
- Folder management (create / move / rename) (`a8088c5d`).
- Library access middleware enforcing per-library RBAC (`2b41ae1f`).
- Unit + E2E tests for components and composables (`e4a21e79`).

### Changed

- Many style/format passes across components and tests (`refactor: ...`).
- Docker builds streamlined (`2249ac28`).
- Frontend coverage artifact path normalized in CI (`92d485b1`,
  `cd56a3f7`, `1e254535`).

## [0.4.0] — 2026-02-05 → 2026-02-06

### Added

- **Vue 3 + Vite + Nuxt UI** frontend lands on `main` (`043aeda8` and the
  surrounding squashed commits between `26001d84` and `f3ec9ab0`).
- Custom image proxy for resized previews (`f184cfc7`).
- Image proxy used as the default image source across the UI (`9f58ddb1`).
- Infinite-scroll file load (`a8d6098f`).
- Better auth system replacing the older one (`6cb4bbbd`).
- Automatic database migrations on startup (`61ecd4ea`).

### Changed

- Storage path configuration centralized in `nuxt.config.ts` (`fa6b624e`).
- PostgreSQL port reconfigured for local dev (`dcbb1035`).

### Fixed

- Logout flow + login page formatting (`baab920a`).
- Type checking errors (`e67663e6`).

## [0.3.0] — 2026-02-02

### Added

- Admin functionality with user-role management (`d0cfc06c`).

### Changed

- `ContentLoading` component simplified (no spinner) (`ee6fd39a`).

## [0.2.1] — 2026-02-01

### Changed

- `SidebarLibraries` refactored for readability (`60140945`).

## [0.2.0] — 2026-01-29 → 2026-01-31

### Added

- E2E test foundation against the Go backend (`cce14c3a`, `fd701bc1`).
- Datastar-based UI with selection support (`66727329`, `ad5c13da`).

### Changed

- LibraryView dropdown alignment swap (`76626e75`).

## [0.1.3] — 2025-10-24

### Changed

- Renamed primary entity from `asset` → `file` (`ce357a59`).
- Auto-create a starter library when a user is created (`ce357a59`).
- Path conventions normalized (`98dbff0f`).
- Package layout simplified (`3dc4aa66`).

## [0.1.2] — 2025-10-14

### Added

- Library router on the Go backend (`537f0ff6`).

### Changed

- Go modules updated (`4cbd6217`).

## [0.1.1] — 2025-10-10

### Changed

- File-list rendering work-in-progress (`f2c0aab7`).

## [0.1.0] — 2025-10-03

### Added

- Initial Go (Echo) backend with `templ` server-side rendering.
- Standalone Tailwind CSS CLI integration (`9b3deb89`).
- Working `templ generate` (`8e74bfb8`).
- `main` package simplified (`7c667770`).

This is the start of the **modern Alcoves era**. Everything before this point
is collapsed into `0.0.0`.

## [0.0.0] — pre-history

Squashed entry covering the **pre-rebrand history** (2018 — 2025-09):

- The original `bken-io` video-sharing site (React + Material UI, then antd,
  then a long evolution).
- A Remix + Drizzle + Lucia experiment.
- A SvelteKit + Drizzle/Prisma experiment.
- A Django/Jinja experiment.
- A Go + `templ` experiment that became the foundation for the current
  backend.

None of this code shipped under the Alcoves name. It is preserved in git
history but not in this changelog.

[Unreleased]: https://github.com/rustyguts/alcoves/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/rustyguts/alcoves/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/rustyguts/alcoves/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/rustyguts/alcoves/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/rustyguts/alcoves/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/rustyguts/alcoves/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/rustyguts/alcoves/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/rustyguts/alcoves/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/rustyguts/alcoves/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/rustyguts/alcoves/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/rustyguts/alcoves/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/rustyguts/alcoves/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/rustyguts/alcoves/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/rustyguts/alcoves/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/rustyguts/alcoves/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rustyguts/alcoves/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/rustyguts/alcoves/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rustyguts/alcoves/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/rustyguts/alcoves/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/rustyguts/alcoves/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rustyguts/alcoves/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rustyguts/alcoves/releases/tag/v0.1.0
