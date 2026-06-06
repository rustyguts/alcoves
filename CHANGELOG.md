# Changelog

All notable changes to Alcoves are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html), capped
at `0.x.y` until an explicit `1.0.0` decision (alpha software).

The history below covers the modern Alcoves era — the current Go (Echo) +
Vue/Nuxt stack — beginning October 2025. Earlier history (a video site under
the `bken-io` name plus several abandoned framework experiments — Remix,
SvelteKit, Django, Go templ) is collapsed into the `0.0.0` entry.

## [0.25.2](https://github.com/rustyguts/alcoves/compare/v0.25.1...v0.25.2) (2026-06-06)


### Reverted

* **frontend:** remove One Dark Pro theme, restore default light/dark ([#603](https://github.com/rustyguts/alcoves/issues/603)) ([89e48c2](https://github.com/rustyguts/alcoves/commit/89e48c273393d558ce9592ca2ab37b8ccc5b7df5))

## [0.25.1](https://github.com/rustyguts/alcoves/compare/v0.25.0...v0.25.1) (2026-06-06)


### Fixed

* **ci:** build cached whisper.cpp with portable x86-64-v3 baseline ([#599](https://github.com/rustyguts/alcoves/issues/599)) ([9a23f93](https://github.com/rustyguts/alcoves/commit/9a23f93b5c8778f283b6a475077f841b073231b3))


### CI

* **backend:** cache the libvips/ffmpeg apt download ([#602](https://github.com/rustyguts/alcoves/issues/602)) ([71f339e](https://github.com/rustyguts/alcoves/commit/71f339e4f44b9112e92af19c4515469b66e36393))
* **backend:** shard tests 3 ways + cache whisper.cpp build ([#597](https://github.com/rustyguts/alcoves/issues/597)) ([28d61d4](https://github.com/rustyguts/alcoves/commit/28d61d4d88228501ce67ea831f6cf53be8f6c0e8))
* **backend:** split the heavy handlers package's tests across shards ([#600](https://github.com/rustyguts/alcoves/issues/600)) ([5235424](https://github.com/rustyguts/alcoves/commit/52354248ed4bfdd006da547bc2423ef0b2abb29e))
* **backend:** widen backend-test to 5 shards ([#601](https://github.com/rustyguts/alcoves/issues/601)) ([c9535b6](https://github.com/rustyguts/alcoves/commit/c9535b67cdc488fec458cf3e034bec7dd98753b9))
* **e2e:** split into 8 shards, drop unused services, cache browser ([#595](https://github.com/rustyguts/alcoves/issues/595)) ([443e2c4](https://github.com/rustyguts/alcoves/commit/443e2c4dabab0536fe00d4cc84d76dc37fff2dea))

## [0.25.0](https://github.com/rustyguts/alcoves/compare/v0.24.0...v0.25.0) (2026-06-06)


### Added

* **frontend:** One Dark Pro inspired theme ([#592](https://github.com/rustyguts/alcoves/issues/592)) ([b7a5217](https://github.com/rustyguts/alcoves/commit/b7a5217b3e81a9b192535cbf34316c32a850da69))
* **mcp:** full Alcoves feature parity v1 (22-tool MCP server) ([#593](https://github.com/rustyguts/alcoves/issues/593)) ([af61e48](https://github.com/rustyguts/alcoves/commit/af61e48b6fe9147f8ed20d8b679a1fcde8d30c11))
* **timeline:** day-grouped gallery, duration-only videos, date scrubber ([#591](https://github.com/rustyguts/alcoves/issues/591)) ([27f1aa6](https://github.com/rustyguts/alcoves/commit/27f1aa6ce245ce2162fb7640b8d2bf111c0fdce7))


### Fixed

* **frontend:** re-pick best-fit icons and add a central icon registry ([#588](https://github.com/rustyguts/alcoves/issues/588)) ([6eccd6f](https://github.com/rustyguts/alcoves/commit/6eccd6f04d875e6a7f7b00ec19cc79c118c30747))


### Changed

* **ui:** flatten library settings page into card-free sections ([#589](https://github.com/rustyguts/alcoves/issues/589)) ([56d03c9](https://github.com/rustyguts/alcoves/commit/56d03c971fbb265fc8a8a67f073c1d8ea78fe384))
* **ui:** redesign profile page into a flat, less card-centric layout ([#587](https://github.com/rustyguts/alcoves/issues/587)) ([cc47834](https://github.com/rustyguts/alcoves/commit/cc47834443690d38badf4ae0ebae8eb209e8b807))
* **ui:** redesign the library tags page as a flat tonal list ([#590](https://github.com/rustyguts/alcoves/issues/590)) ([9614474](https://github.com/rustyguts/alcoves/commit/961447461671b7c3ea300595328500fb02e194a2))

## [0.24.0](https://github.com/rustyguts/alcoves/compare/v0.23.0...v0.24.0) (2026-06-05)


### Added

* **frontend:** enlarge and space out sidebar nav items ([#579](https://github.com/rustyguts/alcoves/issues/579)) ([abfc68a](https://github.com/rustyguts/alcoves/commit/abfc68ad4907b0e612594b9f3b0a96b8fb1cf5fb))
* **frontend:** replace Lucide icons with Lineicons app-wide ([#583](https://github.com/rustyguts/alcoves/issues/583)) ([5ec2c12](https://github.com/rustyguts/alcoves/commit/5ec2c12ab6ce3398d0dd0ca875e77df0d3d6f681))
* **search:** fuzzy-match object tags and simplify search page ([#578](https://github.com/rustyguts/alcoves/issues/578)) ([01f74e9](https://github.com/rustyguts/alcoves/commit/01f74e9f1013cc9bd9341cb6bc0731a319a1cdc8))
* **timeline:** full-bleed Google-Photos gallery with year scrubber ([#581](https://github.com/rustyguts/alcoves/issues/581)) ([45f9a5a](https://github.com/rustyguts/alcoves/commit/45f9a5a86ddba8e7b66983a03a4760607f1333bb))


### Fixed

* **frontend:** close library switcher after selecting a library ([#577](https://github.com/rustyguts/alcoves/issues/577)) ([9a65fec](https://github.com/rustyguts/alcoves/commit/9a65fec9f0b17b5007766a81bbc555a3f61ce010))


### Changed

* **frontend:** move Objects link from sidebar to library Settings ([#580](https://github.com/rustyguts/alcoves/issues/580)) ([2cc77d1](https://github.com/rustyguts/alcoves/commit/2cc77d11864dad258b4062619c8a480acb94a6c4))
* **ui:** replace card-centric design with flat tonal panels ([#582](https://github.com/rustyguts/alcoves/issues/582)) ([5857894](https://github.com/rustyguts/alcoves/commit/5857894fadb5917cfce0065a9ae857539d6966d4))


### Documentation

* **vision:** rewrite vision.md as a non-technical, vettable product vision ([#584](https://github.com/rustyguts/alcoves/issues/584)) ([7170aee](https://github.com/rustyguts/alcoves/commit/7170aee889a31982dfe07a3a36cef3d8edbd40b8))

## [0.23.0](https://github.com/rustyguts/alcoves/compare/v0.22.0...v0.23.0) (2026-06-05)


### Added

* **frontend:** justified Google-Photos gallery for timeline and global search ([#573](https://github.com/rustyguts/alcoves/issues/573)) ([d2e81d5](https://github.com/rustyguts/alcoves/commit/d2e81d5528cfc9f78655e6bd8a552359044fc1c4))
* **frontend:** move library tabs into the sidebar ([#572](https://github.com/rustyguts/alcoves/issues/572)) ([50d9464](https://github.com/rustyguts/alcoves/commit/50d94640f399dabacc150246907150453a81d486))
* **frontend:** video duration badges and full-width grid view ([#571](https://github.com/rustyguts/alcoves/issues/571)) ([9002afe](https://github.com/rustyguts/alcoves/commit/9002afee6922c81d670e7bfda3847698f325f2b7))
* **queue:** dedicated per-job-type queues ranked by importance and complexity ([#566](https://github.com/rustyguts/alcoves/issues/566)) ([64c065b](https://github.com/rustyguts/alcoves/commit/64c065be67edfe2e00dff7259f7a921d315e73ce))
* **queue:** reap async jobs stuck in a non-terminal state ([#574](https://github.com/rustyguts/alcoves/issues/574)) ([8a3d774](https://github.com/rustyguts/alcoves/commit/8a3d7748331449e2f84ee5a2aba5e16d2e353a6b))


### Fixed

* **facedetection:** verify model SHA-256 to replace stale cached models ([#570](https://github.com/rustyguts/alcoves/issues/570)) ([a70a715](https://github.com/rustyguts/alcoves/commit/a70a715c48491b658b52aad92dd733d5d8a99e56))
* **jobreaper:** set User/Library ID via embedded BaseModel in tests ([#576](https://github.com/rustyguts/alcoves/issues/576)) ([4a7d196](https://github.com/rustyguts/alcoves/commit/4a7d196a605767f21a3beb496d20f333ffc41171))
* **security:** zip-slip, share-link host spoofing, hardcoded dev PAT ([#569](https://github.com/rustyguts/alcoves/issues/569)) ([0d18474](https://github.com/rustyguts/alcoves/commit/0d18474050777ce74fd82b73a9dccb1ecbdb7cb9))


### Changed

* **backend:** detangle media-job duplication across layers (10-step audit) ([#575](https://github.com/rustyguts/alcoves/issues/575)) ([1e019e1](https://github.com/rustyguts/alcoves/commit/1e019e1ccef674568d07696570d52da3f9c98331))


### Documentation

* **claude:** full CLAUDE.md rewrite from multi-agent codebase scan ([#568](https://github.com/rustyguts/alcoves/issues/568)) ([27eed72](https://github.com/rustyguts/alcoves/commit/27eed72cce73ed6a3ac9754c1b5b3215ce52a064))

## [0.22.0](https://github.com/rustyguts/alcoves/compare/v0.21.0...v0.22.0) (2026-06-04)


### Added

* **backend:** seed dev/test database with representative data ([#565](https://github.com/rustyguts/alcoves/issues/565)) ([8ab0af8](https://github.com/rustyguts/alcoves/commit/8ab0af819e981078cbe50d913804db9e06fc0f9a))


### Build

* **docker:** unify backend and frontend into a single production image ([#564](https://github.com/rustyguts/alcoves/issues/564)) ([5020bbb](https://github.com/rustyguts/alcoves/commit/5020bbbc70eaa79193ed2e994788dd2dc3926b27))


### CI

* **release:** publish version-tagged Docker images on release merges ([#562](https://github.com/rustyguts/alcoves/issues/562)) ([4d9412b](https://github.com/rustyguts/alcoves/commit/4d9412b7d1add5fd915cd37596462d76d09a2a44))

## [0.21.0](https://github.com/rustyguts/alcoves/compare/v0.20.0...v0.21.0) (2026-06-04)


### Added

* **frontend:** add Timeline and Map view-switcher icons to file browser ([#557](https://github.com/rustyguts/alcoves/issues/557)) ([b7465da](https://github.com/rustyguts/alcoves/commit/b7465da8cb93defaf8b013b5d25d458c8bfef4d4))
* **image-proxy:** hourly variant pre-warm, shared variant registry, named queues ([#561](https://github.com/rustyguts/alcoves/issues/561)) ([687760e](https://github.com/rustyguts/alcoves/commit/687760e3786c3fe1533ee005fe5d0b7bcc38c318))


### Fixed

* **backend:** gate audio taggers to published models so unavailable ones don't 404 ([#559](https://github.com/rustyguts/alcoves/issues/559)) ([e71b38b](https://github.com/rustyguts/alcoves/commit/e71b38ba10f59c22b27cad5b4efe1550143e9298))
* **frontend:** order library trash tab after settings ([#555](https://github.com/rustyguts/alcoves/issues/555)) ([8cfe0a0](https://github.com/rustyguts/alcoves/commit/8cfe0a0e5d14878c7dd12615098ab16671dc6493))
* **website:** enable client-side routing to remove docs page flash ([#558](https://github.com/rustyguts/alcoves/issues/558)) ([d135253](https://github.com/rustyguts/alcoves/commit/d1352535989f2e3f12d03e3f8651f842c6539bbe))


### Build

* **backend:** upgrade onnxruntime_go v1.31.0 + ONNX Runtime 1.26.0 ([#560](https://github.com/rustyguts/alcoves/issues/560)) ([c83f896](https://github.com/rustyguts/alcoves/commit/c83f896eec49be0703bb22f5057b5f7133526461))

## [0.20.0](https://github.com/rustyguts/alcoves/compare/v0.19.0...v0.20.0) (2026-06-04)


### Added

* **mcp:** add Model Context Protocol server ([#546](https://github.com/rustyguts/alcoves/issues/546)) ([eb71a57](https://github.com/rustyguts/alcoves/commit/eb71a572ff096b9d9c54157e8376938425001aa0))
* **observability:** add Sentry SDK to backend and frontend ([#548](https://github.com/rustyguts/alcoves/issues/548)) ([700faee](https://github.com/rustyguts/alcoves/commit/700faee0c49129a0d6652fe0cb8dd0eb6803a472))
* **timeline-map:** EXIF metadata pipeline with Timeline and Map views ([#552](https://github.com/rustyguts/alcoves/issues/552)) ([2d596a2](https://github.com/rustyguts/alcoves/commit/2d596a253a35a3c8bd2128e426814fc80ed07878))
* **website:** add Astro + Starlight marketing & docs site ([#553](https://github.com/rustyguts/alcoves/issues/553)) ([871807d](https://github.com/rustyguts/alcoves/commit/871807d9e03042ba6e62cb5167448f650b1222e0))


### Fixed

* resolve 15 handler bugs from bug sweep ([#547](https://github.com/rustyguts/alcoves/issues/547)) ([1d0bb11](https://github.com/rustyguts/alcoves/commit/1d0bb1135161a688a5110548266a9e0bb48a62de))


### Changed

* **frontend:** unify panels, fix profile spacing/clipping ([#545](https://github.com/rustyguts/alcoves/issues/545)) ([1cd8e46](https://github.com/rustyguts/alcoves/commit/1cd8e461306186cf1f45171d54fe9a16c2a08731))


### Documentation

* add test coverage targets to CLAUDE.md ([#550](https://github.com/rustyguts/alcoves/issues/550)) ([e99df4a](https://github.com/rustyguts/alcoves/commit/e99df4af2fdd30f339c158161069d2fb526c210e))


### Tests

* **backend:** raise coverage to 80%+ and isolate test DBs per-package ([#551](https://github.com/rustyguts/alcoves/issues/551)) ([870076a](https://github.com/rustyguts/alcoves/commit/870076a875eb762551195f81d001f840a2c4c541))
* **backend:** real-data ML inference e2e tests (+ fix ONNX Runtime 1.25.0) ([#554](https://github.com/rustyguts/alcoves/issues/554)) ([9533147](https://github.com/rustyguts/alcoves/commit/95331470c72a972faf192f8fe5645a0b52e59722))
* **frontend:** raise unit coverage above 90% ([#549](https://github.com/rustyguts/alcoves/issues/549)) ([f19f85e](https://github.com/rustyguts/alcoves/commit/f19f85e26040187916eb39a2adc2f81a6c83cb4d))


### CI

* bump release-please-action to v5 (Node.js 24) ([17d69cd](https://github.com/rustyguts/alcoves/commit/17d69cddc04d33c79d595e6d81a1e9048c8cd0fc))

## [0.19.0](https://github.com/rustyguts/alcoves/compare/v0.18.2...v0.19.0) (2026-06-02)


### Added

* **grid:** compact folder cards with muted background ([6d7e6ef](https://github.com/rustyguts/alcoves/commit/6d7e6ef87ace58e4b76ff34290cf14e431d9df67))
* **grid:** separate folders and files into sections in grid view (v0.16.1) ([81bbec6](https://github.com/rustyguts/alcoves/commit/81bbec6e8d4866ce554599fc9d70c248292f6a4a))


### Fixed

* **auth:** wrap user/account/library creation in a DB transaction ([0144609](https://github.com/rustyguts/alcoves/commit/01446096ebe894cce68588684b30b0bb4971209c))
* **backend:** address PR [#540](https://github.com/rustyguts/alcoves/issues/540) review feedback ([230596b](https://github.com/rustyguts/alcoves/commit/230596b0dc98d40bfd36aad42665a5ffa949764a))
* **docker:** isolate frontend .nuxt/.output from host bind mount ([54d7ba4](https://github.com/rustyguts/alcoves/commit/54d7ba4f91a1360ce4a6945754cbfd557a05ff7d))
* **grid:** use bg-elevated for folder cards ([609fda1](https://github.com/rustyguts/alcoves/commit/609fda1fc786b7d73bd9a0cd27231d144f216ced))
* **proxy:** require auth + library membership, clamp transform dimensions ([e0bb9d0](https://github.com/rustyguts/alcoves/commit/e0bb9d004f47d3b72a745cc196774e92096161fc))
* **security:** CORS origin allowlist + owner-gate admin job-queue routes ([5278d43](https://github.com/rustyguts/alcoves/commit/5278d43bf26765120e6a8cfd0ee42b372202778b))


### Performance

* **audio:** stream PCM per window + cache ONNX session ([6cb565e](https://github.com/rustyguts/alcoves/commit/6cb565eefb7ae9e1dd424d04fd6e6414c9d6374d))
* **facedetection:** add HNSW index + ef_search tuning for ANN clustering ([018fd3f](https://github.com/rustyguts/alcoves/commit/018fd3ffbfef3f32b52d50a8b7932e0ae118ad47))
* **listing:** parameterize queries, validate UUIDs, stream proxy, CTE breadcrumbs ([b99e4d8](https://github.com/rustyguts/alcoves/commit/b99e4d8a334cfbc5fb0bcc1120a5ea71b90e0939))


### Changed

* **grid:** drop Folders/Files section headings ([54ca719](https://github.com/rustyguts/alcoves/commit/54ca719a95ecd45682a9e5307e95ab542196a0fa))


### Documentation

* add backend top-10 improvement plan ([3253228](https://github.com/rustyguts/alcoves/commit/3253228b6d9a50dfd28aafdba99cb153dd7ad6a3))


### Tests

* **e2e:** expand [@screenshot](https://github.com/screenshot) coverage to all UI surfaces, light + dark ([c45b099](https://github.com/rustyguts/alcoves/commit/c45b09983cd538999430c5d54fa3e591b0fc9256))
* **e2e:** rebase onto main 0.18.3 + regenerate screenshot baselines ([7d8cb75](https://github.com/rustyguts/alcoves/commit/7d8cb75caf917fef889b27e7b3dec3a7ca2a603c))

## [0.18.3](https://github.com/rustyguts/alcoves/compare/v0.18.2...v0.18.3) (2026-06-02)


### Changed

* **grid:** card (grid) view now groups folders into a "Folders" section pinned to the top and loose files into a "Files" section below, instead of mixing both in one flat grid. List/table view is unchanged. Card markup was extracted into a reusable `LibraryEntryCard` component.


### Tests

* **e2e:** expand `@screenshot` coverage to all UI surfaces with light + dark variants; add a `share` flow for the SSR public moment page (mock backend) and a person-detail flow.

## [0.18.2](https://github.com/rustyguts/alcoves/compare/v0.18.1...v0.18.2) (2026-05-14)


### Fixed

* **waveform:** revert to industry-standard linear peak ([bf0dd4f](https://github.com/rustyguts/alcoves/commit/bf0dd4feb95baeee04272651e65514ec9b8837f3))

## [0.18.1](https://github.com/rustyguts/alcoves/compare/v0.18.0...v0.18.1) (2026-05-14)


### CI

* **release:** automate releases via release-please ([11dd6ae](https://github.com/rustyguts/alcoves/commit/11dd6ae358f4cb27095f5ecc8d4b8b44ac6d34da))
* **release:** point release-please at /VERSION + anchor to v0.18.0 squash sha ([0700fe6](https://github.com/rustyguts/alcoves/commit/0700fe69aa03caac54b51a1f9ed998f8d099ede8))

## [Unreleased]

### Changed

- **Waveform display reverted to industry-standard linear peak (max
  absolute sample per window).** The v0.18.0 pipeline — per-window RMS,
  p99 normalization, and a `[-50dB, 0dB] → [0,1]` curve — pinned most
  windows near the top of the canvas (the dB mapping inflates a -20 dB
  signal to ~60% height), so quiet passages no longer read as quiet. The
  revert matches what Audacity, Adobe Audition/Premiere, DaVinci Resolve,
  Pro Tools, REAPER, FFmpeg's `showwavespic`, wavesurfer.js / peaks.js,
  and BBC `audiowaveform` all render by default. Existing waveforms in
  the cache stay on the old algorithm until each file is re-generated
  (POST `/api/libraries/:id/files/:fileId/waveform`); the frontend
  already exposes this via the editor.

## [0.18.0] — 2026-05-12

### Added

- **Admin-selectable inference models.** A new "Inference Models" card on
  `/admin` lets owners swap the transcription model (whisper.cpp) and the
  audio-tagging model at runtime without a redeploy. Each selector renders
  per-option disk + RAM peak + quality metadata so the admin can pick
  against the pod's actual budget. Persists in `app_settings` JSONB; takes
  effect on the next worker task. Env vars
  (`ALCOVES_WHISPER_MODEL`, `ALCOVES_WHISPER_LANGUAGE`,
  `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL`) become boot-time fallbacks.
- **Whisper allow-list** mirroring every variant from the model bucket:
  `tiny`, `base`, `small`, `medium`, `large-v3` (default), `large-v3-q5_0`,
  `large-v3-turbo-q5_0`, `large-v3-turbo-q4_0`, `distil-large-v3.5-q5`
  (English-only). `scripts/upload-whisper-models.sh` mirrors them all to
  `s3.rustyguts.net/models` via rclone.
- **Audio tagger registry.** EfficientAT (mn04 / mn10 / mn40_as_ext) and
  CED (tiny / small / base) join PANNs CNN14 in
  `backend/internal/services/audiodetection/registry.go`. Each entry
  carries its own ONNX filename, sample rate (16 kHz for CED, 32 kHz for
  the rest), and admin-UI metadata. `scripts/export-audio-tagger.py`
  generates the ONNX bundles with mel-spectrogram preprocessing baked into
  the graph so the Go worker keeps feeding raw PCM regardless of family.
- **Tus uploads now enqueue transcription + audio-event detection on
  completion** alongside the existing face/object/waveform jobs. The
  transcribe and audio-detect services join `TusHandler`'s constructor,
  and the post-upload pipeline fans out to all five workers in one place.

### Changed

- **Waveform display switched from per-window max-peak (linear) to RMS +
  per-file normalization + dB curve.** The previous algorithm pinned every
  20ms window with a transient to full-scale, so most clips looked like a
  wall of peaking bars. The new pipeline computes per-window RMS, divides
  by the file's 99th-percentile RMS as a robust reference (occasional clips
  no longer compress the rest of the waveform), then maps `[-50dB, 0dB]`
  onto `[0,1]` for visual output. Silent files (reference < ~-80dB) emit
  zeros instead of amplifying the noise floor. No schema or frontend
  changes — the renderer keeps consuming the same `[0,1]` peaks JSON.
- **Default audio tagger switched from PANNs CNN14 → EfficientAT mn10_as.**
  ~16× smaller on disk (313 MB → 20 MB), faster CPU inference, +9% mAP
  (0.431 → 0.471). PANN CNN14 stays in the registry as a rollback option
  selectable from the admin page. The label space (AudioSet 527) is
  unchanged, so existing `HighlightFilter` expressions continue to work.
- `backend/internal/services/audiodetection/worker.go` is now spec-aware:
  per-model sample rate flows to ffmpeg's `-ar`, the ONNX probe widens to
  cover EfficientAT + CED conventions (`input_values`, `logits`, etc.), and
  `audio_detect_model` on `files` records the registry ID of the run.
- `ALCOVES_AUDIO_DETECT_MODEL_URL` replaced by
  `ALCOVES_AUDIO_DETECT_MODEL_BASE_URL` — the worker composes the URL from
  the base + registry filename rather than taking a single hardcoded URL.

### Backend

- `settings.Settings` extends with `whisper_model`, `whisper_language`,
  `audio_detect_model`. Defaults seeded on fresh install
  (`large-v3` / `auto` / `efficientat_mn10`); existing deployments
  transparently pick up the defaults via the JSONB unmarshal pattern.
- `PATCH /api/admin/settings` accepts the new keys with allow-list
  validation. Unknown IDs return 400.
- `transcribe.NewService` + `audiodetection.NewService` now accept a
  `settings.Service`; the worker reads admin settings at task start with
  env-var fallback. Whisper-cli stays per-task spawn (no in-memory model
  state to invalidate), so admin swaps apply on the very next job.

### Docs

- `docs/models.md` refreshed: audio tagger table replaced with the
  registry's seven entries, default highlight moved to EfficientAT mn10,
  "How to swap" rewritten around the admin UI with env-var fallback.
- `docs/publishing-models.md` inventory updated with the new Whisper +
  audio tagger artifacts and bulk-push helper script references.
- `.env.example` documents the inference env vars with admin-overrides
  notes.

## [0.17.0] — 2026-05-12

### Added

- Notification + activity feed feature. A canonical `library_activities`
  table records every notable event in a library (file/folder/tag/moment
  CRUD, member join/remove, system events for waveform/transcribe/video
  proxy completion). The frontend surfaces this in two places:
  - A bell icon in the dashboard header opens a global notification
    dropdown showing cross-library activity. A new `/notifications`
    page renders the full list grouped by library. Notifications are
    individually dismissable; "Dismiss all" advances a per-user
    `users.notifications_cleared_before` watermark.
  - A new **Feed** tab on each library page shows the per-library
    activity log (no read state; includes system events and the
    viewer's own actions).
- Real-time delivery via a WebSocket hub (`coder/websocket`) backed by
  Redis Pub/Sub. Connect via `GET /api/ws`; auto-joins a user room
  (`user:<userID>`) and accepts `subscribe`/`unsubscribe` frames for
  library rooms (`library:<libraryID>`). Workers and API replicas
  publish onto `activity:library:<libraryID>` so the same event
  reaches every replica's local clients.
- New endpoints: `GET /api/notifications`, `GET /api/notifications/unread-count`,
  `POST /api/notifications/:id/dismiss`, `POST /api/notifications/dismiss-all`,
  `GET /api/libraries/:id/feed`, `GET /api/ws`.
- Migration `00018_add_activity_feed.sql` creates `library_activities` +
  `user_notification_dismissals` and adds `notifications_cleared_before`
  to `users`. Activity rows snapshot the subject's name into JSONB
  metadata so deleted/renamed items still render in past entries.

### Changed

- `invites.Redeem` now returns `(RedeemResult, error)` (the extra
  `AddedMember` flag lets the caller emit a `member.joined` activity).
  Callers in `auth.go` and `invite.go` updated.

## [0.16.0] — 2026-04-30

### Added

- Global registration mode (`open` / `closed` / `invite_only`), toggleable
  from the admin dashboard. Persisted in a new single-row `app_settings`
  table (migration `00016_app_settings.sql`) with an in-process cached
  service. New endpoints: `GET/PATCH /api/admin/settings` (owner-gated)
  and the public `GET /api/_meta/registration-mode` consumed by the
  register page.
- Per-redemption invite tracking via `library_invite_uses` (migration
  `00017_invite_link_overhaul.sql`) plus a `max_uses` column on
  `library_invites`. Library settings page now shows use count vs. max
  and an expandable list of users who joined via each link.
- Anonymous invite redemption: visiting `/invites/:token` while logged
  out redirects to `/register?invite=…`; on successful registration the
  backend auto-redeems the invite and lands the user in the target
  library. Works in `invite_only` mode too.

### Changed

- Invite links are now always basic-member only (no role selector).
  Promotion to admin happens after join via the existing per-member role
  control.
- Invite links carry `max_uses` (NULL = unlimited) and `expires_at`
  (NULL = never) — both configurable in the create form.

### Removed

- Email-targeted library invites (`POST /users/invite-email`) and the
  per-invite role selector. Dropped columns from `library_invites`:
  `invited_email`, `role`, `accepted_by_user_id`, `accepted_at`
  (replaced by `library_invite_uses`).

## [0.15.0] — 2026-04-27

### Added

- Audio waveform generation for video uploads. A new background worker
  extracts mono 16 kHz float32 PCM via ffmpeg, computes max-amplitude
  peaks at 50 windows/sec, and stores the result as JSON in cache. The
  video editor renders the waveform as a viewport-pinned canvas that
  shares the timeline's zoom + scroll, click-to-seek, and a
  Generate/Retry/Regenerate button next to the existing transcribe and
  audio-detect controls. Schema adds `waveform_status`,
  `waveform_progress`, `waveform_error`, `waveform_version`,
  `waveformed_version`, `waveform_peaks_per_second` to `files`
  (migration `00015_add_waveform_fields.sql`).

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
