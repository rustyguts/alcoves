---
title: FAQ
description: Common questions about hardware, privacy, GPUs, deployment, and what Alcoves is (and is not).
---

## Do I need a GPU?

**No.** All media analysis in Alcoves — face and object detection, audio
tagging, speech transcription — runs on CPU by design. See
[Privacy & local AI](/concepts/privacy-and-local-ai/).

## Is any of my data sent anywhere?

Your files and everything derived from them stay on your instance, and there
is no analytics or usage tracking. The few outward connections are ones you
control: ML models download on first use (mirrorable), the map view loads
OpenStreetMap tiles by default (configurable), and error reporting only exists
if you configure a Sentry DSN. The details are on the
[privacy page](/concepts/privacy-and-local-ai/).

## What hardware do I need?

An x86_64 machine — the published Docker images are x86_64-only right now.
8 GB of RAM is comfortable. Transcription is the biggest memory consumer: the
default whisper model wants several GB, and the admin panel lets you choose a
smaller one for lighter hardware. Storage is a local disk (or any volume you
mount); size it for your library.

## How do I deploy it?

With **Docker Compose** on a single machine, or the **Helm chart** on
Kubernetes. You bring PostgreSQL (with pgvector) and a Redis-compatible queue
(Dragonfly works well); one published image runs the frontend, the API, and
the worker. Start with the [Quickstart](/getting-started/quickstart/).

## Who can administer an instance?

The first registered user becomes the instance **owner**. Only the owner can
open the admin panel, the job-queue dashboard, registration policy, and ML
model selection. Within libraries, the roles are **owner / admin / viewer**.

## Is it production-ready?

Alcoves is **alpha** (`0.x`). It works and is used daily, but expect breaking
changes between releases — they ship with migrations and changelog entries.
It is built for bounded, trusted groups, not anonymous mass signup.

## Can other tools talk to it?

Yes — Alcoves includes an **MCP (Model Context Protocol) server**, so
MCP-capable assistants and scripts can browse libraries, upload, and organize
files. It runs over stdio or HTTP, authenticated with a personal access token
or OAuth. See the [MCP server](/features/mcp-server/) page.
