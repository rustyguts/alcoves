# Alcoves — Product Vision

> The single document a builder reads to confirm: *does this change align with the project?*

## Mission

**Give individuals, families, and small teams full ownership of their media — without surrendering it to a cloud they don't control.**

Alcoves is a self-hosted, privacy-first collaborative media library: a Google Drive plus Google Photos replacement you run yourself. It stores your photos, videos, audio, and documents; it understands them (faces, objects, sounds, speech); it lets a small group browse, organize, and share them; and it does all of this on hardware you own, with no telemetry, no per-seat SaaS pricing, and no third party in the loop.

The problem we exist to solve: the convenient tools for managing personal and family media are the ones that mine it. The tools that respect your privacy are usually too primitive to be worth using. Alcoves refuses that trade-off — it aims to be *as capable as the cloud incumbents on the features that matter, while being something you fully own.*

## Who it's for

- **Individuals** who want a private home for a lifetime of photos and video, with real search and real organization.
- **Families** who want to share a library — grandparents, kids, events — with sensible roles so not everyone is an admin.
- **Small teams and creators** (1–100 users per instance) who collaborate on video: clipping moments, transcribing, tagging, and sharing public links to highlights.
- **Self-hosters and homelab operators** who will run the Postgres, the queue, the GPU-less inference, and want a clean Helm chart and Docker images to do it.

Alcoves is explicitly *not* built for the 100,000-user multi-tenant SaaS case. The design optimizes for a trusted instance shared by a known, bounded group.

## Core product pillars

1. **Own your media.** Local-disk or S3-compatible storage, your database, your queue. The Go binary is a pure API; nothing phones home. Storage is pluggable so a Raspberry Pi with a USB drive and a rack with an object store are both first-class.

2. **Understand the media, on your hardware.** Every file is processed by an async pipeline: SHA-256 hashing and dedup, image/video thumbnails, video proxy transcoding, audio waveforms, and a full suite of CPU-only ONNX ML — face detection + recognition (clustered into people), object detection (COCO labels), audio-event tagging (AudioSet 527 classes), and whisper.cpp speech transcription. Models download on demand; no GPU required; no inference leaves the box.

3. **Collaborate with real permissions.** Libraries are the unit of sharing. Owner / admin / viewer roles, invite links with usage caps and expiry, and a per-library access gate enforced in middleware before any handler runs. A personal "default" library stays personal; collaborative libraries can be opened up deliberately.

4. **Make video first-class.** A real timeline editor: zoomable waveform, draggable "moments" (named clips), transcript search, audio-detection overlays, and user-defined highlight filters that fire on words and sounds. Moments export to MP4 and can become public, OG-embeddable share links.

5. **Stay current and alive.** A real-time activity feed and notification bell over WebSockets, cross-library search, and an admin surface for stats, registration policy, runtime ML-model selection, and the async job queue.

6. **Be operable.** Health and version endpoints, Goose migrations that run on startup, split API/worker deployments, automated release-please versioning, and a documented env-var surface. Running Alcoves should be boring.

## What Alcoves IS

- A **self-hosted** media library you fully control.
- A **collaborative** system with genuine multi-user roles and sharing.
- A **privacy-first** product: CPU-only local inference, no telemetry, explicit cookie/credential handling.
- A **media-intelligent** library: faces, objects, sounds, and speech are searchable and navigable, not just stored.
- A **video-centric** tool with a genuine editing and clipping workflow.
- An **operator-friendly** deployment: Docker + Helm, external Postgres/Dragonfly, local or S3 storage.

## What Alcoves is NOT

- **Not a public, internet-scale SaaS.** It targets bounded, trusted instances (1–100 users), not anonymous mass signup.
- **Not a GPU inference farm.** All ML is CPU-only by design; we pick models for that constraint, not chase SOTA at any cost.
- **Not a general file-sync client.** Uploads are resumable (TUS) and web-first; this is a library, not Dropbox-style continuous sync.
- **Not telemetry-funded or ad-supported.** There is no analytics pipeline phoning home and there never will be.
- **Not a monolith that serves its own UI.** The Go backend is a pure API; the Nuxt frontend is a separate Nitro server. They meet at a reverse proxy.
- **Not 1.0-stable yet.** Alcoves is alpha. We cap at `0.x.y` until an explicit decision; expect breaking changes and own them with migrations and changelog entries.

## Guiding principles for every feature decision

- **Privacy is the default, not a setting.** If a feature would send user media or metadata off the instance, it does not ship. Inference stays local. Cookies and credentials are forwarded explicitly and scoped narrowly.
- **The owner is in control.** Sensitive surfaces (admin, job queue, registration policy, model selection) are owner-gated. Sharing is opt-in per library and revocable.
- **Async by default for heavy work.** Anything CPU-bound (transcode, ML, hashing, export) goes through the Asynq queue with status/progress/version columns, never blocking a request. The version-bump pattern lets work be safely re-triggered and stale results self-discard.
- **Soft-delete and recoverability.** Files, folders, and moments trash before they purge; purges delete blobs before DB rows so nothing is orphaned silently.
- **Correctness over cleverness in data.** Parameterized queries, transactional user/library creation, idempotent job handlers, and dedup that ignores derived/trashed files. Use `bigint` for sizes; guard SSR-unsafe DOM access.
- **Degrade gracefully.** No models? Serve originals. No Redis? Inline-process transforms. Slow WebSocket client? Drop the frame and let it re-fetch on reconnect. The product stays usable when an optional dependency is missing.
- **Operability is a feature.** New subsystems expose status, emit activity events where users care, and respect the `api` / `worker` / `all` mode split.
- **One source of truth per contract.** API paths live in the typed `api` client; activity actions mirror 1:1 between Go and TS; the tag palette and model registries are shared constants. Change both sides in lockstep.

## How to use this as a compass

Before building or reviewing a change, ask:

1. **Does it keep media and inference on the instance?** If not, stop.
2. **Does it respect library roles and the owner gate?** A new route under `/api/libraries/:id/**` must go through access middleware; a new admin capability must be owner-gated.
3. **Is heavy work async, status-tracked, and idempotent?** Don't block requests on transcode or inference.
4. **Does it degrade gracefully and clean up after itself?** Soft-delete, blob-before-row purge, fallbacks when optional deps are absent.
5. **Does it serve the bounded, trusted, self-hosted user — not a hypothetical SaaS?** Optimize for the family and the small team, not the anonymous crowd.
6. **Are both sides of every shared contract updated, with a migration and a changelog-worthy commit?**

If a feature aligns with the pillars, honors the principles, and answers these six questions cleanly, it belongs in Alcoves. If it requires weakening privacy, bypassing the owner/role model, or coupling us to a cloud we don't control, it does not — no matter how convenient.

Build for the person who wants their media to be *theirs*. That person is the entire point.
