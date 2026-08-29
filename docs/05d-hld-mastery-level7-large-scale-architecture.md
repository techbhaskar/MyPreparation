# Stage 5 (Part D) — HLD Mastery: Level 7 Large-Scale Architecture
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **Framing question:** *Can I combine the building blocks appropriately instead of memorizing
architectures?*

Every system below is built from the same primitives you already know: load balancers, consistent
hashing, sharded databases, queues, caches, CDNs, consensus, and idempotency. Nothing here is a new
primitive. What changes at "Level 7" is composition — how many of these primitives you must stack
correctly, in what order, and which one becomes the bottleneck first. Read each design asking "which
building blocks did they pick, and why not the alternative?" rather than "what does a video platform
look like?"

## Table of Contents

1. [YouTube/Netflix — Video Platform](#1-youtubenetflix--video-platform)
2. [Google Drive — File Sync & Storage](#2-google-drive--file-sync--storage)
3. [Uber — Full Ride-Sharing Platform](#3-uber--full-ride-sharing-platform)
4. [Amazon-like E-Commerce Platform](#4-amazon-like-e-commerce-platform)
5. [Multi-Region Architecture — Standalone Deep Dive](#5-multi-region-architecture--standalone-deep-dive)
6. [Closing: The Framing Question, Revisited](#6-closing-the-framing-question-revisited)

---

## 1. YouTube/Netflix — Video Platform

### Requirements

**Functional**
- Upload video (creator-side); transcode into multiple resolutions/bitrates.
- Playback with adaptive bitrate streaming (ABR) on varying network conditions.
- Global low-latency delivery via CDN.
- Metadata: titles, thumbnails, captions, view counts, likes/comments.
- Search and recommendations (personalized home page, "up next").
- Access control (public/unlisted/private, DRM for licensed content — Netflix case).

**Non-functional**
- Availability: 99.95%+ for playback (playback failures are highly visible/costly).
- Startup latency: < 2s time-to-first-frame globally.
- Durability: master video assets must never be lost (11 nines-class durability).
- Scale: support billions of daily views, millions of concurrent streams at peak.
- Cost efficiency: storage and egress dominate cost — architecture must minimize both.

### Scale/Capacity Estimation

Assume YouTube-scale numbers:
- 500 hours of video uploaded per minute → ~720,000 hours/day.
- 2 billion logged-in monthly users; ~1 billion hours watched per day.
- Average video: 10 minutes, source at 1080p ≈ 1.5 GB before transcoding.

**Upload storage (raw, pre-transcode):**
720,000 hours/day × 1 hour ≈ 6 GB/hour average bitrate → ~4.3 PB/day raw ingest.

**Transcoded storage (post fan-out):**
Each video is transcoded into ~10 renditions (144p to 4K) × 2 codecs (H.264 for compat, AV1/VP9 for
efficiency) ≈ 15-20x storage multiplier on the *kept* renditions, but AV1 is ~40% smaller than
H.264, so net multiplier for storage footprint ≈ 8-10x source size. → ~35-40 PB/day added to the
storage tier before any retention/de-dup optimizations (unpopular tail videos may only fully
transcode lazily).

**Egress bandwidth (the dominant cost driver):**
1 billion hours/day watched × average bitrate 3 Mbps (mixed resolution mix weighted toward
mobile/SD) ÷ 8 bits/byte = 1B hours × 3600s × 3 Mbps / 8 = ~1.35 exabytes/day of egress. At peak
(evenings, ~3x average), instantaneous egress bandwidth ≈ 1.35 EB/day × 3 / 86400s × 8 bits ≈ **~450
Tbps at peak** — this is why virtually 100% of playback traffic must be served from CDN edge caches,
not origin.

**Concurrent streams:** if 50M people are watching at any peak instant at avg 3 Mbps → 150 Tbps sustained just from that slice — origin infrastructure could never serve this directly; CDN cache hit ratio at the edge must be >95%.

### API Design

```
POST   /v1/uploads/init          -> {uploadId, chunkUrls[]} (resumable upload session)
PUT    /v1/uploads/{uploadId}/chunk/{n}   (parallel chunked upload, direct-to-blob-store)
POST   /v1/uploads/{uploadId}/complete    -> triggers transcode pipeline
GET    /v1/videos/{videoId}               -> metadata, available renditions
GET    /v1/videos/{videoId}/manifest.m3u8 -> HLS/DASH manifest (list of rendition URLs)
GET    /v1/videos/{videoId}/segments/{quality}/{segmentId}.ts  (served by CDN, not origin)
POST   /v1/videos/{videoId}/watch-events  -> {position, bufferEvents, bitrateSwitches} (telemetry, sampled)
GET    /v1/recommendations?userId=...&surface=home
GET    /v1/search?q=...
```
Key design choice: playback is **manifest + segment**, never a single monolithic file URL — this is
what makes ABR possible (client switches segment quality mid-stream).

### Data Model

```
Video (video_id PK, owner_id, title, description, duration_ms,
       status[uploading|processing|ready|failed], visibility,
       created_at, source_blob_ref)

Rendition (video_id, quality_label[144p..4K], codec[h264|av1|vp9],
           bitrate_kbps, manifest_path, segment_prefix, size_bytes)
  -- one row per (video, quality, codec) combination

WatchEvent (event_id, user_id, video_id, watched_ms, timestamp, device)
  -- append-only, feeds analytics + recommendation training, NOT the source
     of truth for view counts (counted via approximate/streaming aggregation)

ViewCountCounter (video_id, approx_count)  -- sharded counter, HLL/CRDT-backed,
                                               eventually consistent, never a
                                               row-level lock on hot videos

Recommendation is NOT a table — it's a served output of an offline-trained
model + an online feature store, described in Deep Dive below.
```
Video metadata lives in a sharded relational/NoSQL store keyed by `video_id`; the actual bytes live
in blob storage (S3-class), never in the metadata DB.

### High-Level Design

```
                         ┌────────────────────┐
 Creator ──upload──────► │  Upload Service      │──► Blob Store (raw ingest)
                         │  (resumable, chunked)│
                         └──────────┬───────────┘
                                    │ "video uploaded" event
                                    ▼
                         ┌────────────────────┐
                         │   Message Queue      │  (Kafka)
                         └──────────┬───────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │   Transcoding Pipeline          │
                    │  (worker fleet, GPU-accelerated)│
                    │  splits into GOP-aligned chunks │
                    │  → parallel transcode → stitch  │
                    └──────────────┬───────────────────┘
                                   ▼
                         Rendition Blob Store  ──► origin
                                   │
                                   ▼
                    ┌───────────────────────────────┐
                    │      CDN (multi-tier edge)      │◄──── Viewer requests
                    │  Edge PoPs → Regional caches     │      manifest + segments
                    │  → Origin shield → Origin store  │
                    └───────────────────────────────┘
                                   ▲
                         Metadata Service (sharded DB)
                                   ▲
                         Recommendation Service
                         (offline model + feature store + online ranker)
```

**Request flow (playback):**
1. Client requests `/v1/videos/{id}` → metadata service returns manifest URL + DRM license info if needed.
2. Client fetches manifest (`.m3u8`/`.mpd`) — lists available bitrate/resolution renditions and their segment URLs, all pointing at the **CDN**, not origin.
3. Client's ABR algorithm picks a starting bitrate (usually low, to minimize startup latency), fetches segments (typically 2-10s each).
4. Client continuously measures throughput/buffer health and switches rendition on segment boundaries — this is what "adaptive" means; it happens entirely client-side using signals from download timing, no server round-trip needed to "decide."
5. CDN edge serves from cache (>95% hit ratio target); on miss, pulls from regional cache, then origin shield (a single coalescing layer that prevents thundering-herd on origin for newly-cold objects), then origin.
6. Watch events are sampled and streamed asynchronously to analytics/recommendation pipelines — never blocking playback.

**Request flow (upload → ready):**
1. Client requests upload session, gets pre-signed chunk URLs, uploads directly to blob store in parallel (bypasses app servers for the heavy bytes — critical at this scale).
2. On completion, an event triggers the transcode pipeline: the source is split into independently-decodable segments (GOP boundaries), fanned out to a worker fleet, each worker produces one (quality, codec) rendition of one segment, results are reassembled and a manifest is generated.
3. Video flips to `ready` once at least the "must-have" renditions (e.g., 480p, 1080p) are complete; higher/rare renditions (4K, AV1) can complete asynchronously — this keeps time-to-publish low without waiting on the most expensive encodes.

### Deep Dive

**(a) Adaptive Bitrate Transcoding & Delivery.** The hard problem isn't "convert a file" — it's doing so at massive parallel scale while keeping cost proportional to *demand*, not to *upload volume* (most uploaded videos get near-zero views; fully transcoding every rendition of every video wastes enormous compute). The real system:
- **Segment-parallel transcoding**: split source into 2-10s independently decodable chunks (aligned to keyframes/GOPs), fan out N chunks × M rendition-targets as independent jobs to a worker pool, then concatenate. This turns a 1-hour video's transcode from a serial O(hours) job into a parallel O(minutes) job.
- **Tiered rendition generation**: generate the 2-3 most commonly requested renditions eagerly (e.g., 360p, 720p — matched to typical mobile bandwidth); generate 4K/AV1/rare codec renditions lazily, on first request, cached thereafter. This is the same "compute on read vs. compute on write" trade-off as caching — for the long tail of videos with near-zero views, eager full transcoding is pure waste.
- **CDN cache hierarchy**: three tiers — edge PoP (closest to viewer, small, hot content only) → regional cache (bigger, catches edge misses across many PoPs in a region) → origin shield (single logical layer per origin that deduplicates concurrent cache-fill requests so a viral video doesn't cause thousands of simultaneous origin pulls, a.k.a. "request coalescing"). Cache key includes rendition + segment index; TTL and eviction favor popularity (LFU-ish), and popular/breaking content can be proactively pushed to edges ("pre-warming") ahead of an anticipated spike (e.g., a scheduled premiere).
- **ABR algorithm** (client-side): estimates throughput from recent segment download times, tracks buffer occupancy, and picks the next segment's bitrate to maximize quality while avoiding rebuffering — classic control-loop trade-off (buffer-based algorithms like BOLA are less bursty than pure throughput-based ones).

**(b) Recommendation System (high level).** Two-stage funnel, because ranking millions of candidate videos per request with a heavy model is infeasible in real time:
1. **Candidate generation** (recall stage): from millions of videos, cheaply narrow to hundreds using collaborative filtering / embedding similarity (user embedding vs. video embedding, ANN lookup) plus heuristics (subscriptions, trending, same-channel).
2. **Ranking** (precision stage): a heavier model (gradient-boosted trees or a neural ranker) scores the hundreds of candidates using rich features — watch history, session context, predicted watch-time, click-through likelihood — and returns a final ordered list.
Feature freshness matters more than model sophistication at this scale: an online feature store
(recent watch events, session signals) feeds the ranker so recommendations react within minutes,
while the heavy embedding models retrain offline (daily/hourly batches).

### Scaling the Design

- **Storage**: shard by `video_id` hash across blob store partitions; cold/rarely-watched content moves to cheaper storage tiers (infrequent access / glacier-class) automatically via lifecycle policies — most videos are watched heavily only in the first days after upload ("recency bias" in view distribution).
- **Transcoding**: horizontally scale the worker fleet; use spot/preemptible compute for the (interruptible, retryable) transcode jobs since they're not latency-critical for already-published content.
- **Metadata**: shard the video metadata store by `video_id`; view counters use a CRDT/HLL-based approximate counter sharded independently to avoid hot-row contention on viral videos (a single row taking millions of increments/sec would melt under naive `UPDATE ... SET count = count+1`).
- **CDN**: this *is* the scaling strategy for delivery — without it, no origin fleet at any size could serve peak egress. Push as much as possible to the edge; origin should ideally see \<5% of total playback traffic.

### Failure Handling

- **Transcode worker crash mid-job**: jobs are idempotent and checkpointed per-segment; a crashed worker's in-flight segment is simply retried by another worker (no partial-state corruption because segments are independent units).
- **CDN edge PoP failure**: GeoDNS/anycast routes around it to the next-nearest PoP; regional cache absorbs the temporary miss surge.
- **Origin store degraded**: origin shield's request coalescing plus long CDN TTLs on already-cached popular content buys significant time — most viewers are unaffected because they're served from edge cache regardless of origin health.
- **Recommendation service down**: fall back to non-personalized (trending/popular) results rather than failing the home page — graceful degradation, not an outage.

### Multi-Region Considerations

Video bytes are inherently region-agnostic once in the CDN (edge caches everywhere), but origin
storage and metadata benefit from being placed near the *upload* region (most creators and most
early viewers are geographically correlated) and replicated asynchronously to other regions for
durability and to seed distant CDN pulls faster. DRM licensing and content availability (geo-
blocking for licensing reasons — very real for Netflix) is enforced at the manifest/license-service
layer per viewer region, not at the CDN layer.

### Trade-offs

- **Eager vs. lazy transcoding**: eager wastes compute on unwatched videos; lazy adds latency to first-ever playback of a rendition. Chosen: hybrid (eager for common renditions, lazy for rare).
- **CDN cost vs. self-hosted edge**: multi-CDN with GeoDNS-based failover costs more in complexity but avoids single-vendor outage risk and enables cost arbitrage.
- **Recommendation freshness vs. compute cost**: a fully real-time ranker per request is more accurate but far more expensive than a two-stage funnel with periodic batch retraining — the funnel is the standard trade because most of the value is in *candidate recall*, not marginal ranking precision.

---

## 2. Google Drive — File Sync & Storage

### Requirements

**Functional**
- Upload/download files and folders; sync across multiple devices automatically.
- Efficient sync of large files via chunking (only changed chunks re-transferred).
- Deduplication of identical content across users/files.
- Conflict resolution when the same file is edited offline on two devices.
- Sharing with granular permissions (view/comment/edit, link-sharing, expiry).
- Version history / restore previous versions.

**Non-functional**
- Durability: 99.999999999% (11 nines) — users must never lose a file.
- Availability: 99.9%+ for read/write API.
- Sync latency: change propagation to other devices in seconds, not minutes.
- Scale: billions of files, exabytes of storage, hundreds of millions of active sync clients.
- Bandwidth efficiency: don't re-upload a full 2GB file for a 1-byte change.

### Scale/Capacity Estimation

Assume Drive-scale:
- 1 billion users, avg 50 GB stored per active user → 50 exabytes total logical storage.
- With global block-level deduplication (common OS files, popular shared documents, cross-user duplicate uploads), effective physical storage might be reduced 20-30% — call it **~35-40 EB physical**.
- Daily active sync clients: 300M, each checking for changes periodically or via long-poll/push.
- Average file edit generates a delta of a few chunks (4-8 MB chunk size is typical): a 2GB video edited slightly might only re-sync 1-2 chunks (~8-16 MB) instead of 2GB — **>100x bandwidth savings** from chunking+dedup on the common "small edit to large file" case.
- Metadata operations (file listing, permission checks, change-feed polling) dominate QPS, not raw byte transfer: at 300M active clients polling every ~30s, that's **~10M metadata QPS** sustained — this, not storage bytes, is what stresses the system day to day.

### API Design

```
POST   /v1/files/init-upload          -> {fileId, chunkPlan[]}  (client computes
                                          chunk hashes locally first)
POST   /v1/chunks/check                -> given [hash1, hash2, ...], returns
                                           which chunks server already has
                                           (dedup check BEFORE upload)
PUT    /v1/chunks/{hash}                -> upload only missing chunks
POST   /v1/files/{fileId}/commit        -> {chunkHashOrder[], parentVersionId}
                                           finalizes a new file version
GET    /v1/files/{fileId}/versions
GET    /v1/files/{fileId}/versions/{v}/download-plan  -> ordered chunk URLs
GET    /v1/changes?since=cursor         -> incremental change feed (sync engine
                                           polls or long-polls this)
POST   /v1/files/{fileId}/share          -> {principal, role[viewer|commenter|editor]}
DELETE /v1/files/{fileId}/share/{principal}
```
The **`/chunks/check`** endpoint before upload is the crux of both dedup and bandwidth efficiency —
client never uploads bytes the server already has, whether from this user's own prior version or
from a *different* user's identical content.

### Data Model

```
File (file_id PK, owner_id, name, parent_folder_id, current_version_id,
      created_at, trashed_at?)

FileVersion (version_id PK, file_id, chunk_list[ordered chunk_hash refs],
             size_bytes, created_at, created_by_device)

Chunk (chunk_hash PK [content-addressed, e.g. SHA-256], size_bytes,
       blob_ref, ref_count)
  -- content-addressed storage: identical bytes ANYWHERE in the system
     share one Chunk row and one blob, regardless of which file/user
     the storage layer is a giant deduplicated blob pool keyed by hash

Permission (file_id, principal_id, role, granted_by, expires_at?)
  -- inherited down folder trees; effective permission is resolved by
     walking ancestry (cached, not recomputed on every check)

ChangeLog (change_id [monotonic per-account cursor], account_id, file_id,
           change_type, version_id, timestamp)
  -- the sync engine's source of truth for "what changed since cursor X"
```
Content-addressing (`chunk_hash` as primary key) is what makes cross-user, cross-file deduplication
essentially free: two users uploading the same PDF end up with `FileVersion` rows pointing at the
same `Chunk` rows, `ref_count` incremented, zero extra bytes stored.

### High-Level Design

```
 Desktop/Mobile Client
   │  (local FS watcher / block-level diff engine)
   ▼
 Sync Engine (client-side)
   │ 1. chunk file, hash chunks
   │ 2. POST /chunks/check  ───────────────►  Chunk Index Service
   │ 3. upload only missing chunks  ──────►  Blob Store (content-addressed)
   │ 4. POST /files/{id}/commit  ─────────►  Metadata Service ──► ChangeLog
   ▼                                              │
 Local change applied                             ▼
                                          Change Feed (per-account, fanned out)
                                                   │
                     ┌─────────────────────────────┼─────────────────────┐
                     ▼                              ▼                     ▼
              Other Device A                 Other Device B      Web Client (push
              (long-poll/push                (long-poll/push      via WebSocket)
               notification)                   notification)
                     │                              │
                     ▼                              ▼
              Pulls delta chunks only, applies to local file
```

**Request flow (edit on Device A → sync to Device B):**
1. Local FS watcher on Device A detects file modified; sync engine re-chunks the file (using content-defined chunking — see Deep Dive — so only the changed region produces new chunk hashes).
2. Client calls `/chunks/check` with the new chunk hashes; server responds with which are already known (either from this file's history or dedup against any other content globally).
3. Client uploads only the missing chunks, then calls `/commit` with the full ordered chunk list for the new version, referencing the previous version as parent (for version history / diffing).
4. Metadata service validates the write (permission check, conflict check against `current_version_id` — see Deep Dive), appends a `ChangeLog` entry, updates `File.current_version_id`.
5. A change-feed fan-out notifies all other active devices/sessions for that account (and anyone with share access) via push (WebSocket/long-poll) or the next poll of `/changes?since=cursor`.
6. Device B receives the change notification, fetches the new version's chunk list, diffs against its local chunk cache, downloads only missing chunks, reconstructs the file locally.

### Deep Dive

**(a) Chunking, Deduplication, and Delta Sync.** The naive approach — fixed-size chunking (e.g., always split every 4MB) — fails badly under insertion/deletion: if you insert one byte at the start of a file, *every subsequent fixed-size chunk boundary shifts*, so every chunk hash changes even though 99.99% of the content is identical. The fix is **content-defined chunking (CDC)**, e.g. a rolling hash (Rabin fingerprint) that declares a chunk boundary whenever the rolling hash matches a pattern (like "last N bits are zero"), rather than at fixed byte offsets. Boundaries are then determined by *content*, not position — so a single inserted byte only perturbs the one or two chunks around the insertion point; every chunk before and after realigns to the same boundaries as before. This is the single most load-bearing algorithmic idea in the whole design: it's what makes "sync a 1-byte change to a 2GB file" cost kilobytes instead of gigabytes. Combined with content-addressed storage (chunk hash = storage key), this also gives *dedup for free* — two files (or two users' files) sharing a chunk automatically share storage, no separate dedup pass needed.

**(b) Conflict Resolution.** Two devices edit the same file while offline, then both reconnect. The server enforces optimistic concurrency: `commit` includes the `parentVersionId` the client based its edit on; if `current_version_id` on the server no longer matches that parent (someone else committed first), the commit is rejected as a conflict rather than silently overwritten — this is the same compare-and-swap pattern used in optimistic locking anywhere. Resolution strategies, in increasing sophistication:
- **Last-write-wins with conflict copy** (what Drive/Dropbox actually do for opaque binary files): the losing device's version is preserved as `"filename (conflicted copy, Device B, 2026-08-24).ext"` rather than discarded — never silently drop user data even on a "conflict," because you cannot safely auto-merge arbitrary binary content.
- **Operational Transform / CRDT-based merge**: for structured, collaboratively-edited documents (Google Docs sits on top of Drive's storage layer but uses OT/CRDTs at the *document* layer, not the file-sync layer, to merge concurrent character-level edits without conflict copies). This only works because the data model is structured (text with positions), not opaque bytes.
The key insight for the interview: file-sync conflict resolution (coarse, versioned, "make a copy")
and document-collaboration conflict resolution (fine-grained, operational, "merge intents") are
different problems solved at different layers — don't conflate them.

### Scaling the Design

- **Chunk Index Service**: sharded by `chunk_hash` (natural, uniform distribution since it's a cryptographic hash) — this is a massive, mostly read-heavy key-value lookup (~exabyte-scale index), a great fit for a distributed hash table / sharded KV store with aggressive caching of hot chunks.
- **Metadata Service**: shard by `account_id` (or `file_id`) — most operations (list folder, check permission, poll changes) are scoped to one account's tree, so this shard key keeps hot paths local to one shard.
- **Change feed fan-out**: for accounts with many active devices/shares, use a pub/sub layer (per-account topic) rather than fanning out synchronously in the commit path — the commit should return as soon as it's durably recorded; notification delivery is decoupled and can retry independently.
- **Blob storage**: standard content-addressed blob store scales by sharding on the hash prefix; `ref_count` on chunks enables garbage collection (a chunk is deleted only when no `FileVersion` references it — reference counting, same idea as in a language runtime's GC).

### Failure Handling

- **Upload interrupted mid-chunk-list**: no partial version is ever visible — `commit` is atomic (all chunks referenced must already be confirmed uploaded, or the commit fails validation) — clients resume by re-running `/chunks/check` and uploading whatever's still missing.
- **Chunk Index Service partition unreachable**: client-side chunking can still proceed; upload/commit simply retries with backoff — sync is delayed, not corrupted, because nothing is applied until the atomic commit succeeds.
- **Change-feed delivery failure**: the `ChangeLog` with monotonic per-account cursors is the durable source of truth; a device that missed a push notification will still catch up on its next `/changes?since=cursor` poll — push is a latency optimization, not the correctness mechanism.

### Multi-Region Considerations

Metadata and chunk indexes for an account are typically pinned to the account's home region (data
residency and latency for the owner), with the blob store replicated cross-region for durability.
Shared files crossing accounts in different regions/residency zones (e.g., a EU user shares a file
with a US user) can require special handling — either the content is replicated to a jurisdiction
acceptable to both, or the sharing is restricted, depending on data-residency policy (GDPR-class
constraints). This is expanded generally in [Section 5](#5-multi-region-architecture--standalone-
deep-dive).

### Trade-offs

- **Content-defined chunking overhead vs. fixed-size simplicity**: CDC requires a rolling-hash pass over the file (CPU cost on the client) but pays for itself enormously in bandwidth savings for edited (not just newly created) files — the right trade for a sync product where re-edits dominate.
- **Global dedup vs. per-user isolation**: cross-user dedup at the content-address layer saves massive storage but means the storage layer holds no notion of "whose" bytes these are (ownership is entirely in the metadata layer's `ref_count`/`FileVersion` pointers) — a deliberate separation of concerns, and also a reason encryption-at-rest for Drive is applied carefully (dedup and per-user encryption keys are in tension — convergent encryption is one way to keep both, at the cost of some cryptographic subtlety).
- **Conflict copies vs. auto-merge**: safer (never lose data) but pushes reconciliation work to the user; acceptable because arbitrary binary auto-merge is unsafe in general.

---

## 3. Uber — Full Ride-Sharing Platform

*(Dispatch matching, surge pricing internals, maps/ETA computation, and payment capture flows are each covered in depth in the dedicated **Ride Sharing System Design** and **Payment System Design** files elsewhere in this curriculum — this section gives the one-line cross-reference and instead focuses on how the *full platform* composes those subsystems together.)*

### Requirements

**Functional**
- Rider requests a ride; system matches to a nearby available driver.
- Real-time location tracking of driver and rider during the trip.
- Dynamic pricing (surge) based on live supply/demand.
- Route/ETA computation for matching, pickup, and trip duration.
- Payment: fare calculation, charge on completion, driver payout.
- Trip history, ratings, receipts.

**Non-functional**
- Matching latency: driver assigned within ~seconds of request.
- Location freshness: driver position updates every 2-4 seconds, propagated to relevant riders/dispatchers with low latency.
- Availability: dispatch must survive regional infra failure (a stalled dispatch system directly means lost revenue and stranded riders).
- Consistency: exactly-once fare charge (never double-charge, never fail to charge) — see Payment System Design file for the idempotency mechanics.
- Scale: millions of concurrent active trips globally, tens of millions of location pings/sec.

### Scale/Capacity Estimation

- 25 million trips/day globally; at any given moment, ~1-2 million trips in progress during global peak overlap.
- Each active driver (matched or searching) reports location every 4s: 5 million active driver devices → **~1.25M location updates/sec** sustained, bursting higher at rush hour in dense metros.
- Each ride request triggers a candidate search: for a rider, find drivers within ~3km — a geospatial query against the live driver location index, needs to resolve in low tens of milliseconds to keep matching latency acceptable.
- Pricing recalculation: surge multipliers recomputed per geo-cell (e.g., H3 hexagons ~1km²) every 30-60s per city — for a city with 5,000 active cells, that's a lightweight periodic aggregation job, not a per-request cost.

### API Design

```
POST /v1/riders/{id}/ride-requests        -> {pickup, dropoff, product}
                                              -> {requestId, estimatedFare, eta}
GET  /v1/ride-requests/{id}/status         -> polling/streaming match status
POST /v1/drivers/{id}/location             -> {lat, lng, heading, ts}  (high-freq)
POST /v1/drivers/{id}/availability         -> {online|offline}
POST /v1/trips/{id}/events                 -> {driverArrived|tripStarted|tripEnded}
GET  /v1/trips/{id}/fare                   -> computed fare breakdown
POST /v1/trips/{id}/payment/capture        -> triggers payment flow (see Payment
                                               System Design file for the
                                               idempotent-charge deep dive)
GET  /v1/pricing/surge?cell={h3Id}         -> current multiplier for a geo-cell
```

### Data Model

```
Driver (driver_id, status[online|on_trip|offline], vehicle_info, rating)
DriverLocation (driver_id, geohash/h3_cell, lat, lng, updated_at)
  -- kept in an in-memory geospatial index (e.g., Redis GEO or a custom
     H3-bucketed structure), NOT the durable driver table — this is a
     high-churn, ephemeral, latency-critical dataset, disjoint from
     Driver's durable profile data

RideRequest (request_id, rider_id, pickup, dropoff, status, matched_driver_id,
             requested_at, matched_at)

Trip (trip_id, request_id, driver_id, rider_id, route_polyline,
      started_at, ended_at, distance_km, duration_s, fare_cents, status)

SurgeCell (h3_cell_id, multiplier, computed_at)
  -- small, hot, read-heavy table/cache — one row per geo-cell, refreshed
     periodically from a supply/demand aggregation job
```

### High-Level Design

```
 Driver App ──(location ping, ~4s)──► Location Ingest Service
                                             │
                                             ▼
                                  Geospatial Index (in-memory,
                                  H3-bucketed, sharded by region)
                                             ▲
                                             │  nearest-driver query
 Rider App ──ride request──► Dispatch/Matching Service
                                    │              │
                                    ▼              ▼
                          Pricing Service    Maps/ETA Service
                          (surge lookup)     (routing engine)
                                    │
                                    ▼
                          Matched trip created ──► Trip Service
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                            ▼
                                 Notification Service          Payment Service
                                 (push to rider+driver)     (see Payment System
                                                              Design file)
```

**Request flow:**
1. Driver apps continuously stream location to the Location Ingest Service, which writes into a sharded, in-memory geospatial index keyed by H3 cell — this index is the hot path for every matching query and is deliberately kept separate from durable storage (losing a few seconds of stale location on a crash is acceptable; losing a trip/payment record is not).
2. Rider requests a ride → Dispatch/Matching Service queries the geospatial index for available drivers in expanding radius rings around pickup, filters by product type/rating, and runs a matching algorithm (often more sophisticated than "nearest" — batched matching over short windows can improve aggregate ETA and reduce cancellations, this is the subject of the dedicated Ride Sharing design file).
3. Pricing Service is consulted for the current surge multiplier of the pickup cell (a cheap read from a periodically-recomputed cache, not computed per-request).
4. Maps/ETA Service computes driver-to-pickup ETA and trip route/duration estimate (routing engine, typically a precomputed road-graph with contraction hierarchies for fast shortest-path — detailed in the dedicated design file).
5. On match, a Trip record is created; both apps are notified (push); the driver's live location continues streaming and is relayed to the rider's app for the "watch your driver approach" experience.
6. On trip completion, fare is finalized (distance/duration from actual route + surge multiplier applied at request time, not fluctuating mid-trip) and handed to the Payment Service for capture — **cross-reference: idempotent charge-capture, retry-safety, and payout mechanics are covered in full in the Payment System Design file; this platform view only needs to know that Trip completion is the trigger event for that flow.**

### Deep Dive

Because dispatch matching internals (candidate search radius expansion, batched vs. greedy matching,
driver-side accept/reject race conditions) and surge pricing internals (supply/demand ratio
computation, price smoothing to avoid driver gaming/whiplash) are both covered in full depth in the
dedicated **Ride Sharing System Design** file, the one hard sub-problem worth expanding here —
because it's specific to the *platform-composition* view rather than any single subsystem — is:

**Keeping the geospatial index consistent with trip state under high churn.** A driver's status flips between `online → matched → on_trip → online` many times per shift, and their location index entry must reflect the correct *availability*, not just position — a driver mid-trip must never be returned as a match candidate even if geographically close. This is solved by co-locating a lightweight status flag with the location entry itself (not requiring a join against the durable `Driver` table on every matching query, which would be far too slow at this QPS) and updating both atomically from the same event stream: the Trip Service publishes state-change events (matched, trip-started, trip-ended) that the Location Ingest layer subscribes to and applies directly to the in-memory index, so a single source of truth (the event log) drives two derived views (durable trip records, and the fast-path availability flag in the geo index) without requiring the matching hot path to ever query the slow durable store.

### Scaling the Design

- **Geospatial index**: sharded by region/H3-cell-prefix so that a matching query for downtown Chicago never touches a shard holding rural Montana — natural geographic partitioning.
- **Dispatch service**: stateless, horizontally scaled behind the geospatial index; scale-out is straightforward because matching decisions are localized to a small geo-radius.
- **Location ingest**: extremely high write volume (1M+/sec) — this tier is usually built on a fast in-memory store or a purpose-built time-series/geo store rather than a general relational DB, with old pings simply overwritten (no history needed for the hot path; historical trajectory for analytics is a separate, asynchronously-written pipeline).

### Failure Handling

- **Matching service instance crash mid-match**: request state is not held only in-process; a request that doesn't reach a terminal state within a timeout is automatically retried/reassigned by a watchdog, and driver "reservation holds" during matching expire quickly to avoid double-booking a driver to two riders.
- **Geospatial index shard failure**: replicated in-memory index (primary/replica per shard) with fast failover; brief staleness is preferable to unavailability, since a few seconds of slightly-stale driver positions rarely changes a matching outcome.
- **Payment capture failure post-trip**: never blocks the rider/driver from moving on — the platform view treats "trip completed" and "payment settled" as decoupled steps connected by a durable, retryable async job (idempotency keys, detailed in the Payment System Design file), so a payment processor outage delays settlement without stranding anyone mid-trip.

### Multi-Region Considerations

Ride-sharing is naturally **regionally partitioned by physical geography** — a trip in Tokyo has
zero interaction with dispatch state in São Paulo. This makes it one of the more forgiving multi-
region cases: each metro/region can run largely independent dispatch and pricing (active-active by
geography, not by replica of the same data), with only account/profile/payment-method data needing
global replication. The hard part is at region boundaries (a trip crossing a data-residency
boundary, or a rider traveling and opening the app in a new region) — handled by routing the request
to the region owning that geography rather than trying to replicate the entire live geospatial index
globally.

### Trade-offs

- **Greedy nearest-match vs. batched matching**: greedy is lower-latency per request but can produce worse aggregate outcomes (a driver assigned to a far rider when a closer rider arrives moments later); batching windows (e.g., 2-5s) improve aggregate efficiency at the cost of added per-request latency — full analysis in the Ride Sharing System Design file.
- **In-memory ephemeral location index vs. durable writes**: chosen for speed, accepting that a crash loses a few seconds of position data — acceptable because position is continuously re-reported, unlike a financial transaction.

---

## 4. Amazon-like E-Commerce Platform

*(Order orchestration state machines, inventory reservation/oversell prevention, and payment capture at checkout are covered in full depth in the dedicated **E-Commerce/Marketplace System Design** file — this section is the platform-composition view: how catalog, search, recommendations, and fulfillment tie together around that order core.)*

### Requirements

**Functional**
- Browse/search a catalog of hundreds of millions of products across many sellers.
- Personalized recommendations and search ranking.
- Cart, checkout, order placement (cross-reference: order state machine detailed elsewhere).
- Inventory visibility across multiple warehouses; fulfillment routing.
- Order tracking, returns.

**Non-functional**
- Search latency: p99 < 200ms for catalog search under huge query volume.
- Availability: catalog browse must stay up even if checkout backend has issues (browsing >> buying in traffic volume, and a search outage is more damaging than a temporarily degraded checkout).
- Consistency: inventory counts must prevent overselling (strong consistency needed at the reservation point) while catalog metadata can be eventually consistent (a stale price shown for 30s is a minor issue; an oversold item is a customer-trust and logistics problem).
- Scale: hundreds of millions of SKUs, billions of search queries/day, peak traffic multiples (e.g., Black Friday) of 5-10x baseline.

### Scale/Capacity Estimation

- 500M active SKUs across sellers; product metadata + images average ~50KB/SKU → ~25TB of catalog metadata (small compared to media, which lives in blob storage/CDN like the video platform's asset tier).
- 5 billion search queries/day → ~58K QPS average, 300-500K QPS at peak (flash sales, holiday) — this is a search-engine-scale problem (inverted index, sharded), not a simple SQL `LIKE` query.
- Peak order volume: a top-tier event might see 100K+ orders/minute at peak — inventory reservation must handle that write rate without overselling, which is why that path is deliberately narrow and separated from the much higher-volume, much more cacheable browse/search path.
- Recommendation surfaces (homepage, "customers also bought," post-purchase) are read at roughly the same order of magnitude as search — hundreds of thousands of QPS, served from precomputed/cached candidate sets, not live computation per request.

### API Design

```
GET  /v1/search?q=...&filters=...&page=...       -> ranked SKU results
GET  /v1/products/{skuId}                         -> catalog detail (cached heavily)
GET  /v1/products/{skuId}/availability             -> live-ish stock signal
GET  /v1/recommendations?surface=home|pdp|cart
POST /v1/cart/items                                -> add to cart
POST /v1/orders                                     -> place order (cross-reference:
                                                        full state machine in the
                                                        E-Commerce design file)
GET  /v1/orders/{id}/status
POST /v1/fulfillment/warehouses/{id}/pick-events    -> internal, warehouse system
                                                        integration
```

### Data Model

```
Product (sku_id PK, title, description, category, seller_id, price_cents,
         attributes JSON, image_refs[])
  -- read-heavy, eventually-consistent replica set is fine; this is what
     backs search/browse, NOT what inventory reservation reads

SearchIndex (external to the primary DB — an inverted index / document
  store, e.g. sharded Elasticsearch/Lucene-based, built via CDC from
  Product changes; this is a derived, denormalized view optimized for
  full-text + faceted filter queries, never queried-through to the
  source of truth)

InventoryLedger (sku_id, warehouse_id, quantity_available, quantity_reserved)
  -- the ONE place in the platform requiring strong consistency / row-level
     locking or a reservation queue — detailed in the E-Commerce design file

Order / OrderItem / Fulfillment  -- full schema and state machine in the
  dedicated E-Commerce/Marketplace design file (cross-referenced, not
  repeated here)

RecommendationCandidateSet (user_id or session_id, surface, candidate_skus[],
  generated_at)  -- precomputed offline/near-real-time, read at serve time,
  same two-stage funnel idea as the video platform's recommender
  (candidate generation + ranking), applied to purchase behavior instead
  of watch behavior
```

### High-Level Design

```
                     ┌────────────────────────┐
  User ──search────► │   Search Service          │──► Inverted Index
                     │  (query parse, facet,     │    (sharded, replicated)
                     │   ranking)                 │◄── CDC stream from Product DB
                     └────────────────────────┘
                              │
                              ▼
                     ┌────────────────────────┐
  User ──browse SKU─►│  Catalog Service (cached) │──► Product DB (read replicas)
                     └────────────────────────┘
                              │
                              ▼
                     ┌────────────────────────┐
                     │ Recommendation Service    │──► Candidate Store (precomputed)
                     └────────────────────────┘
                              │
  User ──checkout──►  Order Orchestration Service   (full detail: E-Commerce file)
                              │
                    ┌─────────┴──────────┐
                    ▼                     ▼
          Inventory Service        Payment Service
          (strong consistency,     (cross-ref: Payment
           reservation queue)       System Design file)
                    │
                    ▼
          Warehouse/Fulfillment Integration
          (routes order to nearest warehouse
           with stock, generates pick/pack/ship)
```

**Request flow (browse/search — the high-volume, read-optimized path):**
1. Search query hits the Search Service, which queries a sharded inverted index (built asynchronously via change-data-capture from the primary `Product` table — search never reads the primary DB directly, decoupling search availability/latency from catalog write load).
2. Results are ranked by a blend of text relevance, popularity/conversion signals, and (if personalized) a lightweight re-rank using the same candidate-generation-then-ranking funnel pattern used for recommendations.
3. Product detail pages are served from a heavily cached read path (CDN + application cache) since product metadata changes far less often than it's read — classic cache-aside with short TTL plus event-driven invalidation on price/stock-status changes.

**Request flow (order placement — the low-volume, consistency-critical path):**
1. Add-to-cart and checkout initiation hit Order Orchestration, which — before confirming the order — calls Inventory Service to atomically reserve stock (this is the one step in the whole platform that cannot be "eventually consistent," because overselling means a promise the business can't keep).
2. Payment is authorized/captured (cross-reference: Payment System Design file for the idempotent-charge mechanics).
3. On success, Order Orchestration hands off to Warehouse/Fulfillment integration, which selects the optimal warehouse (nearest with stock, considering shipping SLA) and emits a pick/pack/ship workflow to that warehouse's system — full order-state-machine detail lives in the E-Commerce/Marketplace design file, not repeated here.

### Deep Dive

The two hardest problems specific to the *platform-composition* view (as opposed to the
order/inventory internals already covered elsewhere) are:

**(a) Keeping Search/Catalog (eventually consistent, highly cached) from lying about Inventory (strongly consistent).** These two subsystems deliberately have different consistency models, which creates a real UX problem: search can show an item as "in stock" a few seconds after it actually sold out (CDC lag + cache TTL). The platform solves this by treating the search/catalog "in stock" flag as advisory only — it's good enough to decide whether to *show* a buy button, but the actual reservation always re-checks the authoritative Inventory Ledger at add-to-cart/checkout time. This is the standard pattern: optimize the 99% read path for speed with a slightly stale view, and push the correctness check to the much lower-volume write path where strong consistency is affordable. Trying to make the browse path strongly consistent with inventory would require every product-page view to hit the strongly-consistent store — that store would need to handle search-level QPS (hundreds of thousands/sec) instead of order-level QPS (orders of magnitude lower), which is both unnecessary and would make the inventory system itself the bottleneck for browsing.

**(b) Multi-warehouse fulfillment routing.** Given an order, which of N warehouses should ship it? This is a constrained optimization done at request time (must be fast, not offline-batch): candidates are filtered to warehouses with sufficient stock of *all* items in the order (to avoid split shipments where possible — split shipments cost more and delay delivery), then ranked by a combination of shipping distance/time-to-customer and current warehouse load (to avoid overloading one warehouse while others sit idle). This is conceptually the same "candidate filter, then rank" pattern seen in dispatch matching (Section 3) and recommendations (Sections 1, 4) — a recurring shape across many of these systems: narrow a large space cheaply, then apply a more expensive scoring function only to the small remaining candidate set.

### Scaling the Design

- **Search index**: sharded by document (SKU) ID range or by category, replicated for read scale; rebuilt/updated incrementally via CDC rather than full reindex, since full-catalog reindexing at this scale would be prohibitively slow and resource-intensive.
- **Catalog reads**: multi-layer caching (CDN for images/static detail, application-layer cache for structured data) — the read:write ratio on product data is extremely high, making this one of the most cache-friendly parts of the whole platform.
- **Inventory**: sharded by `(sku_id, warehouse_id)` so hot SKUs during a flash sale contend only on their own shard's reservation queue, not a global lock — full mechanics (reservation TTLs, oversell-prevention patterns) in the E-Commerce design file.
- **Recommendations**: precomputed candidate sets refreshed on a schedule (minutes to hours) rather than computed per-request, same trade-off as Section 1's recommender.

### Failure Handling

- **Search index degraded/stale**: catalog browse can fall back to a simpler (e.g., category-browse or cached-popular) experience rather than failing outright — search unavailability should never cascade into checkout unavailability, because these are architecturally decoupled services.
- **Inventory service under extreme load (flash sale)**: reservation requests queue rather than fail outright, with a fast, honest "high demand, please wait" UX rather than silently overselling under load — a queue-based load-leveling pattern.
- **Warehouse integration unreachable**: orders can still be accepted (payment captured, inventory reserved) with fulfillment routing retried asynchronously — decoupling order acceptance from fulfillment dispatch means a warehouse system outage delays shipment scheduling without blocking the customer-facing purchase flow.

### Multi-Region Considerations

Catalog and search are naturally globally replicable (read-mostly, eventually consistent) and
benefit from regional read replicas/CDN-fronted caches close to shoppers. Inventory and orders are
typically anchored to the region/warehouse network actually fulfilling the order (a US warehouse's
stock isn't relevant to an EU shopper), so this system tends toward **regional sharding by
fulfillment geography** for the write-heavy core, combined with **global active-active replication**
for the read-heavy catalog/search layer — a hybrid that's explored generally in Section 5.

### Trade-offs

- **Eventually-consistent catalog/search vs. strongly-consistent inventory**: deliberately different consistency models for different subsystems within the same platform — resist the urge to make everything uniformly strong or uniformly eventual; match consistency to the actual cost of being wrong in each subsystem.
- **Precomputed recommendations vs. real-time personalization**: precomputed is cheaper and scales better; sacrifices some responsiveness to very recent behavior (mitigated by lightweight online re-ranking using recent-session signals layered on top of the precomputed candidate set).

---

## 5. Multi-Region Architecture — Standalone Deep Dive

This section treats multi-region design as a topic in its own right, because interviewers
increasingly ask it independent of any specific product ("design this so it survives a region outage
with 99.99% availability") — you need the vocabulary and trade-off map even without a product
wrapper.

### Requirements

**Functional**
- Serve users from the region nearest them (latency).
- Survive the complete loss of any single region without customer-visible data loss beyond a defined RPO.
- Respect data residency law (e.g., EU user data must stay in EU) where applicable.

**Non-functional (the worked SLA target for this section)**
- 99.99% availability (≈52 minutes of downtime/year).
- p99 latency < 150ms for 90% of global users.
- RPO (recoverable point objective) near-zero for critical data (payments, orders); RTO (recovery time objective) under a few minutes for full regional failover.

### Scale/Capacity Estimation

- 99.99% availability means the system must survive a *full regional outage* without breaching SLA — a single-region architecture caps out around 99.9% (cloud provider region-level SLA) at best, structurally incapable of hitting 99.99% no matter how well-engineered the single region is. This number alone forces a multi-region requirement, independent of latency needs.
- 150ms p99 for 90% of users globally: speed-of-light round-trip alone between, say, US-East and Singapore is ~230ms one-way fiber-path minimum — meaning a single-origin architecture *cannot* hit this target for distant users no matter how fast the origin is. This forces **regional origins** (multiple active regions, each serving local users), not just a CDN in front of one origin — CDNs help with static/cacheable content but a personalized, dynamic API response still needs compute close to the user.
- A realistic deployment for global coverage: 3-5 regions (e.g., US-East, US-West or EU, EU-Central, APAC-Southeast, APAC-Northeast) chosen to keep every major user population within ~50-70ms of a region (bringing total round-trip including processing under the 150ms budget).

### API Design

Multi-region is infrastructure, not a product API — but two API-visible concerns matter:
```
All write APIs should be designed idempotent-by-default:
  POST /v1/orders  { idempotencyKey: "..." , ... }
  -- essential because cross-region retries (client retries against a
     different region after a timeout) must not double-apply

Read APIs should expose a consistency hint where it matters:
  GET /v1/account/balance?consistency=strong   -> routed to home region
  GET /v1/account/balance?consistency=eventual -> served from local region replica
```
Exposing a consistency knob (rather than hiding it) lets each caller decide whether it needs the
authoritative (slower, cross-region) answer or the fast local one — this mirrors the catalog-vs-
inventory split in Section 4, generalized as an explicit API contract.

### Data Model

Multi-region data modeling is really about **partitioning strategy** per dataset, not a single
schema:

```
Strategy 1 — Single-master per record, geo-routed writes ("data locality by owner")
  Account(account_id, home_region, ...)
  -- writes for an account always route to its home_region; reads can be
     served from any region's replica (eventual) or forced to home_region
     (strong). This is the dominant pattern for user-owned data (profile,
     cart, orders) — matches Section 2 (Drive) and Section 4 (orders).

Strategy 2 — Global active-active, conflict-resolved ("multi-master")
  used for data that must be writable from anywhere with low latency and
  can tolerate/resolve concurrent writes — e.g., a shopping cart, a
  collaborative counter, presence status. Requires CRDTs or
  application-level merge (see Deep Dive).

Strategy 3 — Regionally-scoped data, no cross-region replication needed
  e.g., session tokens, region-local caches, ephemeral location pings
  (Section 3) — deliberately NOT replicated globally because the data's
  usefulness doesn't outlive the region/session anyway.
```
The single biggest multi-region data-modeling mistake is applying one strategy to all data — real
systems mix all three per dataset, exactly as Sections 1-4 each did implicitly.

### High-Level Design

```
                         ┌─────────────────────┐
                         │   GeoDNS / Anycast     │
                         │  (routes user to        │
                         │   nearest healthy         │
                         │   region)                  │
                         └──────────┬──────────────┘
             ┌────────────────────┼────────────────────┐
             ▼                     ▼                     ▼
     ┌───────────────┐    ┌───────────────┐     ┌───────────────┐
     │  Region: US       │    │  Region: EU       │     │ Region: APAC      │
     │  (active)          │    │  (active)          │     │ (active)          │
     │  App tier          │    │  App tier          │     │ App tier          │
     │  Regional DB       │◄──►│  Regional DB       │◄───►│ Regional DB       │
     │  replica            │    │  replica            │     │ replica            │
     └───────────────┘    └───────────────┘     └───────────────┘
             ▲                     ▲                     ▲
             └──────────── Cross-region replication ─────┘
                     (async, per-dataset strategy — see Data Model)

    Global Health/Consensus layer (small, e.g. etcd/Spanner-like,
    used ONLY for cross-region coordination like leader election
    for single-master datasets, NOT for per-request traffic)
```

**Request flow:** GeoDNS or anycast IP routing sends each user to their nearest healthy region based on latency and health checks (never purely geographic — a region reporting degraded health is removed from routing candidates even if it's geographically closest). Within that region, the request is served by a full local stack (app tier, cache, regional DB replica) so that the common case never crosses a region boundary. Cross-region communication happens only for: (a) replicating writes asynchronously to other regions' replicas, (b) the rare strongly-consistent read/write that must reach a record's home region, and (c) global coordination (leader election, config) through a small, dedicated consensus layer — deliberately kept out of the per-request hot path, because consensus round-trips across regions are exactly the ~150-250ms latency the whole design is trying to avoid.

### Deep Dive

**(a) Active-Active vs. Active-Passive.**
- **Active-passive**: one region serves all traffic; a standby region replicates data but serves nothing until failover. Simpler (no multi-writer conflict problem at all) but wastes the standby's capacity, and failover has a non-zero RTO (DNS propagation, promoting the standby, verifying data currency) — often tens of seconds to minutes, which can be too slow for a 99.99% target if outages happen more than once a year (52 minutes/year budget is easily consumed by a couple of slow failovers).
- **Active-active**: all regions serve live traffic simultaneously. Better latency (users always hit a nearby active region, not just "nearest of one active + N cold standbys") and better failure tolerance (losing one region simply removes it from the routing pool, no failover procedure needed — the other regions were already serving traffic). The cost: you now have a genuine multi-writer consistency problem for any data writable from more than one region, which is the crux of part (b).
For the worked 99.99%/150ms SLA in this section: **active-active is effectively required**, because
active-passive's failover latency risk and the single-active-region's inability to be near every
global user both violate the stated targets independently.

**(b) Conflict Resolution Across Regions.** When the same logical record can be written in two regions before either write has propagated to the other, you need a merge strategy:
- **Last-Write-Wins (LWW)**: attach a timestamp (ideally a hybrid logical clock, not raw wall-clock, since wall clocks drift across regions) to every write; on conflict, the later timestamp wins, the other is discarded. Simple, but **silently loses data** — acceptable only when losing the losing write is truly harmless (e.g., "last viewed timestamp," a presence flag). Never acceptable for financial balances or anything a user would notice disappearing.
- **CRDTs (Conflict-free Replicated Data Types)**: data structures mathematically designed so that concurrent updates always converge to the same result regardless of arrival order, with no data loss — e.g., a G-Counter (grow-only counter, each region tracks its own increments, total = sum across regions) for something like a global like-count; an OR-Set (observed-remove set) for a shared collection where adds/removes from multiple regions need to merge safely. CRDTs are powerful but constrain you to specific data shapes (counters, sets, registers) — you can't CRDT-ify an arbitrary relational schema.
- **Application-level merge**: for anything CRDTs don't naturally fit (e.g., a shopping cart with quantities and applied discounts), write explicit merge logic at the application layer — e.g., "union the line items, sum quantities for duplicates, re-validate discount eligibility post-merge" — this is more work but is the only option once the data shape is genuinely domain-specific.
- **Avoid the conflict entirely (the actual most common real-world choice)**: route all writes for a given record to a single "home region" (Strategy 1 in Data Model) so no cross-region write conflict is even possible — reads can still be served locally everywhere (eventually consistent), and only the relatively rare write needs a cross-region hop to the home region. This sacrifices write latency for non-home-region users on that specific record but sidesteps the entire conflict-resolution problem, which is why most systems (including Sections 2-4 above) default to it and reserve true multi-master/CRDT machinery for the narrow slice of data (carts, counters, presence) where write-anywhere is worth the complexity.

**(c) Split-Brain Across Regions.** This is the failure mode where a network partition separates regions such that each side believes it's the sole authority and continues accepting writes for the *same* single-master record — e.g., a network partition between US and EU during which both regions' app tiers believe they're now the leader for an account whose home region logic got confused, and both accept conflicting writes. Consequences: silent data corruption or double-processing (e.g., an order or payment processed twice, once accepted by each "leader"). Mitigations:
- **Quorum-based leader election** for anything that must have exactly one writer (e.g., using Raft/Paxos-based consensus across regions, or a managed service like etcd) — a leader can only act while it holds a majority quorum; during a partition, at most one side can retain quorum (assuming an odd number of voting regions or an external tie-breaker), so the minority side correctly steps down rather than continuing to act as leader. This is why 3 or 5 regions (odd counts) are common for anything needing region-level consensus — an even split can't be resolved by majority alone.
- **Fencing tokens**: even with leader election, a "zombie" former leader might still have in-flight requests; attach a monotonically increasing fencing token to leadership terms so downstream systems (e.g., storage) can reject writes carrying a stale token, guaranteeing an old leader can't corrupt state even if it hasn't yet realized it lost leadership.
- **Idempotency as a backstop**: regardless of how well split-brain is prevented, idempotency keys on writes (Section 4/Payment System Design pattern) mean that even a duplicate-processed request is a no-op the second time, turning a potential double-charge into a harmless retry — defense in depth rather than relying on any single mechanism to be perfect.

**(d) Worked example against the stated SLA (99.99% availability, \<150ms p99 for 90% of global users).**
- Deploy 5 active regions positioned to cover major population centers within ~50-70ms (e.g., US-East, US-West, EU-West, APAC-Southeast, APAC-Northeast).
- GeoDNS/anycast with health-check-based routing (not pure geographic) — a region failing health checks is pulled from rotation within seconds, not minutes.
- Per-dataset strategy: user profile/account data uses home-region routing (Strategy 1) with async cross-region read replicas; shopping-cart-style ephemeral collaborative state uses CRDTs (Strategy 2); session/cache data is region-local only (Strategy 3).
- 99.99% (52 min/year) is achieved not by any single region being that reliable (no region needs to individually hit 99.99% — a single cloud region typically offers ~99.9% at best), but by the *fleet* of active regions meaning a single-region outage doesn't remove the *service* from availability, only that region's share of users, who are then routed to the next-nearest healthy region within the GeoDNS health-check interval (typically tens of seconds) — so the effective customer-facing availability is much higher than any one region's number, provided failover is truly automatic and requires no manual intervention.
- The \<150ms target for 90% of users is met structurally by regional placement (physics — speed of light — is the actual constraint, not server processing time); the remaining 10% (users far from any region, e.g., a user in a location without a nearby PoP) may exceed the target, which is why the SLA is worded "for 90% of users," not "for all users" — an honest, common way real SLAs are scoped.

### Scaling the Design

Scaling a multi-region architecture is less about adding regions (typically capped at a handful,
chosen deliberately for coverage) and more about scaling *within* each region using everything from
Sections 1-4 (sharding, caching, queues), plus scaling the cross-region replication pipes themselves
as data volume grows — this usually means partitioning replication streams per dataset/shard rather
than one monolithic cross-region link, so a burst in one dataset's write volume doesn't starve
replication for unrelated data.

### Failure Handling

Already covered in depth above (active-active failover, split-brain mitigation, fencing tokens,
idempotency backstop) — the general principle: **assume any single region can vanish at any time,
and design so that "vanish" is a routing-table update, not an incident.**

### Multi-Region Considerations

This section *is* the multi-region considerations — but one point applies universally across
Sections 1-4: **data residency law (e.g., GDPR) can override pure latency/availability
optimization.** If EU user data must legally stay within EU infrastructure, the "route to nearest
healthy region" rule gets constrained to "route to nearest healthy region *within the permitted
residency set*" — sometimes meaning an EU user cannot fail over to a US region even if it's
technically healthy and reachable, which can mean data-residency-constrained users have a *lower*
effective availability than the global number, a nuance worth stating explicitly in an interview
rather than glossing over.

### Trade-offs

- **Active-active complexity vs. active-passive simplicity**: active-active is usually necessary for tight SLAs like the one worked above, but it's the harder system to build correctly (conflict resolution, split-brain defenses) — don't default to it if a looser SLA (e.g., 99.9%, higher acceptable latency) is actually the real requirement; active-passive is legitimately simpler and sufficient for many systems.
- **Home-region write routing vs. true multi-master**: home-region routing sidesteps conflict resolution almost entirely and is the pragmatic default; reserve true multi-master/CRDT machinery for the specific datasets where write-anywhere latency genuinely matters to the product.
- **Residency compliance vs. uniform global architecture**: legal constraints can force asymmetric architecture (some regions can fail over freely, others can't) — this is a real-world wrinkle that a "clean" whiteboard design often omits, and naming it explicitly signals staff-level maturity in an interview.

---

## 6. Closing: The Framing Question, Revisited

Every design above reused the same small set of ideas, recombined: shard by the key that keeps hot
paths local; separate the hot/ephemeral path from the durable/authoritative path; make writes
idempotent; decouple through queues/events wherever a caller shouldn't wait; filter-then-rank when a
candidate space is too large to score exhaustively; match consistency strength to the actual cost of
being wrong, dataset by dataset, not uniformly. None of that is domain-specific to video, files,
rides, e-commerce, or geography — it is the same toolbox, assembled differently because each
system's *bottleneck* (egress bandwidth, sync bandwidth, matching latency, oversell risk, speed-of-
light latency) is different.

> **Can I combine the building blocks appropriately instead of memorizing architectures?** If you
can look at a new, unfamiliar system and correctly guess which of these five bottleneck-shapes it
resembles most — and which two or three primitives address that specific bottleneck — you've
answered yes.
