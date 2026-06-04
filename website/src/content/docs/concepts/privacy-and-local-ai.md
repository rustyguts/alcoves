---
title: Privacy & local AI
description: Why every Alcoves model is CPU-only, how inference stays on your instance, and how the product degrades gracefully.
---

Privacy in Alcoves is the **default, not a setting**. If a feature would send
user media or metadata off the instance, it does not ship. All AI inference runs
locally, on CPU, on hardware you own.

:::note[Sample doc]
A condensed overview drawn from the repo's
[ML & runtime inference](https://github.com/rustyguts/alcoves/blob/main/docs/ml-models-and-runtime-inference.md)
and [models](https://github.com/rustyguts/alcoves/blob/main/docs/models.md) docs.
:::

## CPU-only by design

Alcoves deliberately targets the no-GPU case. Models are chosen for that
constraint rather than chasing state-of-the-art at any cost. The practical
ceiling is roughly **8 GB of RAM** on x86_64.

| Capability             | Approach                                              |
| ---------------------- | ---------------------------------------------------- |
| Face detection + recognition | ONNX models; faces clustered into "people".    |
| Object detection       | COCO-label object detection (YOLO-class).            |
| Audio-event tagging    | AudioSet (527 classes).                              |
| Speech transcription   | whisper.cpp, with admin-selectable model sizes.      |

Models **download on demand** the first time a capability is used — nothing is
bundled, and **no inference ever leaves the box**.

## No telemetry, ever

The Go backend is a pure API with no analytics pipeline phoning home — and there
never will be one. There is no per-seat SaaS pricing and no third party in the
loop. Your media, and everything derived from it, stays on your instance.

## The owner is in control

Sensitive surfaces are **owner-gated**: the admin panel, the job-queue
dashboard, registration policy, and runtime ML-model selection are reachable
only by the instance owner. Sharing is opt-in per library and revocable.

## Degrade gracefully

Optional dependencies are exactly that — optional. The product stays usable when
one is missing:

- **No models?** Serve the originals.
- **No Redis/queue?** Inline-process transforms instead of enqueuing them.
- **Slow WebSocket client?** Drop the frame and let it re-fetch on reconnect.

:::tip
Because ML is async and optional, you can run a minimal Alcoves instance with no
ML at all, then enable detection later by selecting models in the admin panel —
existing media gets processed by the queue in the background.
:::
