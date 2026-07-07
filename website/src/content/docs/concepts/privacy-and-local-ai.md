---
title: Privacy & local AI
description: What runs on your own machine (everything that reads your media), and the few places bytes leave it.
---

The rule in Alcoves is simple: **anything that reads your files or media runs
on your own hardware**. Face detection, object labeling, audio tagging, and
speech transcription are all local, CPU-only inference. There is no cloud API
in the loop and no GPU requirement.

## CPU-only by design

Models are chosen to run well on ordinary server CPUs rather than to chase
benchmark numbers:

| Capability                   | Approach                                          |
| ---------------------------- | ------------------------------------------------- |
| Face detection + recognition | ONNX models; faces are clustered into "people".   |
| Object detection             | YOLO-class object detection (COCO labels).        |
| Audio-event tagging          | AudioSet classifier (527 sound classes).          |
| Speech transcription         | whisper.cpp, with admin-selectable model sizes.   |

Detection models are small (well under 2 GB of working memory). Transcription
is the heavy one: the default `large-v3` whisper model wants several GB of RAM,
and the admin panel lets you pick anything down to `tiny` to match your
hardware. Everything runs in a background job queue, so a slow machine means
slower indexing — not a slower app.

## What does leave your machine

Being honest about the edges matters more than a blanket claim:

- **Model downloads.** Models are not bundled in the image; they download on
  first use from a configurable URL (by default, a public bucket run by the
  project). You can mirror the models and point the URLs at your own host.
  After download, inference is entirely local.
- **Map tiles.** The map view loads tiles from OpenStreetMap by default.
  Self-host tiles and set `PUBLIC_MAP_TILE_URL` if you don't want that.
- **Error reporting (optional, off by default).** Operators can set a Sentry
  DSN to collect crash reports on a service they choose. If unset, nothing is
  reported anywhere.
- **Public share links.** A shared moment is reachable by anyone with the
  link — that's the point — and the share page includes preview images for
  link embeds. Sharing is per-item, deliberate, and revocable.

There is no analytics, no usage tracking, and your media is never uploaded
anywhere for processing.

## The owner is in control

Sensitive surfaces are gated to the instance **owner**: the admin panel, the
job-queue dashboard, the registration policy (open / invite-only / closed),
and ML model selection. Within a library, owner / admin / viewer roles decide
who can change what.

## Optional by nature

Media analysis is asynchronous and optional. Files are usable the moment they
upload; faces, labels, and transcripts fill in as jobs finish. Face and object
detection can be toggled per library, and if a model hasn't downloaded yet,
Alcoves simply serves your files and catches up on analysis later.
