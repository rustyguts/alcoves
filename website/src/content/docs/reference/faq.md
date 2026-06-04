---
title: FAQ
description: Common questions about hardware, privacy, GPUs, deployment, and what Alcoves is (and is not).
---

:::note[Sample doc]
A starter FAQ. Questions and answers will grow alongside the product.
:::

## Do I need a GPU?

**No.** All ML in Alcoves is CPU-only by design — face/object detection, audio
tagging, and speech transcription all run on CPU. Models are selected for that
constraint. See [Privacy & local AI](/concepts/privacy-and-local-ai/).

## Is any of my data sent anywhere?

**No.** There is no telemetry, no analytics, and no inference that leaves your
instance. The Go backend is a pure API that never phones home.

## What hardware do I need?

A machine with roughly **8 GB of RAM** is the practical ceiling for the CPU-only
models. Storage scales with your library — use a local disk or any S3-compatible
object store. A Raspberry Pi with a USB drive and a rack with an object store are
both supported.

## How do I deploy it?

With **Docker** and **Docker Compose** for a single host, or the **Helm chart**
for Kubernetes. External PostgreSQL and Dragonfly/Redis are expected; storage is
local or S3. Start with the [Quickstart](/getting-started/quickstart/).

## Who can administer an instance?

The first registered user becomes the **owner**. Owner-gated surfaces include the
admin panel, the job-queue dashboard, registration policy, and ML-model
selection. Within libraries, the roles are **owner / admin / viewer**.

## Is it production-ready?

Alcoves is **alpha** (`0.x.y`). Expect breaking changes — they ship with
migrations and changelog entries. It targets bounded, trusted instances
(1–100 users), not anonymous mass signup.

## Can other tools talk to it?

Yes — Alcoves ships an **MCP (Model Context Protocol) server** so MCP-capable
clients can browse libraries and move files over stdio or HTTP, authenticated by
a personal access token.
