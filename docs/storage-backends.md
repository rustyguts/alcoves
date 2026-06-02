# Storage Backends (Local & S3)

Alcoves stores three classes of binary data: **original file blobs**, **user
avatars**, and **derived cache artifacts** (image transforms, video proxies,
thumbnails, waveforms, moment exports, face thumbnails). Every byte of that I/O
flows through a single storage abstraction in `backend/internal/services/storage/`.
This abstraction lets the rest of the backend stay agnostic about whether bytes
land on a local filesystem (`local` driver) or an object store (`s3` driver),
selected at boot by the `ALCOVES_STORAGE_DRIVER` env var.

This document describes the architecture of that abstraction: its scopes, its
`Driver` interface, the `Service` facade that routes domain operations to scoped
keys, the `LocalDriver` implementation, and the operational consequences (notably
the shared-PVC requirement under Helm).

---

## Architecture

The package is layered in three pieces:

1. **`Driver` interface** — the low-level contract. Any backend (local FS, S3)
   implements it. It speaks only in `(scope, key)` pairs and raw bytes/streams.
2. **`Service` facade** — wraps a `Driver`. It owns the *key routing* logic:
   turning domain identifiers (library ID, file ID, user ID) into the
   scope-qualified keys the driver understands. All handlers and media services
   call the `Service`, never the `Driver` directly.
3. **Concrete drivers** — `LocalDriver` (in this package) and an S3 driver
   (separate implementation, selected by env var). Both satisfy `Driver`.

```
handlers / media services
        |  StoreFile, ReadCacheBuffer, DeleteFile, ...
        v
   storage.Service        <- key routing (fileKey/avatarKey/cache keys)
        |  PutBuffer(scope, key, ...), OpenReadStream(scope, key, range), ...
        v
   storage.Driver         <- LocalDriver | S3 driver
        |
        v
   local FS  /  S3 bucket
```

Wiring happens once in `backend/cmd/server/main.go`: it constructs the driver
(`storage.NewLocalDriver(...)`), passes it to `storage.NewService(...)`, and
calls `EnsureReady()` before serving traffic. The `*storage.Service` is then
injected into every handler and async worker that touches media.

### Scopes

A `Scope` is a string namespace that partitions storage into three independent
roots:

```go
type Scope string // "files", "avatars", "cache"
```

| Scope         | Holds                                                        |
| ------------- | ----------------------------------------------------------- |
| `ScopeFiles`  | Original uploaded file blobs                                 |
| `ScopeAvatars`| User avatar WebP images                                      |
| `ScopeCache`  | Derived artifacts (transforms, proxies, thumbnails, etc.)   |

Each scope maps to its own backing location: a separate directory for the local
driver, or a separate key prefix for S3. This separation is what lets Alcoves
purge all of a file's derived cache without touching the original blob, and vice
versa.

### Byte ranges

HTTP `Range` requests (video scrubbing, partial image fetches, resumable
streaming) are served by passing a `ByteRange` into the read-stream methods:

```go
type ByteRange struct {
    Start int64
    End   int64 // -1 means "to EOF"
}
```

A `nil` `*ByteRange` means "read the whole object."

---

## The `Driver` interface

```go
type Driver interface {
    EnsureReady() error
    PutBuffer(scope, key string, data []byte) error
    PutStream(scope, key string, reader io.Reader) (int64, error)
    OpenReadStream(scope, key string, byteRange *ByteRange) (io.ReadCloser, error)
    ReadBuffer(scope, key string) ([]byte, error)
    Exists(scope, key string) (bool, error)
    Stat(scope, key string) (int64, error)
    DeletePrefix(scope, keyPrefix string) error
}
```

| Method            | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `EnsureReady`     | One-time init at startup (create directories / verify bucket access).   |
| `PutBuffer`       | Write a fully-buffered `[]byte`.                                         |
| `PutStream`       | Write from an `io.Reader` without buffering; returns bytes written.     |
| `OpenReadStream`  | Open a read stream, optionally limited to a `ByteRange`.                |
| `ReadBuffer`      | Read the entire object into memory.                                     |
| `Exists`          | Cheap existence check.                                                   |
| `Stat`            | Object size in bytes.                                                    |
| `DeletePrefix`    | Recursively delete everything under a key prefix.                       |

