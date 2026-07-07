---
title: "Storage backends (local & S3)"
description: "How Alcoves stores file blobs, avatars, and cache artifacts — the Driver interface, Service facade, key routing, and S3 vs local config."
---

Alcoves stores three classes of binary data: **original file blobs**, **user
avatars**, and **derived cache artifacts** (image transforms, video proxies,
thumbnails, waveforms, moment exports, face thumbnails). Every byte of that I/O
flows through a single storage abstraction that keeps the rest of the backend
agnostic about whether bytes live on a local filesystem or an S3-compatible
object store. You select the backend at startup via a single environment
variable — no code changes required.

This page describes the storage model for contributors and operators: the
layered abstraction, how domain identifiers are routed to storage keys, the
cascade-delete semantics that keep derived artifacts consistent with originals,
and what each backend requires in deployment.

For environment variables and operator configuration, see
[Configuration](/getting-started/configuration/).
For deployment topology and Kubernetes specifics, see
[Deployment](/self-hosting/deploying-alcoves/).

---

## Architecture overview

The storage layer is organized into three tiers:

```
handlers / media services
        |  StoreFile, ReadCacheBuffer, DeleteFile, ...
        v
   storage.Service        ← key routing (domain IDs → scoped keys)
        |  PutBuffer(scope, key), OpenReadStream(scope, key, range), ...
        v
   storage.Driver         ← LocalDriver | S3 driver
        |
        v
   local filesystem  /  S3 bucket
```

**Driver** — a low-level interface that speaks only in `(scope, key)` pairs and
raw byte streams. Both the local and S3 implementations satisfy the same
contract, so everything above the driver is backend-agnostic.

**Service** — wraps a driver and handles *key routing*: it translates domain
identifiers (library ID, file ID, user ID) into the scope-qualified keys the
driver understands. All handlers and media services call the Service, never the
Driver directly.

**Concrete drivers** — `LocalDriver` (local filesystem, the default) and an S3
driver. The rest of the system never sees the switch — but note that today the
server **always constructs the local driver**; the S3 driver and its
configuration exist in the codebase without being wired into startup yet.

---

## Storage scopes

A scope is a namespace that partitions storage into three independent roots —
a separate directory tree for the local driver, or a separate key prefix for S3.

| Scope | Holds |
|---|---|
| `files` | Original uploaded file blobs |
| `avatars` | User avatar images (WebP, center-cropped, ≤ 512 px) |
| `cache` | Derived artifacts — image transforms, video proxies, thumbnails, waveforms, moment exports, face thumbnails |

Keeping these scopes separate is what lets Alcoves purge all derived cache for a
file without touching the original blob, and vice versa.

---

## Key routing and the Service facade

The Service translates domain objects into hierarchical storage keys.

### File and avatar keys

```
files scope:    {libraryID}/{fileID}/blob
avatars scope:  {userID}/avatar.webp
```

Nesting every file under `{libraryID}/{fileID}/` is intentional: the same
prefix is reused across the `files` and `cache` scopes so a single prefix
delete can sweep the original blob and all its derived artifacts at once.

### Cache keys

Cache keys are built by the media pipeline that produces the artifact, not by
the Service. This keeps each pipeline's cache layout self-contained. The
conventions across all pipelines are:

| Artifact | Cache key |
|---|---|
| Image transform | `{libraryID}/{fileID}/transforms/w{W}_h{H}_q{Q}.{format}` |
| Video thumbnail | `{libraryID}/{fileID}/thumbnail.webp` |
| Legacy video proxy | `{libraryID}/{fileID}/proxy.mp4` |
| Waveform JSON | `{libraryID}/{fileID}/waveform.json` |
| Face thumbnail | `{libraryID}/faces/{faceDetectionID}.webp` |
| Moment export | `{libraryID}/moments/{momentID}/v{version}.mp4` |

All per-file artifacts live under `{libraryID}/{fileID}/...`, which is why
deleting a file can purge every transform, thumbnail, proxy, and waveform with
a single cache prefix sweep.

Moment exports are versioned: each edit to a moment's time range writes a fresh
`v{N}.mp4`. Stale versions are swept when the moment is saved, and the new
encode writes its result atomically, so old exports remain available until the
new one is complete.

### File deletion semantics

The Service exposes two distinct delete operations, which is the key
correctness property of the facade:

| Operation | What it removes | When to use |
|---|---|---|
| `DeleteFile` | Original blob **and** all derived cache (cascade) | Trashing or permanently purging a file |
| `DeleteFileBlob` | Original blob only; leaves cache intact | Deduplication — collapsing a duplicate blob that still has referenced thumbnails |

Using the wrong operation would either leave orphaned cache data on disk or
destroy thumbnails still referenced by other rows.

---

## Byte-range reads

HTTP `Range` requests — video scrubbing, partial image fetches, resumable
streaming — are handled natively. All read-stream methods accept an optional
byte range with a start offset and an end offset (`-1` means "to EOF"). A
missing range means "read the whole object."

The local driver implements this by seeking to the start offset and wrapping
the read in a length-bounded reader that correctly releases the underlying file
handle when the stream is closed.

---

