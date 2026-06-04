# Alcoves — Feature Ideas (Backlog)

> Future, vision-aligned feature ideas worth building. This is the long-horizon
> "what could Alcoves become" list. For concrete near-term fixes and chores see
> [todos.md](todos.md); for the product north-star every idea must honor see
> [vision.md](vision.md).
>
> Each idea is gut-checked against the vision's six questions: keep media +
> inference **on the instance**, respect **library roles / owner gate**, do heavy
> work **async + idempotent**, **degrade gracefully**, serve the **bounded
> self-hosted** user (not a SaaS), and update **both sides of every contract**.

These came out of a product review of the codebase. The first item from that
review — **EXIF pipeline → Timeline + Map** — has shipped (capture date / GPS
extraction, `/timeline` + `/map` endpoints, Timeline + Map views). The rest are
captured below.

---

## 1. Unified deep search (transcripts · people · tags · audio · date)

**What:** Extend search beyond filename + object labels to also match whisper
**transcripts**, **person names**, **tag names**, **audio-event labels**, and
**date ranges**, surfacing why each result matched (the `matchReason` chips the
UI already renders).

**Why it fits:** Directly serves the "media-intelligent — searchable, not just
stored" pillar. The data already exists and is indexed; only the search handler
is shallow. No new ML, no new privacy surface.

**Build on:** `backend/internal/handlers/search.go` (today: filename + folder +
`object_detections` labels only). Add Postgres `tsvector` full-text over
`files.transcript_text`; join `people` / `face_detections`, `tags` /
`file_tags`, and `audio_detections`. Keep the existing `searchResult` shape +
`matchReason`/`matchedLabels` so the frontend needs minimal change.

**Effort:** S–M. **Highest value-per-effort** — all the inputs are already in the DB.

---

## 2. Natural-language semantic image search (CPU CLIP)

**What:** Type "sunset on a beach" and get matching photos — a CPU-only ONNX
**CLIP** image+text encoder. Embed images on upload into pgvector; embed the
query text at search time and rank by cosine similarity.

**Why it fits:** The flagship "as capable as the cloud incumbents" feature, and
it reuses infrastructure already shipped: **pgvector + HNSW** (used for face
embeddings) and the on-demand model-download + CPU-only ONNX runtime pattern. No
inference leaves the box.

**Build on:** the face-embedding stack — `backend/internal/services/facedetection/`
(HNSW index, `onnxruntime_go` usage) and `ml-models-and-runtime-inference.md`
(on-demand model download). New async `imageembedding` worker mirroring the
existing detection workers; a new `image_embeddings` table (or column) with an
HNSW index; a `/search?semantic=` path.

**Effort:** L. The big-bet headliner; land the cheaper wins first.

---

## 3. Public album / photo / folder share links

**What:** Generalize public sharing beyond video moments: let an owner publish a
**revocable** public link to a single photo, a selected set, or a whole
album/folder — with OG/Twitter embeds and an SSR landing page.

**Why it fits:** Collaboration pillar; opt-in per resource, owner-gated, and
revocable — exactly the privacy posture the moment shares already honor. Mirrors
Google Photos shared albums, which are entirely absent today.

**Build on:** the proven `MomentShare` pattern — `backend/internal/handlers/moment_share.go`
+ `share.go` (token, revoke, `/api/share/:token/*` no-auth routes) and the SSR
landing at `frontend/app/pages/s/[token].vue`. Generalize the share token to
point at a file / file-set / folder instead of only a moment.

**Effort:** M.

---

## 4. Curated Albums + Favorites

**What:** Add **Albums** — cross-folder curated collections, distinct from the
filesystem hierarchy — plus a one-tap **Favorite/star** flag and a Favorites
view. Folders are the "Drive" half (storage); albums are the "Photos" half
(curation).

**Why it fits:** It's the organizational model families actually use for photos,
and it's a natural home for idea #3's public sharing and the shipped Timeline /
"On this day" surfaces. A `favorite` boolean is a tiny, high-utility win on its
own.

**Build on:** the `models.go` schema + library access middleware. Favorites:
a `favorited_at` (or join table) on files + a filter on the listing/timeline
queries. Albums: a new `albums` + `album_files` pair (many-to-many, ordered),
owner/admin-gated CRUD under `/api/libraries/:id/albums`, reusing the existing
`FileResponse` serialization.

**Effort:** S (favorites) / M (albums).

---

## Suggested sequencing

1. **#1 Deep search** — cheapest, immediately useful, no new deps.
2. **#4 Favorites** then **Albums** — the curation layer; favorites is nearly free.
3. **#3 Public album sharing** — extends the proven share-link model; pairs with albums.
4. **#2 CLIP semantic search** — the headline once the cheaper wins land.

All four stay CPU-only, local, owner-gated, and async-by-default — no conflict
with [vision.md](vision.md).