`DeletePrefix` is the workhorse for cleanup — both blob deletion and cache
purging are expressed as prefix deletes, which is why keys are structured
hierarchically (see below).

---

## The `Service` facade and key routing

`Service` wraps a `Driver` and translates domain identifiers into scoped keys.
There are two deterministic key schemes plus a caller-supplied scheme for cache.

### Deterministic keys

```go
// scope: ScopeFiles
fileKey(libraryID, fileID)  ->  "<libraryID>/<fileID>/blob"

// scope: ScopeAvatars
avatarKey(userID)           ->  "<userID>/avatar.webp"
```

The `{lib}/{file}/blob` layout is deliberate: it nests every file under a
`<libraryID>/<fileID>/` prefix so the file scope and the cache scope can be swept
with a single prefix delete keyed on the same path.

### Caller-supplied cache keys

Cache keys are **not** generated by the `Service` — callers (the media services)
build them and pass them through verbatim. This keeps the cache key scheme owned
by whichever pipeline produces the artifact. See
[Cache key conventions](#cache-key-conventions-derived-artifacts) below.

### High-level file methods

| Method                                           | Behavior                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `StoreFile(libraryID, fileID, data)`             | Write blob to `ScopeFiles` at `fileKey`.                                                                   |
| `StoreFileStream(libraryID, fileID, reader)`     | Stream blob in (used by the streaming upload + TUS paths).                                                 |
| `DeleteFile(libraryID, fileID)`                  | **Cascade delete**: removes `ScopeFiles/<lib>/<file>` *and* `ScopeCache/<lib>/<file>` prefixes — original blob plus all derived cache (proxy, thumbnail, waveform, transforms). |
| `DeleteFileBlob(libraryID, fileID)`              | **Blob-only** delete; leaves cache intact. Used by deduplication so a duplicate's blob can be reclaimed while keeping derived artifacts available. |
| `FileExists`, `FileStat`, `ReadFileBuffer`       | Standard existence/size/read.                                                                              |
| `OpenFileReadStream(libraryID, fileID, range)`   | Range-aware read stream (HTTP Range, transcode source staging, hashing).                                  |

The split between `DeleteFile` (cascade) and `DeleteFileBlob` (blob-only) is the
key correctness property of this facade. File purge uses `DeleteFile` to leave no
orphaned derived data; dedup uses `DeleteFileBlob` so collapsing duplicates does
not destroy thumbnails/proxies that other rows still reference.

### Avatar methods

| Method                          | Behavior                                       |
| ------------------------------- | ---------------------------------------------- |
| `StoreAvatar(userID, data)`     | Write normalized WebP to `ScopeAvatars`.       |
| `AvatarExists(userID)`          | Existence check.                               |
| `ReadAvatarBuffer(userID)`      | Read avatar bytes (served as `image/webp`).    |

Avatars are produced by `avatarproc.Process` (center-cropped, <=512px, WebP q85)
in the avatar handler before reaching storage.

### Cache surface

The full cache API — all under `ScopeCache`, all with caller-managed keys:

| Method                                          | Behavior                                            |
| ----------------------------------------------- | --------------------------------------------------- |
| `CacheExists(key)`                              | Existence check (used as a fast path before enqueueing work). |
| `OpenCacheReadStream(key)`                      | Whole-object read stream.                            |
| `OpenCacheReadStreamRange(key, range)`          | Range read stream (video proxy / moment download / share video). |
| `CacheStat(key)`                                | Object size.                                         |
| `ReadCacheBuffer(key)`                          | Read entire artifact into memory.                   |
| `StoreCacheBuffer(key, data)`                   | Write a buffered artifact.                           |
| `StoreCacheStream(key, reader)`                 | Stream an artifact in (e.g. moment export streams the encoded MP4 directly into cache without buffering). |
| `DeleteCachePrefix(prefix)`                     | Delete all artifacts under a prefix (e.g. all versions of a moment export). |

---

## Cache key conventions (derived artifacts)

Because cache keys are caller-supplied, the producing pipeline owns the layout.
Keeping these consistent and prefix-friendly is what makes `DeleteFile`'s cache
cascade and `DeleteCachePrefix` work correctly. The conventions across the
codebase:

| Artifact            | Producer                                       | Cache key                                                  |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Image transform     | `imageproxy`                                   | `{libraryID}/{fileID}/transforms/w{W}_h{H}_q{Q}.{format}`  |
| Video thumbnail     | `videoproxy`                                   | `{libraryID}/{fileID}/thumbnail.webp`                      |
| Legacy video proxy  | `file` handler (legacy path)                   | `{libraryID}/{fileID}/proxy.mp4`                           |
| Waveform JSON       | `waveform`                                     | `{libraryID}/{fileID}/waveform.json`                       |
| Face thumbnail      | `facedetection`                                | `{libraryID}/faces/{faceDetectionID}.webp`                 |
| Moment export       | `momentexport`                                 | `{libraryID}/moments/{momentID}/v{version}.mp4`            |

Two design notes:

- **All per-file artifacts live under `{libraryID}/{fileID}/...`.** That is why
  `DeleteFile(libraryID, fileID)` can purge every transform, thumbnail, proxy,
  and waveform for a file with a single `ScopeCache` prefix delete at
  `<libraryID>/<fileID>`.
- **Versioned exports share a prefix.** `momentexport.CachePrefix(libraryID,
  momentID)` is `{libraryID}/moments/{momentID}/`; each export version is a
  distinct file (`v1.mp4`, `v2.mp4`, ...) under it. When a moment's time range
  changes, the handler calls `storage.DeleteCachePrefix(...)` to sweep stale
  versions, and the next encode writes a fresh `v{N}.mp4`. Face thumbnails live
  under `{libraryID}/faces/` and are purged per-detection or as a library-wide
  prefix sweep (`{libraryID}/faces`) when face data is reset.

---

## `LocalDriver`

`LocalDriver` is the default backend (`ALCOVES_STORAGE_DRIVER=local`). It maps the
three scopes to three filesystem roots.

- **Resolution**: `resolve(scope, key)` returns `filepath.Join(roots[scope], key)`.
  The three roots are configured at construction from the storage env vars.
- **`EnsureReady`**: `os.MkdirAll` for all three roots (files, avatars, cache).
  Called once at startup from `main.go`.
- **`PutBuffer` / `PutStream`**: create parent directories as needed, then write
  the buffer or copy the reader to disk.
- **`OpenReadStream` with a `ByteRange`**: opens the file, `Seek`s to
  `range.Start`, and wraps it in an `io.LimitReader` bounded to the requested
  span. Because `io.LimitReader` does not expose the underlying file's `Close`,
  the driver returns a small internal `limitedReadCloser` that composes the
  limited `io.Reader` with the file's `io.Closer` — so callers can `Close()` the
  stream and release the OS file handle.
- **`DeletePrefix`**: `os.RemoveAll` on the resolved prefix directory. This is
  what makes the cascade and prefix-sweep semantics above efficient on local
  storage.
- **`Stat` / `Exists`**: backed by `os.Stat`.

Tests (`storage_test.go`) run entirely against `t.TempDir()` with no external
dependencies, covering store/read, range reads, prefix deletes, avatar ops,
stream ingest, `EnsureReady` directory creation, and the `DeleteFile` cascade to
cache.

---

## S3 driver

When `ALCOVES_STORAGE_DRIVER=s3`, a separate `Driver` implementation (outside this
package) backs the same interface against an S3-compatible object store. It is
selected at startup in `main.go` based on the env var. Because it satisfies the
identical `Driver` contract, the `Service` facade, all handlers, and all media
workers behave identically regardless of backend — only the bytes' destination
changes. Each scope maps to a configurable key prefix in the bucket
(`ALCOVES_S3_FILES_PREFIX`, `ALCOVES_S3_AVATARS_PREFIX`, `ALCOVES_S3_CACHE_PREFIX`).

---

## Configuration

Storage is configured via `ALCOVES_*` env vars, loaded in
`backend/internal/config/config.go` and consumed in `main.go` when constructing
the driver.

### Driver selection

| Var                       | Default | Notes                          |
| ------------------------- | ------- | ------------------------------ |
| `ALCOVES_STORAGE_DRIVER`  | `local` | `local` or `s3`.               |

### Local driver

| Var                            | Default                | Notes                                                            |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------- |
| `ALCOVES_STORAGE_PATH`         | `./data` -> `{path}/files` | Files root. Config derives the files scope as `{ALCOVES_STORAGE_PATH}/files`. |
| `ALCOVES_AVATAR_STORAGE_PATH`  | under `{dataDir}`      | Avatars scope root (independent override).                       |
| `ALCOVES_CACHE_STORAGE_PATH`   | under `{dataDir}`      | Cache scope root (independent override).                         |

(Defaults land under `./data/{files,avatars,.cache}`.)

### S3 driver

| Var                              | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `ALCOVES_S3_BUCKET`              | Bucket name.                                       |
| `ALCOVES_S3_REGION`              | Region.                                            |
| `ALCOVES_S3_ENDPOINT`            | Custom endpoint (for S3-compatible stores).        |
| `ALCOVES_S3_ACCESS_KEY_ID`       | Access key.                                        |
| `ALCOVES_S3_SECRET_ACCESS_KEY`   | Secret key.                                        |
| `ALCOVES_S3_FORCE_PATH_STYLE`    | Path-style addressing (`true`/`false`).            |
| `ALCOVES_S3_FILES_PREFIX`        | Key prefix for the files scope (default `files`).  |
| `ALCOVES_S3_AVATARS_PREFIX`      | Key prefix for the avatars scope (default `avatars`). |
| `ALCOVES_S3_CACHE_PREFIX`        | Key prefix for the cache scope (default `cache`).  |

---

## Deployment consequences (Helm)

Alcoves splits the backend into two Kubernetes workloads that both use the same
image: `backend-api` (`ALCOVES_MODE=api`, HTTP) and `backend-worker`
(`ALCOVES_MODE=worker`, ffmpeg / whisper.cpp / ONNX jobs). Both processes read
and write the **same** storage.

When `storage.driver=local`, the Helm chart's `_envvars.tpl` injects fixed local
paths into both deployments:

```
ALCOVES_STORAGE_PATH=/app/data
ALCOVES_AVATAR_STORAGE_PATH=/app/data/avatars
ALCOVES_CACHE_STORAGE_PATH=/app/data/.cache
```

and mounts the PVC at `/app/data` on **both** the API and worker pods. Because
the worker writes derived cache (proxies, thumbnails, waveforms, moment exports)
that the API later streams to clients — and the API writes original blobs the
worker reads as transcode sources — the volume **must be `ReadWriteMany` (RWX)**.
The chart's `pvc.yaml` defaults to `accessModes: [ReadWriteMany]` for exactly
this reason. A `ReadWriteOnce` volume would let only one pod mount it, breaking
the api/worker split. RWX is also mandatory whenever the API or worker
`replicaCount > 1`.

When `storage.driver=s3`, the PVC is not created and both workloads coordinate
through the bucket instead — the natural choice for multi-replica or autoscaled
deployments since object storage is inherently shared and has no single-writer
constraint. The `_envvars.tpl` helper switches between the local-path and S3
env-var sets based on `storage.driver`.

---

## Related code

| Path                                                      | What it is                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `backend/internal/services/storage/storage.go`            | `Scope`, `ByteRange`, `Driver` interface, `Service` facade, key routing, `LocalDriver`, `limitedReadCloser`. |
| `backend/internal/services/storage/storage_test.go`       | Local-driver tests (store/read/range/delete, cascade, EnsureReady).|
| `backend/internal/config/config.go`                       | Loads `ALCOVES_STORAGE_DRIVER`, storage paths, and all `ALCOVES_S3_*` fields. |
| `backend/cmd/server/main.go`                              | Constructs the driver + `Service`, calls `EnsureReady()`, injects into handlers/workers. |
| `helm/alcoves/templates/_envvars.tpl`                     | Storage env-var branching (`local` paths vs. `s3` prefixes).       |
| `helm/alcoves/templates/pvc.yaml`                         | RWX PVC created for the local driver.                              |
| `backend/internal/services/imageproxy/`                   | Producer of `transforms/...` cache keys.                           |
| `backend/internal/services/videoproxy/`                   | Producer of `thumbnail.webp` (+ legacy `proxy.mp4`).               |
| `backend/internal/services/waveform/`                     | Producer of `waveform.json`.                                       |
| `backend/internal/services/momentexport/`                 | `CacheKey` / `CachePrefix` for versioned moment exports.           |
| `backend/internal/services/facedetection/`                | Producer of `faces/{detectionID}.webp`.                            |
| `backend/internal/services/avatarproc/`                   | Normalizes avatar bytes before `StoreAvatar`.                      |