## Local driver

The local driver is the default (`ALCOVES_STORAGE_DRIVER=local`). It maps the
three scopes to three directory roots on the filesystem, configured via
environment variables (see [Configuration](#configuration) below).

At startup it creates all three root directories if they do not already exist.
Prefix deletes are implemented as recursive directory removal, which makes
cascade deletes efficient.

:::tip
The local driver has no external dependencies and requires no cloud credentials.
It is the right choice for single-node installs, development, and instances
where data stays entirely on your own hardware.
:::

---

## S3 driver

:::caution[Not available yet]
The S3 driver and its `ALCOVES_S3_*` configuration are present in the codebase,
but the server currently always uses the local driver — setting
`ALCOVES_STORAGE_DRIVER=s3` has no effect yet. This section describes the
design so you know where it's headed; treat S3 as planned, not available.
:::

The S3 driver backs the same interface against any S3-compatible object store
(AWS S3, MinIO, Cloudflare R2, Backblaze B2, etc.). Because it satisfies the
same Driver contract, the Service, all handlers, and all media workers behave
identically — only the destination of the bytes changes.

Each scope maps to a configurable key prefix in the bucket:

| Scope | Default prefix |
|---|---|
| `files` | `files` |
| `avatars` | `avatars` |
| `cache` | `cache` |

You can override each prefix independently (see [Configuration](#configuration)
below). All three scopes share one bucket.

:::note
S3 is the natural choice for multi-replica or autoscaled deployments. Object
storage is inherently shared with no single-writer constraint, so both the API
and worker processes coordinate through the bucket without needing a shared
volume.
:::

---

## Configuration

### Driver selection

| Variable | Default | Values |
|---|---|---|
| `ALCOVES_STORAGE_DRIVER` | `local` | `local` or `s3` |

### Local driver

| Variable | Default | Description |
|---|---|---|
| `ALCOVES_STORAGE_PATH` | `./data` | Data root. The files scope is at `{path}/files`. |
| `ALCOVES_AVATAR_STORAGE_PATH` | `{dataDir}/avatars` | Avatars scope root (overrides the default derivation). |
| `ALCOVES_CACHE_STORAGE_PATH` | `{dataDir}/.cache` | Cache scope root (overrides the default derivation). |

By default all three scopes live under `./data` (`./data/files`,
`./data/avatars`, `./data/.cache`). You can point each scope at a separate
volume by overriding the path variables independently.

### S3 driver

| Variable | Description |
|---|---|
| `ALCOVES_S3_BUCKET` | Bucket name |
| `ALCOVES_S3_REGION` | Region (e.g. `us-east-1`) |
| `ALCOVES_S3_ENDPOINT` | Custom endpoint URL for S3-compatible stores |
| `ALCOVES_S3_ACCESS_KEY_ID` | Access key ID |
| `ALCOVES_S3_SECRET_ACCESS_KEY` | Secret access key |
| `ALCOVES_S3_FORCE_PATH_STYLE` | `true` for path-style addressing (required by MinIO and some compatible stores) |
| `ALCOVES_S3_FILES_PREFIX` | Key prefix for the files scope (default `files`) |
| `ALCOVES_S3_AVATARS_PREFIX` | Key prefix for the avatars scope (default `avatars`) |
| `ALCOVES_S3_CACHE_PREFIX` | Key prefix for the cache scope (default `cache`) |

---

## Deployment: shared storage and the Helm chart

Alcoves splits the backend into two workloads — `backend-api` (handles HTTP
requests) and `backend-worker` (runs ffmpeg, whisper.cpp, and ONNX jobs). Both
processes read and write to storage: the API writes uploaded blobs that the
worker reads as transcode sources, and the worker writes derived cache artifacts
that the API streams back to clients.

### Local driver in Kubernetes

When running with the local driver under Kubernetes, the PVC mounted at
`/app/data` **must be `ReadWriteMany` (RWX)**. The Helm chart defaults to RWX
for exactly this reason.

:::caution
A `ReadWriteOnce` (RWO) volume only allows a single pod to mount it. With a
RWO volume the API and worker pods cannot both run simultaneously, which breaks
the split-deployment model. RWX is also required whenever the API or worker
replica count is greater than one.
:::

The Helm chart injects consistent storage paths into both deployments:

```
ALCOVES_STORAGE_PATH=/app/data
ALCOVES_AVATAR_STORAGE_PATH=/app/data/avatars
ALCOVES_CACHE_STORAGE_PATH=/app/data/.cache
```

### S3 in Kubernetes

When running with the S3 driver, no PVC is created. Both workloads coordinate
through the bucket, which is inherently shared. This is the recommended approach
for multi-replica or autoscaled deployments.

---

## Related pages

- [Backend architecture](/architecture/backend-architecture-go/) — startup sequence, async job model, and handler patterns
- [Media processing pipeline](/architecture/media-processing-pipeline/) — how image transforms, video proxies, thumbnails, and waveforms are produced and cached
- [Deployment](/self-hosting/deploying-alcoves/) — Helm chart topology, PVC configuration, and S3 setup
- [Configuration](/getting-started/configuration/) — full environment variable reference
