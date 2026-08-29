# Stage 5 (Part A) — HLD Mastery: Foundation & Read/Write Scale Designs
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **Framing question:** *Can I combine the building blocks appropriately instead of memorizing
architectures?* > > Every design below is built from the same small set of primitives you already
know — load balancers, stateless app servers, a KV store, a relational store, a queue, a cache,
consistent hashing, and CDN edge caching. The skill being tested at Staff level is not "do you know
the Twitter architecture," it's "given fresh requirements, do you pick the right primitive, size it
with real numbers, and reason about what breaks first." Read each design asking: *which of my
building blocks did they reach for, and why not the other one?*

## Table of Contents

**Level 1 — Foundation Designs**
1. [URL Shortener](#1-url-shortener)
2. [Pastebin](#2-pastebin)
3. [Rate Limiter (Distributed Service)](#3-rate-limiter-distributed-service)
4. [File Storage (Simplified Dropbox)](#4-file-storage-simplified-dropbox)

**Level 2 — Read/Write Scale Designs**
5. [News Feed (Fan-out Trade-offs)](#5-news-feed)
6. [Search Autocomplete / Typeahead](#6-search-autocomplete--typeahead)
7. [Distributed Cache (Building Redis, Not Using It)](#7-distributed-cache)
8. [Metrics System (Datadog/Prometheus-style)](#8-metrics-system)

---

## 1. URL Shortener

### Requirements

**Functional**
- Given a long URL, return a short alias (e.g. `sho.rt/aZ9kLm`).
- Redirect a short alias to the original URL (HTTP 301/302).
- Optional: user-specified custom aliases, expiration dates, click analytics.

**Non-functional**
- Read-heavy: redirects vastly outnumber creations (~100:1 typical).
- Redirect latency should be \<100ms p99 — it's on the critical path of someone's click.
- High availability for redirects (a dead shortener breaks every link that ever used it) — some staleness on analytics is fine.
- Aliases must not collide; system should not be guessable/enumerable easily (avoid sequential IDs exposed raw).

### Scale/Capacity Estimation

- Assume 100M new URLs/month → ~40 URLs/sec average write, ~400/sec peak.
- Read:write ratio 100:1 → ~4,000 redirects/sec average, ~40,000/sec peak (still cheap for a cache-fronted system).
- Storage per record: long URL (avg 100 bytes) + short code (7 bytes) + metadata (created_at, user_id, expiry ~30 bytes) ≈ 150 bytes.
- 5-year retention: 100M/month × 60 months = 6B URLs × 150 bytes ≈ **900 GB** of primary data — fits comfortably on a sharded relational or KV store, no exotic storage needed.
- Short code space: base62 (a-z, A-Z, 0-9), 7 characters → 62^7 ≈ 3.5 trillion combinations — vastly more than 6B needed, plenty of headroom.

### API Design

```
POST /api/v1/shorten
  Body: { "long_url": "https://...", "custom_alias": "optional", "expires_at": "optional" }
  Response: { "short_url": "https://sho.rt/aZ9kLm" }
  Status: 201 Created, 409 Conflict (alias taken), 400 Bad Request (invalid URL)

GET /{short_code}
  Response: 301 Moved Permanently, Location: <long_url>
  (302 if you want to preserve ability to change destination / track every click via analytics pipeline)

DELETE /api/v1/urls/{short_code}   (auth required, owner only)

GET /api/v1/urls/{short_code}/stats
  Response: { "clicks": 1234, "created_at": ..., "last_accessed": ... }
```

### Data Model

Primary table (sharded key-value semantics; a relational store works fine at this scale):

```
urls
  short_code   VARCHAR(7)  PRIMARY KEY
  long_url     TEXT        NOT NULL
  user_id      BIGINT      NULL (index)
  created_at   TIMESTAMP
  expires_at   TIMESTAMP   NULL
  click_count  BIGINT      (denormalized, eventually consistent)
```

**Choice of DB:** A KV store (DynamoDB / Cassandra) is the natural fit — access pattern is 100% point-lookup by primary key, no joins, no range queries needed. A relational DB (Postgres) also works fine at this scale and is simpler to operate; pick it if the team doesn't already run a KV store operationally. Reject a graph DB or search index outright — no relationship or full-text need exists here.

### High-Level Design

```
                    ┌─────────────┐
   Client ────────▶ │Load Balancer│
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
      ┌───────────────┐        ┌───────────────┐
      │ App Server(s)  │  ...   │ App Server(s)  │   (stateless, horizontally scaled)
      └───────┬───────┘        └───────┬───────┘
              │                        │
      ┌───────┴─────────┐      ┌───────┴────────┐
      │  Redis Cache      │      │  Async Click    │
      │ (short_code→URL)  │      │  Logger → Queue │──▶ Analytics DB (append-only)
      └───────┬───────────┘      └────────────────┘
              │ (cache miss)
              ▼
      ┌────────────────┐
      │  Sharded DB /    │
      │  KV Store         │
      └────────────────┘

      ┌────────────────┐
      │ ID Generation    │  (Snowflake-style or pre-allocated
      │ Service           │   range of counters per app server)
      └────────────────┘
```

**Write path:** Client POSTs long URL → app server requests a unique ID from the ID generation service → encodes ID as base62 → writes `{short_code, long_url}` to DB → returns short URL. Custom aliases skip ID generation and do a conditional-write (`INSERT ... IF NOT EXISTS`) to catch collisions.

**Read path (the hot path):** Client hits `GET /{short_code}` → app server checks Redis cache first → on hit, returns 301 in \<10ms → on miss, reads from DB, populates cache with TTL, returns 301. Click event is fired asynchronously onto a queue (Kafka/SQS) so it never blocks the redirect — analytics consumer aggregates click counts in the background.

### Deep Dive: ID Generation / Encoding Strategy

This is the one genuinely interesting sub-problem. Two competing approaches:

**Approach A — Hash the long URL** (MD5/SHA256, truncate to 7 base62 chars). Problem: collisions on truncated hashes are real at billions of scale (birthday paradox), and different users shortening the same URL either collide or you allow duplicates — you need a collision-check-and-retry loop on every write, adding latency variance.

**Approach B — Counter-based unique ID → base62 encode** (the industry-standard answer). A central counter (or Snowflake-style: timestamp + machine ID + sequence) hands out monotonically increasing 64-bit IDs with zero collision possibility by construction. Encode the integer in base62:

```
def encode(num):
    chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if num == 0: return chars[0]
    s = []
    while num:
        num, rem = divmod(num, 62)
        s.append(chars[rem])
    return ''.join(reversed(s))
```

To avoid a single counter becoming a bottleneck/SPOF, pre-allocate **ranges** to each app server
(e.g., server claims IDs [1,000,000–1,999,999] from a coordination service like Zookeeper/DynamoDB
with a conditional increment), and hands them out locally without a network round-trip per request.
This is the same pattern as Twitter Snowflake / Instagram's ID generation — memorize the *pattern*
(range-lease + local counter), not any one company's exact bit layout.

Trade-off to state explicitly in an interview: sequential IDs are guessable (enumerable short URLs
leak how many URLs exist and let scraping). Mitigate by XOR-ing the counter with a fixed secret or
shuffling bits before base62 encoding — cheap obfuscation, not real security, and worth saying so.

### Scaling the Design

- **First bottleneck:** DB write throughput if growth spikes — mitigated by sharding the URL table by `short_code` prefix or hash, since access is always by primary key (no cross-shard queries needed).
- **Second bottleneck:** cache capacity — with 900GB of data and a Zipfian access pattern (a small fraction of URLs get most clicks), a cache sized to hold the hot 10-20% (~100-200M entries, ~15-30GB) yields a >95% hit ratio. Use LRU eviction.
- Read traffic scales horizontally trivially — stateless app servers + cache behind a load balancer, add more replicas.
- Geo-distribute: put a CDN/edge cache in front for redirects (301s are cacheable!) to shave cross-region latency — this is one of the few systems where CDN edge caching applies to a "dynamic" API because the response barely changes.

### Failure Handling

- **App server dies:** load balancer health check evicts it; stateless, no data loss, in-flight requests retried by client/LB.
- **Cache node dies:** requests fall through to DB (cache-aside pattern) — latency spike, not an outage. Rebuild cache from DB naturally as traffic flows.
- **DB primary dies:** promote a read replica (async replication, seconds of failover, small window of potential last-write loss on the newest URLs — acceptable given non-critical writes). Reads continue to be served from other replicas/cache during failover.
- **ID generation service dies:** if range-based, app servers already holding an unexhausted range keep working with zero disruption; only new range requests block, so a brief outage doesn't halt creation service-wide.
- **Queue for click analytics backs up:** clicks (redirects) are unaffected since queue write is fire-and-forget; analytics dashboards just lag — an acceptable, explicitly non-critical degradation.

### Trade-offs

| Decision | Alternative Considered | Why Rejected |
|---|---|---|
| Counter + base62 | Hash-based short codes | Collision handling adds retry latency & complexity at scale |
| KV/relational store | Graph DB | No relationship queries exist in this domain |
| 301 redirect | 302 redirect | 301 is cacheable by browsers/CDNs, better latency; use 302 only if you need per-click analytics guarantees over cache-friendliness |
| Async click logging | Synchronous click count update | Would add write load and latency to the hot redirect path for a non-critical feature |
| Range-leased ID generation | Single global counter (e.g. a DB auto-increment) | Global counter is a write bottleneck and SPOF at 40K+ writes/sec peak |

---

## 2. Pastebin

### Requirements

**Functional**
- Users submit a text blob, get back a shareable URL.
- Support optional expiration (burn-after-read, 1 day, 1 week, never).
- Support syntax highlighting hints (language tag), optional password protection, public/private visibility.

**Non-functional**
- Read-heavy but less skewed than URL shortener (pastes are shared once, read a handful of times, then forgotten — long tail, not hot-key heavy).
- Content can be large (up to a few MB) — unlike URL shortener, payload size actually matters for storage/DB choice.
- Durability of content matters more than for a URL redirect — losing a paste is losing the user's actual data, not just a pointer.

### Scale/Capacity Estimation

- Assume 1M new pastes/day → ~12 writes/sec avg, ~120/sec peak.
- Avg paste size: 10KB (code snippets); max allowed: 1MB.
- Daily storage: 1M × 10KB = 10GB/day → **~3.6TB/year** — this is real blob storage, not "just add a text column."
- Reads: each paste read ~10 times on average over its life → ~120 reads/sec avg.
- Metadata (paste_id, owner, created_at, expiry, language) is tiny (~200 bytes/paste) — cheap to keep in a fast DB even as blob content goes elsewhere.

### API Design

```
POST /api/v1/pastes
  Body: { "content": "...", "language": "python", "expiry": "1d", "visibility": "public|private|unlisted", "password": "optional" }
  Response: { "paste_id": "xk92Lp", "url": "https://paste.io/xk92Lp" }

GET /api/v1/pastes/{paste_id}
  Response: { "content": "...", "language": "python", "created_at": ..., "views": 42 }
  Status: 404 (not found/expired), 401 (password required), 410 Gone (burn-after-read, already consumed)

DELETE /api/v1/pastes/{paste_id}   (owner only)
```

### Data Model

**Split storage — this is the key design decision.** Metadata in a fast indexed DB, content blob in object storage (S3-like), because the access patterns and sizes differ wildly:

```
paste_metadata (Postgres / DynamoDB)
  paste_id      VARCHAR(8)  PRIMARY KEY
  blob_key      VARCHAR      -- pointer into object storage, e.g. s3://pastes/xk/92/xk92Lp
  owner_id      BIGINT NULL
  language      VARCHAR(20)
  visibility    ENUM(public, private, unlisted)
  password_hash VARCHAR NULL
  created_at    TIMESTAMP
  expires_at    TIMESTAMP NULL
  burn_after_read BOOLEAN
  view_count    BIGINT

Object storage (S3/GCS/Blob Store)
  key: hierarchical prefix from paste_id (e.g. xk/92/xk92Lp.txt) to avoid hot partitions
  value: raw paste content, optionally gzip-compressed
```

**Why not put content directly in Postgres?** A 1MB text blob in a relational row bloats the buffer pool, kills cache efficiency for metadata queries, and blob storage (S3) is 10-20x cheaper per GB and built exactly for this "write once, read occasionally, immutable" access pattern. This split — hot metadata in a DB, cold/large payloads in blob storage with a pointer — is a pattern to reuse across many designs (also shows up in File Storage below).

### High-Level Design

```
Client ──▶ Load Balancer ──▶ App Servers (stateless)
                                  │
                    ┌─────────────┼─────────────────┐
                    ▼             ▼                 ▼
              Metadata DB    Object Storage     Redis Cache
              (Postgres)     (S3, content)      (hot pastes' content
                                                  + metadata)
                    │
                    ▼
            Background Job: expiry sweeper
            (deletes expired blobs + metadata rows)
```

**Write path:** App server validates size/content → uploads blob to object storage under key derived from paste_id → writes metadata row pointing to that key → returns shareable URL. Content is written to durable blob storage *before* the metadata row commits, so a metadata row never points to a missing blob.

**Read path:** App server reads metadata (cache-aside on Redis) → if `burn_after_read`, delete after serving (must be atomic — see Deep Dive) → fetch blob from object storage (or cache if hot) → return content + render hints.

### Deep Dive: Burn-After-Read Correctness Under Concurrency

The interesting problem: if two requests hit the same burn-after-read paste simultaneously (double-
click, retry, or a scraper race), only one should get the content — this is a classic "at-most-once
delivery" problem that naive read-then-delete code gets wrong.

**Wrong approach:** `GET content; DELETE row` — race window lets both requests see the content before either deletes.

**Correct approach:** Use an atomic conditional delete/read as a single operation:
```sql
UPDATE paste_metadata
SET consumed = TRUE
WHERE paste_id = ? AND consumed = FALSE
RETURNING blob_key;
```
This is an atomic compare-and-swap at the DB layer — exactly one concurrent request gets a non-empty
`RETURNING` result; every other concurrent request gets zero rows back and returns 410 Gone. Only
the winner fetches and returns the blob content, then deletes it from object storage. This pattern
(atomic UPDATE...RETURNING as a distributed lock/claim) generalizes to any "exactly one consumer"
problem — job queues, ticket reservation, etc.

### Scaling the Design

- **First bottleneck:** metadata DB write throughput at high paste-creation rates — mitigate by sharding metadata by `paste_id` hash; access is always point-lookup, so sharding is clean.
- **Object storage** scales natively (S3-style stores are designed for this) — not a concern until you're at truly massive scale, and even then it's the provider's problem, not yours.
- **Hot pastes** (a viral snippet shared widely) — cache the blob content itself in Redis/CDN with a short TTL, not just metadata, since re-fetching a 1MB blob from S3 on every read adds latency and cost.
- Expiry sweep should be a background batch job (scan `expires_at < now()`, delete in batches), not synchronous per-request checking of every paste ever created.

### Failure Handling

- **Object storage unavailable:** metadata reads still succeed (served from cache/DB), but content fetch fails — return 503 for that specific paste rather than failing the whole service; most storage providers offer >99.9% single-region availability, so this is rare and short-lived.
- **Metadata DB down:** total outage for creates/reads since it's the source of truth for existence/permissions — this is why metadata DB should be replicated (primary + read replicas) even though it's "just metadata."
- **Write of blob succeeds, metadata write fails:** orphaned blob in storage — acceptable garbage (cheap to store, cleaned by a periodic orphan-sweep job comparing storage keys against metadata rows). Never allow the reverse order (metadata before blob) since that produces broken links.

### Trade-offs

| Decision | Alternative | Why Rejected |
|---|---|---|
| Split metadata/blob storage | Single relational table with TEXT/BLOB column | Poor cache efficiency, expensive storage, doesn't scale past small content sizes |
| Object storage for content | Distributed filesystem (HDFS) | Massive operational overhead for a problem S3-class storage already solves |
| Atomic UPDATE...RETURNING for burn-after-read | Redis distributed lock | Adds an extra system dependency for a guarantee the DB already gives you transactionally |
| Async expiry sweeper | TTL-based auto-delete in DB only | Object storage blob still needs explicit cleanup; DB TTL alone leaves orphaned blobs |

---

## 3. Rate Limiter (Distributed Service)

### Requirements

**Functional**
- Given `(client_id, resource)`, decide ALLOW or DENY for each incoming request against a configured limit (e.g., 100 req/min per API key).
- Support multiple algorithms/policies per client tier (free vs paid).
- Return standard rate-limit headers (`X-RateLimit-Remaining`, `Retry-After`).

**Non-functional**
- Must not become the bottleneck it's protecting against — decision latency needs to be low single-digit ms, since it sits in front of every request.
- Must work correctly across many stateless app servers checking the *same* client's counter concurrently (this is the whole distributed-systems challenge here — a per-process in-memory counter is trivial and wrong).
- Approximate correctness is fine (rate limiting doesn't need to be perfectly precise) but should avoid wildly over/under-admitting under load.

### Scale/Capacity Estimation

- Assume this is a shared limiter fronting 50,000 req/sec across all API traffic.
- Every request needs a limiter check → limiter itself must handle 50K decisions/sec, each ideally \<5ms.
- Number of distinct rate-limit keys (unique client_id+resource pairs): assume 1M active clients × ~5 resources = 5M keys.
- Each key's counter state: ~50-100 bytes (count + window timestamp, or a small sliding log). 5M × 100 bytes = **500MB** — comfortably fits in a single Redis instance's memory, though sharded for HA/throughput.

### API Design

This is typically an internal library/sidecar, not a public REST API, but exposing it as a service:

```
POST /internal/v1/check
  Body: { "client_id": "abc123", "resource": "POST /orders", "cost": 1 }
  Response: { "allowed": true, "remaining": 42, "reset_at": 1699999999 }
  Latency budget: <5ms p99 (called synchronously in the request path of every API call)

PUT /internal/v1/policies/{client_tier}
  Body: { "limit": 1000, "window_seconds": 60, "algorithm": "sliding_window" }
  (admin-only, config management)
```

In practice, most systems implement this as a **library embedded in each app server** that talks to
a shared Redis, or as a **sidecar** (Envoy rate-limit filter pattern) — not a separate hop-heavy
microservice, precisely because latency budget is so tight.

### Data Model

Redis is the obvious and correct choice here — not a relational DB. Why: rate limiting needs atomic
increment-and-check operations at extremely high throughput with sub-millisecond latency, and the
data (counters) is inherently ephemeral/TTL-based. A relational DB would need row-locking for
atomicity under concurrent writers to the same row — that's exactly the throughput profile Redis is
built for and Postgres is not.

```
Redis key: ratelimit:{client_id}:{resource}:{window_bucket}
Value: integer counter (INCR) or a sorted set (for sliding-window-log)
TTL: set to window length so keys self-expire, no manual cleanup needed
```

### High-Level Design

```
                     ┌────────────────────┐
   Incoming Request─▶│  API Gateway /      │
                      │  Rate Limit Sidecar  │
                      └─────────┬───────────┘
                                │  check(client_id, resource)
                                ▼
                     ┌────────────────────┐
                     │  Rate Limiter Logic  │  (embedded lib or thin service)
                     │  - pick algorithm    │
                     │  - Lua script exec    │
                     └─────────┬───────────┘
                                ▼
                     ┌────────────────────┐
                     │  Redis Cluster        │  (sharded by client_id hash,
                     │  (counters, sorted    │   replicated for HA)
                     │   sets per key)        │
                     └────────────────────┘
                                │
                                ▼ (async, non-blocking)
                     ┌────────────────────┐
                     │  Policy Config Store  │ (which limits apply to which
                     │  (Postgres, small,     │  client tier — read-through
                     │   cached locally)      │  cached in each app server)
                     └────────────────────┘
```

**Request flow:** Request arrives at gateway → gateway calls rate limiter with `(client_id, resource)` → limiter looks up the client's policy (cached locally, refreshed every ~30s from the config store — avoids a DB hit per request) → executes an atomic check-and-increment against Redis → returns ALLOW/DENY within the same round trip → gateway either forwards the request or returns 429 immediately.

### Deep Dive: Algorithm Choice + Atomicity Under Concurrency

**Algorithm comparison** (the classic interview centerpiece):

- **Fixed window counter:** `INCR key; if count > limit: deny`, key expires at window boundary. Simple, O(1) memory, but has a boundary-burst problem — a client can send `limit` requests at 0:59 and another `limit` at 1:01, getting 2x limit in a 2-second span.
- **Sliding window log:** store a timestamp per request in a sorted set, count entries within the last N seconds, evict old ones. Perfectly accurate, but memory scales with request volume per client (bad for high-QPS clients).
- **Sliding window counter (weighted average of current + previous fixed window):** approximates sliding log with fixed-window's O(1) memory — this is the industry-standard sweet spot and what most production rate limiters (including Cloudflare's public write-up) actually use.
- **Token bucket:** allows bursts up to bucket size while enforcing average rate — best fit when bursty-but-bounded traffic is legitimate (e.g., a client that batches). Requires storing `(tokens, last_refill_time)` and computing refill lazily on each check.

**Pick token bucket or sliding-window-counter** for most APIs; state the trade-off explicitly (fixed window is simplest but boundary-bursts; sliding log is exact but memory-heavy; sliding-window-counter/token-bucket balance both).

**The atomicity problem:** with many app servers hitting the same Redis key concurrently, a naive `GET; check; INCR` from the app-server side is a classic read-modify-write race — two servers could both read count=99 (limit 100), both decide "allow," both increment, and the client gets through at 101. The fix: push the whole check-and-increment into a **single Redis Lua script** (`EVAL`), which Redis executes atomically (single-threaded execution model guarantees no interleaving):

```lua
-- token bucket refill + consume, atomic
local tokens_key = KEYS[1]
local timestamp_key = KEYS[2]
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local last_tokens = tonumber(redis.call("get", tokens_key)) or capacity
local last_refreshed = tonumber(redis.call("get", timestamp_key)) or now
local delta = math.max(0, now - last_refreshed)
local filled = math.min(capacity, last_tokens + (delta * rate))
local allowed = filled >= requested
local new_tokens = filled
if allowed then new_tokens = filled - requested end

redis.call("setex", tokens_key, 3600, new_tokens)
redis.call("setex", timestamp_key, 3600, now)
return allowed and 1 or 0
```
This single round-trip, atomic-on-the-Redis-side approach is *the* pattern to know cold for this
design — it's what separates a correct answer from a hand-wavy one.

### Scaling the Design

- **First bottleneck:** a single Redis instance's throughput ceiling (~100K ops/sec for simple ops, less for Lua scripts). Shard Redis by `hash(client_id) % N` so each client's counters live on one shard — no cross-shard coordination needed since rate limits are always per-client.
- **Hot clients** (one client_id generating disproportionate traffic) create a hot shard — mitigate with local, short-lived in-process caching of "definitely allowed" decisions for a few ms, or client-side pre-throttling via SDKs.
- At extreme scale, consider **local approximate rate limiting**: each app server keeps a local counter and only syncs with Redis periodically (e.g., every 100 requests or 100ms), trading precision for throughput — acceptable since rate limiting is inherently approximate.

### Failure Handling

- **Redis shard down:** fail open or fail closed is a real product decision — most systems **fail open** (allow requests) for availability, since a false-negative (missed rate limit) is usually less damaging than blocking all legitimate traffic during a Redis blip. State this trade-off explicitly in the interview — it signals product judgment.
- **Config store down:** app servers use their last-cached policy (refreshed every ~30s) — stale policy is fine, no policy is not.
- **Network partition between gateway and Redis:** timeout the Redis call fast (e.g., 10ms) and fail open rather than hang the whole request pipeline waiting on a rate-limit check.

### Trade-offs

| Decision | Alternative | Why Rejected |
|---|---|---|
| Redis + Lua atomic script | App-level GET/INCR | Race condition under concurrent app servers |
| Token bucket / sliding-window-counter | Fixed window | Boundary-burst allows 2x limit at window edges |
| Fail open on Redis failure | Fail closed | Blocking all traffic during infra blip is usually worse than temporarily lenient limits |
| Sharded Redis by client_id | Single Redis instance | Throughput ceiling at high global QPS |
| Sidecar/embedded library | Separate rate-limit microservice with network hop | Added latency directly in critical path for every single request |

---

## 4. File Storage (Simplified Dropbox)

### Requirements

**Functional**
- Upload/download files, organize into folders, share files/folders with other users (read or read-write).
- Sync across multiple devices — client should only transfer changed bytes, not whole files.
- Version history (restore a previous version).

**Non-functional**
- Durability of file data is paramount — "we lost your files" is an existential failure, not a degraded experience.
- Large files (up to several GB) must upload/download without saturating a single server or being an all-or-nothing atomic transfer.
- Strong consistency for metadata (folder structure, permissions) is important; file *content* replication can be eventually consistent across regions.

### Scale/Capacity Estimation

- Assume 50M users, avg 5GB stored each → **250PB** total storage — this alone rules out storing raw bytes in any traditional DB; must be blob/object storage + chunking.
- Assume avg file size 1MB, but supports up to 10GB files → chunking is mandatory (can't upload a 10GB file as one blob reliably over flaky networks).
- Chunk size: 4MB (industry-standard-ish, balances per-chunk overhead vs. resumability granularity).
- Daily active uploads: 10M users upload ~3 files/day avg = 30M file operations/day ≈ 350/sec avg, bursty to 3,500/sec peak.
- Metadata volume: 50M users × ~1,000 files avg = 50B file/folder metadata records × ~500 bytes ≈ **25TB of metadata** — needs a sharded, indexed store, not a single Postgres instance.

### API Design

```
POST /api/v1/files/upload/initiate
  Body: { "filename": "report.pdf", "size": 52428800, "folder_id": "..." }
  Response: { "upload_id": "u123", "chunk_size": 4194304, "chunks_needed": 13 }

PUT /api/v1/files/upload/{upload_id}/chunk/{chunk_index}
  Body: <binary chunk data>, Header: Content-MD5 for integrity check
  Response: { "chunk_index": 3, "status": "received" }

POST /api/v1/files/upload/{upload_id}/complete
  Response: { "file_id": "f456", "version": 1 }

GET /api/v1/files/{file_id}/download
  Response: 302 redirect to a pre-signed object-storage URL (client downloads directly, bypassing app servers)

GET /api/v1/files/{file_id}/versions
POST /api/v1/files/{file_id}/share  { "user_id": ..., "permission": "read|write" }
GET /api/v1/folders/{folder_id}/children   (list contents)
GET /api/v1/sync/changes?since_cursor=...   (delta sync — what changed since last check)
```

### Data Model

Same split-storage principle as Pastebin, at much larger scale, plus content-addressable
deduplication:

```
files (metadata DB — sharded relational or wide-column store)
  file_id       UUID PRIMARY KEY
  owner_id      BIGINT (index)
  folder_id     UUID (index)
  filename      VARCHAR
  size          BIGINT
  current_version INT
  created_at, updated_at TIMESTAMP

file_versions
  file_id       UUID
  version       INT
  chunk_manifest JSONB   -- ordered list of chunk_hash references
  created_at    TIMESTAMP
  PRIMARY KEY (file_id, version)

chunks (content-addressable — deduplicated globally)
  chunk_hash    VARCHAR(64) PRIMARY KEY  -- SHA-256 of chunk content
  storage_key   VARCHAR                   -- pointer into object storage
  ref_count     INT                        -- how many files reference this chunk
  size          INT

folders
  folder_id, parent_folder_id, owner_id, name

permissions
  resource_id, user_id, permission_level
```

**Choice of DB:** Metadata in a sharded relational store (shard by `owner_id` — most queries are "list my files/folders," naturally co-locating a user's data) or a wide-column store like Cassandra if write throughput dominates. Raw chunk bytes go to object storage (S3-class), addressed by content hash — this is what makes deduplication essentially free: two users uploading the identical file produce the same chunk hashes, so the second upload just increments `ref_count` instead of storing bytes again.

### High-Level Design

```
Client (chunks file locally, hashes each chunk)
   │
   ▼
Load Balancer ──▶ App Servers (stateless, orchestrate upload/download)
   │                     │
   │           ┌─────────┼──────────────┐
   │           ▼         ▼              ▼
   │     Metadata DB   Chunk Index    Notification Service
   │     (files,       (hash→location, │  (push "file changed" to
   │      versions,     dedup refcount) │   other logged-in devices)
   │      folders)            │
   │                          ▼
   │                  Object Storage (S3-class)
   │                  — actual chunk bytes, replicated
   │                     across AZs/regions
   ▼
Direct upload/download to Object Storage via pre-signed URLs
(bypasses app servers for the actual bytes — critical for scale)
```

**Upload flow:** Client chunks the file (4MB pieces), computes SHA-256 per chunk → calls `initiate` → app server returns pre-signed upload URLs per chunk (or per-chunk existence check: "I already have chunk hash X, skip it" — this is the dedup win) → client uploads only *new* chunks directly to object storage, bypassing app servers entirely → client calls `complete` → app server writes the version's chunk manifest to metadata DB and fans out change notifications to the user's other devices.

**Download/sync flow:** Client polls or holds a long-lived connection for `/sync/changes` → server returns a cursor-based delta of what changed → client fetches only new/changed chunks, reassembles locally.

### Deep Dive: Chunking + Delta Sync, and Deduplication

**Why chunk at all?** Three reasons converge: (1) resumable uploads — if chunk 8 of 13 fails, retry only chunk 8, not the whole 10GB file; (2) parallel upload — multiple chunks can transfer concurrently over different connections; (3) deduplication granularity — if a user edits one paragraph of a large doc, only the chunks covering that region change, not the whole file's chunk set (this is why fixed-size chunking is actually suboptimal for edited files — production systems like Dropbox use **content-defined chunking**, e.g. a rolling hash (Rabin fingerprint) that finds chunk boundaries based on content patterns rather than fixed byte offsets, so a small edit shifts only the chunks near the edit rather than every chunk after the edit point due to a byte-offset shift. Worth naming this even if you don't implement it — it shows depth).

**Deduplication mechanics:** Each chunk is content-addressed by SHA-256. Before uploading a chunk, the client sends its hash; the server checks the global `chunks` table — if the hash exists, it just increments `ref_count` and skips the actual byte transfer. This is enormously effective in practice (common files, OS binaries, shared documents are uploaded by thousands of users but stored once). Deleting a file decrements `ref_count` on its chunks; a chunk's bytes are only actually deleted from object storage when `ref_count` hits zero (garbage collected asynchronously, not synchronously on delete, to avoid a slow delete path and to tolerate races with concurrent uploads referencing the same chunk).

**Delta sync for multi-device consistency:** rather than each client polling "give me everything," the server maintains a monotonic per-user change cursor (could be a Lamport-style sequence number or a timestamp+tiebreaker). `/sync/changes?since_cursor=X` returns only the operations since that cursor — new/modified/deleted files, at the file-metadata level, so a lightweight mobile client isn't re-downloading full manifests every sync.

### Scaling the Design

- **First bottleneck:** app servers acting as a proxy for actual byte transfer — fixed by using pre-signed URLs so clients talk directly to object storage; app servers only orchestrate metadata, never touch raw bytes.
- **Metadata DB hot users** (a user with 100K files) — shard by `owner_id`, and within a very large account, further partition by folder or file creation time range.
- **Chunk index** (hash → location + ref_count) is itself a very large KV store (billions of entries) — shard by hash prefix, this is a clean, uniformly-distributed key space so sharding is trivial.
- Object storage scaling is the provider's problem (S3-class stores scale near-infinitely) — your job is just choosing good key prefixes to avoid provider-side hot partitions.

### Failure Handling

- **Chunk upload fails mid-transfer:** client retries just that chunk (idempotent — same chunk hash, same pre-signed URL slot); no partial-file corruption possible since the file isn't "complete" until all chunks are confirmed and the manifest is committed.
- **Metadata DB shard down:** affected users' file listings are unavailable, but already-synced local copies keep working offline — a fully offline-first client design (write locally, sync when reachable) is core to good UX here, not just a failure-handling afterthought.
- **Object storage region outage:** cross-region replication of chunks (async) means a secondary region can serve reads with a small replication-lag risk on the very newest uploads.
- **Notification service down:** other devices simply don't get a real-time "file changed" push; they still converge via periodic polling `/sync/changes` — graceful degradation, not an outage.

### Trade-offs

| Decision | Alternative | Why Rejected |
|---|---|---|
| Client uploads directly to object storage via pre-signed URL | Client uploads through app server | App server becomes a bandwidth bottleneck/proxy for every byte in the system |
| Content-addressable chunk storage (dedup) | Store each file's bytes independently | Massive storage waste — same OS files/documents re-stored per user |
| Content-defined chunking (rolling hash) | Fixed-size chunking | Small edits shift all subsequent chunk boundaries, destroying dedup efficiency on edited files |
| Cursor-based delta sync | Full metadata re-sync each time | Wasteful bandwidth/battery on mobile clients with large accounts |
| Async chunk garbage collection | Synchronous delete on ref_count=0 | Slow delete path, races with concurrent uploads referencing the same chunk |

---

## 5. News Feed

### Requirements

**Functional**
- Users follow other users/pages; see a reverse-chronological or ranked feed of posts from who they follow.
- Post creation (text/image/video), like/comment, and those actions should (eventually) reflect back into feeds.

**Non-functional**
- Feed read latency \<200ms p99 — this is the primary product surface, opened dozens of times a day per user.
- Extreme read:write skew — feed views vastly outnumber posts (easily 1000:1 or more).
- Must handle **celebrity/hot users** with 50M+ followers without melting the system on every post they make — this asymmetry is the crux of the entire design.

### Scale/Capacity Estimation

- Assume 300M daily active users, each checking feed ~10x/day → **3B feed reads/day** ≈ 35,000 reads/sec avg, 150,000/sec peak.
- Assume 50M posts/day created → ~580 writes/sec avg, but bursty around global events.
- Avg followers per user: 200. But power-law distribution — some accounts have 50M+ followers.
- A feed read returns ~20-50 posts; each post ~500 bytes of feed-relevant metadata (post_id, author, timestamp, ranking_score) → cheap per read once assembled, the *assembly* is the hard part.
- Naive fan-out for one celebrity post to 50M followers = 50M writes for a single post — this single number is why fan-out-on-write can't be applied uniformly.

### API Design

```
POST /api/v1/posts
  Body: { "content": "...", "media_urls": [...] }
  Response: { "post_id": "p789", "created_at": ... }

GET /api/v1/feed?cursor=...&limit=20
  Response: { "posts": [{post_id, author_id, content, ranking_score, ...}], "next_cursor": "..." }

POST /api/v1/follow/{user_id}
POST /api/v1/posts/{post_id}/like
POST /api/v1/posts/{post_id}/comment
```

### Data Model

```
posts (sharded by post_id, write-once)
  post_id, author_id, content, media_refs, created_at

follows (sharded by follower_id for "who do I follow" queries,
         AND indexed by followee_id for "who follows me" fan-out queries)
  follower_id, followee_id, created_at

feed_inbox (per-user precomputed feed — the fan-out-on-write target)
  user_id, post_id, author_id, score, inserted_at
  -- implemented as a bounded-length list per user (e.g. Redis sorted set,
  -- capped at ~1000 most recent, keyed by user_id)

user_metadata
  user_id, follower_count   -- used to decide fan-out strategy per author
```

**Choice of DB:** `posts` — a wide-column/KV store keyed by `post_id` (write-once, read-by-key, no updates). `follows` — needs bidirectional indexed lookups, a wide-column store (Cassandra-style) with two tables (one indexed by follower, one by followee) is standard, since a single relational table with an index on both columns gets expensive at this scale on the fan-out-triggering side. `feed_inbox` — Redis sorted sets are ideal: bounded size per user, fast insert or trim, fast "get top N" read.

### High-Level Design

```
                          ┌───────────────┐
   Post Creation ────────▶│  App Server    │
                          └───────┬───────┘
                                  │ write post
                                  ▼
                          ┌───────────────┐
                          │  Posts Store    │
                          └───────┬───────┘
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │  Fan-out Dispatcher        │
                     │  (checks author's follower │
                     │   count → routes strategy) │
                     └──────────┬──────────────┘
                    ┌────────────┴─────────────┐
                    ▼                           ▼
         Fan-out-on-Write path         Fan-out-on-Read path
         (author has <10K followers)   (author is a "celebrity",
                    │                   >10K followers)
                    ▼                           │
         Push post_id into each                 │  (do nothing at write time;
         follower's feed_inbox                  │   post just sits in Posts Store)
         (Redis sorted set) via                 │
         async worker queue                     │
                                                 
   ┌─────────────────────────────────────────────────────┐
   │                    Feed Read Path                      │
   │  GET /feed → merge:                                    │
   │    1. user's precomputed feed_inbox (fan-out-on-write   │
   │       results from normal follows)                      │
   │    2. live-fetch recent posts from any celebrities       │
   │       the user follows (fan-out-on-read, small list)     │
   │  → merge-sort by timestamp/score → rank → return top N   │
   └─────────────────────────────────────────────────────┘
```

**Write path:** Author posts → post stored once in Posts Store → fan-out dispatcher checks the author's follower count → if below a threshold (say 10K), async workers push the `post_id` into every follower's `feed_inbox` Redis structure (fast, bounded-cost fan-out) → if above threshold (celebrity), skip fan-out entirely, the post just exists in the Posts Store.

**Read path:** User opens feed → app server reads their precomputed `feed_inbox` (already has posts from regular follows) → separately, fetches the small number of celebrities the user follows and live-queries their most recent posts (cheap because the *number of celebrities any one user follows* is small, even though each celebrity has millions of followers) → merges both lists, ranks, returns.

### Deep Dive: Fan-out-on-Write vs. Fan-out-on-Read — The Core Trade-off

This is the single most important trade-off in the entire "Level 2" set and deserves the full depth
treatment.

**Fan-out-on-write (push model):** On every post, immediately write the post reference into every follower's precomputed feed list. 
- *Pro:* Feed reads are extremely fast — just read one pre-built list, O(1)-ish.
- *Con:* Write amplification is proportional to follower count. A user with 50M followers generates 50M writes for one post. At any nontrivial post rate from popular accounts, this is a write storm that can take down the fan-out workers/queue.
- *Con:* Wasted work — many followers might not even open the app before the post is stale/irrelevant, but you paid the write cost anyway.

**Fan-out-on-read (pull model):** Don't precompute anything. When a user opens their feed, query posts from everyone they follow in real time, merge and rank on the fly.
- *Pro:* No write amplification — a celebrity posting costs one write, regardless of follower count.
- *Con:* Read cost is proportional to *following* count and requires fanning out a query across potentially hundreds of shards/authors at read time — every feed load becomes an expensive scatter-gather. At 35,000+ reads/sec this is far too slow and expensive to do for every user on every read.

**The actual answer used in industry (hybrid):** Use fan-out-on-write for the vast majority of users (below some follower-count threshold, e.g. 10K), because it makes the overwhelmingly common case (normal users reading their feed) cheap via precomputed lists. For celebrities/hot accounts, skip fan-out-on-write entirely and instead merge their posts in at read time — since any individual user follows only a handful of celebrities (even if each celebrity has millions of followers), the read-time merge cost stays small and bounded, no matter how big the celebrity is. This hybrid is why the follower-count threshold check in the fan-out dispatcher is the crux of the whole architecture — it's a routing decision, not a detail.

**Ranking is a second, related sub-problem** worth naming: a real feed isn't reverse-chronological, it's scored (recency, affinity to author, engagement prediction) — but that's typically a separate ranking service consuming feed candidates and re-ordering them; the *retrieval* (which posts are candidates at all) is the fan-out problem discussed above, and interviewers care most about retrieval unless they explicitly ask you to go deeper into ML ranking.

### Scaling the Design

- **First bottleneck:** fan-out worker queue throughput during high-post-rate periods (breaking news, major events causing many mid-size accounts to post simultaneously) — mitigate with priority queues (recent-active-user posts fan out first) and horizontally scaled worker pools consuming from a partitioned queue (Kafka partitioned by author_id).
- **Second bottleneck:** `feed_inbox` Redis memory footprint at 300M users × 1000 entries × ~50 bytes ≈ 15GB — very manageable, but grows with user base; shard Redis by user_id.
- **Celebrity read-merge cost** grows if a user follows *many* celebrities — cap it, or cache each celebrity's recent posts list at the edge (it's read by millions of feed-assemblies per minute, extremely cache-friendly) since celebrity posts are inherently hot content.

### Failure Handling

- **Fan-out queue backs up:** feed staleness increases (new posts from regular follows take longer to appear), but the app doesn't go down — a graceful degradation, not an outage; monitor queue lag as a key SLO.
- **Redis feed_inbox node dies:** affected users' precomputed feeds are temporarily unavailable — fall back to fan-out-on-read for those users as an emergency degraded path (slower, but functional) while the shard recovers/rebuilds.
- **Posts Store shard down:** posts from authors on that shard become temporarily unavailable/unpostable; other authors unaffected — sharding contains blast radius.
- **Ranking service down:** fall back to plain reverse-chronological ordering of retrieved candidates — never let a ranking failure become a feed-is-empty failure.

### Trade-offs

| Decision | Alternative | Why Rejected |
|---|---|---|
| Hybrid fan-out (write for normal users, read for celebrities) | Pure fan-out-on-write | Celebrity posts cause write storms (tens of millions of writes per post) |
| Hybrid fan-out | Pure fan-out-on-read | Every feed read becomes an expensive scatter-gather across all followees — too slow/expensive at 35K+ reads/sec |
| Bounded-length Redis sorted set per user for feed_inbox | Unbounded list, trim never | Unbounded memory growth per user over years of activity |
| Async fan-out via queue | Synchronous fan-out on post creation | Post creation latency would scale with follower count — unacceptable UX for the poster |

---

## 6. Search Autocomplete / Typeahead

### Requirements

**Functional**
- As a user types a query prefix, return the top-K most relevant completions within keystroke latency.
- Suggestions should reflect popularity/recency (trending queries surface, stale ones fade).
- Support personalization as a stretch goal (user's own search history weighted higher).

**Non-functional**
- Latency budget is brutally tight: \<50-100ms end-to-end per keystroke, because it fires on *every character typed*, not just on submit.
- Read-to-write ratio is enormous — millions of autocomplete lookups per single query-log update.
- Data staleness of minutes-to-hours is fine (trending topics don't need sub-second freshness) — this is a "read-optimized, eventually-consistent write" system.

### Scale/Capacity Estimation

- Assume 500M searches/day → avg query length ~20 chars → **10B keystroke-triggered autocomplete requests/day** ≈ 115,000/sec avg, much higher at peak (people type in bursts).
- Vocabulary: assume top 10M distinct queries worth indexing (long tail beyond that isn't worth serving).
- Trie node count: for 10M queries averaging 20 chars, worst case ~200M trie nodes if no prefix-sharing, but real-world prefix sharing (many queries share common prefixes like "how to...") cuts this substantially — assume ~50M effective nodes after compression.
- Memory: each node ~50-100 bytes (children pointers + aggregated top-K cache) → 50M × 100 bytes ≈ **5GB** — fits in memory on a single well-provisioned box, though sharded for HA/throughput headroom.
- Query log ingestion: 500M searches/day → ~5,800 writes/sec avg to the log used for updating trie weights offline.

### API Design

```
GET /api/v1/autocomplete?prefix=syst&limit=10
  Response: { "suggestions": [
      {"text": "system design interview", "score": 0.98},
      {"text": "system design roadmap", "score": 0.91},
      ...
  ]}
  Latency SLA: <50ms p99

POST /internal/v1/query-log   (fire-and-forget, from the main search service)
  Body: { "query": "system design interview", "user_id": "...", "timestamp": ... }
```

Autocomplete is read-only and public-facing; the log ingestion endpoint is internal, feeding the
offline pipeline that updates trie weights.

### Data Model

**In-memory trie is the core data structure — not a traditional DB for the hot path.** Each trie node optionally caches its own precomputed top-K completions (see Deep Dive) so a lookup is O(prefix length), not O(prefix length + subtree scan).

```
Trie node:
  children: map<char, TrieNode>
  is_end_of_word: bool
  top_k_cache: [(query_string, score), ...]  -- precomputed, size K (e.g. 10)

Offline aggregation store (batch-computed, e.g. from Spark/Flink job over query logs):
  query_frequency table: query_text, count, last_seen, trending_score
```

**Why a trie instead of a database query with `LIKE 'prefix%'`?** A `LIKE` prefix scan on a B-tree index can technically work (indexed prefix scans are efficient), but doesn't naturally support "give me the *top-K by score* matches" without scanning and sorting all matches under that prefix at query time — the trie's precomputed per-node top-K cache turns that into an O(1) lookup once you've walked to the right node. This is the crux of the deep dive below.

### High-Level Design

```
   User types "sys" ──▶ Load Balancer ──▶ App Server
                                              │
                                              ▼
                                    ┌───────────────────┐
                                    │  In-Memory Trie      │  (sharded by first
                                    │  Service (replicated  │   1-2 chars across
                                    │   read replicas)       │   multiple boxes)
                                    └───────────────────┘
                                              ▲
                                              │ periodic reload (e.g. every 10-60 min)
                                              │
                                    ┌───────────────────┐
                                    │  Trie Builder Job     │  (offline batch job)
                                    └─────────┬─────────┘
                                              ▲
                                              │ aggregated counts
                                    ┌───────────────────┐
                                    │  Query Log Stream     │  (Kafka)
                                    │  ← from main search   │
                                    │    service, fire-and-  │
                                    │    forget               │
                                    └───────────────────┘
```

**Write/update path (offline, decoupled from the read path entirely):** Every search query fired against the main search product is logged asynchronously to a Kafka stream → a batch job (hourly, or streaming with Flink for near-real-time trending) aggregates query frequency/recency → rebuilds (or incrementally updates) the trie's per-node top-K caches → the new trie is pushed to autocomplete-serving replicas, either as a full periodic reload or incremental patch.

**Read path:** User types each character → client debounces (~100-150ms) to avoid firing a request per keystroke on fast typers → app server routes to the trie shard responsible for that prefix range → walks the trie character-by-character to the node matching the typed prefix → returns that node's precomputed `top_k_cache` directly, no further computation needed → sub-10ms once you're past network latency.

### Deep Dive: Precomputed Top-K at Each Trie Node

**The naive approach** — walk to the prefix node, then DFS the entire subtree collecting all completions and sorting by score — is O(subtree size × log K), which is fine for rare prefixes but catastrophic for a popular short prefix like "a" or "the" with millions of descendant queries. This blows the \<50ms budget badly.

**The standard fix:** precompute and cache the top-K completions *at every node*, not just at leaves. When the trie is built (offline), do a bottom-up pass: each leaf's top-K is just itself; each internal node's top-K is the merge of its children's top-K lists (a K-way merge, keeping only the best K overall) — this is O(nodes × K log K) total build cost, done once offline, not per-query.

```
def build_topk(node):
    if node.is_end_of_word:
        node.top_k = [(node.full_word, node.score)]
    else:
        node.top_k = []
    for child in node.children.values():
        build_topk(child)
        node.top_k = merge_top_k(node.top_k, child.top_k, K=10)
    return node.top_k

def merge_top_k(list_a, list_b, K):
    return sorted(list_a + list_b, key=lambda x: -x[1])[:K]
```

At read time, the lookup is purely: walk down to the node matching the typed prefix (O(prefix
length), typically \<20 char comparisons), then return `node.top_k` directly — no subtree traversal
at request time at all. This shift-the-cost-to-build-time-not-query-time pattern is the
generalizable lesson: **any read path with a brutal latency SLA should be asking "what can I
precompute offline so the hot path becomes a lookup, not a computation."**

**Incremental updates** (avoiding a full trie rebuild every time): rather than rebuilding from scratch on every batch cycle, maintain the frequency table separately, and only recompute `top_k` bottom-up along the path from an updated leaf to the root (since only ancestors of a changed query can have their top-K affected) — this bounds update cost to O(word length × K log K) per changed query instead of rebuilding the whole trie.

### Scaling the Design

- **First bottleneck:** single-machine trie memory limits if vocabulary grows well past 10M entries — shard the trie by the first 1-2 characters of the prefix (e.g., all "a*" queries on shard 1, "b*" on shard 2), since queries are reasonably well-distributed across starting letters (adjust shard boundaries for actual observed skew, e.g., very common starting letters get finer splits).
- **Read throughput:** trivially horizontal — the trie is read-only from the serving perspective (rebuilt and swapped, not mutated in place), so just add more read replicas behind a load balancer, no coordination needed between them.
- **Trending/breaking queries** (a sudden spike, e.g. a breaking news term) — the offline-batch-only update path (hourly) is too slow to reflect real-time spikes; add a small, separate **hot-query overlay** — an in-memory hash map of currently-trending terms updated every few seconds from a streaming aggregator, consulted first before falling back to the trie's static top-K, then merged into results.

### Failure Handling

- **Trie service node dies:** load balancer routes to healthy replicas; since the trie is read-only and periodically reloaded from a stable snapshot, replicas are interchangeable and stateless-from-a-failure perspective (no data loss, just re-provision from the last snapshot).
- **Trie builder job fails:** serving replicas keep using the last successfully built trie — stale-but-functional degrades gracefully (this is exactly why staleness-tolerance was called out as a non-functional requirement).
- **Kafka query-log stream backs up:** autocomplete quality lags (new trends take longer to surface) but current autocomplete keeps serving from the existing trie without interruption — logging is decoupled from serving by design.

### Trade-offs

| Decision | Alternative | Why Rejected |
|---|---|---|
| In-memory trie with precomputed top-K per node | DB prefix query (`LIKE 'x%'`) at request time | Can't cheaply return "top-K by score" without a subtree scan/sort per request |
| Offline batch rebuild + hot-query overlay for trending | Fully real-time trie updates on every search | Real-time mutation of a shared, heavily-read in-memory structure under 115K+ req/sec is operationally fragile; batch + small real-time overlay balances freshness and stability |
| Shard trie by prefix character | Single monolithic trie replicated everywhere | Full vocabulary may not fit comfortably in memory per box as it grows; sharding also parallelizes build cost |
| Client-side debounce | Fire request on every keystroke | Wastes ~3-5x the request volume for fast typists, no material UX benefit |

---

## 7. Distributed Cache

### Requirements

**Functional**
- `GET(key)`, `SET(key, value, ttl)`, `DELETE(key)` — a KV interface, but the system itself, not a client of Redis.
- Support eviction when memory is full (LRU-style).
- Data distributed across many nodes; a client library routes each request to the right node.

**Non-functional**
- Extremely low latency: sub-millisecond to low-single-digit ms per operation — this is *the* defining requirement; if it's not faster than the DB it's caching, it has no reason to exist.
- Horizontal scalability: adding/removing nodes should redistribute load with minimal disruption (not "reshuffle everything").
- Availability over strict consistency is the usual choice — a cache serving a slightly stale value is fine; a cache that's down and causing every request to hit the DB directly is a cascading-failure risk.

### Scale/Capacity Estimation

- Assume caching layer needs to hold **500GB** of hot data (matches a system like the URL shortener's hot working set, times several such use cases).
- Node capacity: assume each cache node has 32GB RAM, ~25GB usable after OS/overhead → need **~20 nodes** minimum for capacity, more added for headroom and to spread request load.
- Throughput target: 500,000 ops/sec cluster-wide → ~25,000 ops/sec per node if evenly distributed across 20 nodes — well within a single node's capability for simple in-memory KV ops (real single-node Redis-like throughput is in the hundreds of thousands of ops/sec).
- Key size avg 50 bytes, value avg 1KB → ~500M keys fit in 500GB.

### API Design

This is a client-library-facing protocol, not an HTTP REST API (latency budget rules out HTTP
overhead per call):

```
Client library interface (e.g., a thin binary protocol over TCP, RESP-like):
  GET key          → value or nil
  SET key value [TTL]  → OK
  DEL key          → 1/0
  MGET key1 key2 ... → [value1, value2, ...]  (batched to amortize round-trips)

Cluster management (admin/internal):
  ADD_NODE(node_addr)
  REMOVE_NODE(node_addr)
  → triggers resharding via consistent hashing (see Deep Dive)
```

The client library embeds the routing logic (which node owns a given key) so there's no centralized
proxy hop on the hot path — this mirrors how real Memcached/Redis Cluster clients work.

### Data Model

There's no "database schema" here in the traditional sense — the data model *is* the system's
internal structure:

```
Per-node in-memory hash table:
  key → { value, expiry_timestamp, last_accessed (for LRU) }

Cluster-level:
  Consistent hash ring mapping key-hash-ranges → nodes
  (see Deep Dive — this ring is the core "schema" of the whole system)
```

No persistent DB is involved by design — durability is explicitly not a goal (that's what the
backing DB is for); if a cache node dies, its data is gone and simply refetched from the source of
truth on next access (cache-aside pattern from the caller's side).

### High-Level Design

```
        ┌──────────────┐
        │  Application   │   (the service that wants caching,
        │  using the      │    e.g. URL shortener, news feed, etc.)
        │  cache client   │
        │  library         │
        └───────┬──────┘
                │  client computes hash(key) → determines owning node
                │  via consistent hash ring (cached locally, refreshed
                │  on cluster topology change)
                ▼
     ┌──────────────────────────────────────────────┐
     │              Consistent Hash Ring                │
     │   Node A (owns range 0-25%) ── Node B (25-50%)    │
     │   Node C (50-75%) ── Node D (75-100%)              │
     └──────────────────────────────────────────────┘
                │              │              │
                ▼              ▼              ▼
          ┌─────────┐   ┌─────────┐   ┌─────────┐
          │ Cache Node│   │ Cache Node│   │ Cache Node│  ...
          │ A: hash   │   │ B: hash   │   │ C: hash   │
          │ table +   │   │ table +   │   │ table +   │
          │ LRU list  │   │ LRU list  │   │ LRU list  │
          └─────────┘   └─────────┘   └─────────┘
              (each node optionally has 1 replica for HA)
```

**Request flow:** Application calls `cache.get("user:123")` → client library hashes the key, consults its local copy of the consistent hash ring to determine which node owns that key → opens/reuses a persistent connection to that node → sends the GET → node looks up in its local hash table, checks expiry, updates LRU recency → returns value or nil directly to the client, no intermediate hops. On a cluster topology change (node added/removed), the client library is notified (via a lightweight gossip protocol or a config service like ZooKeeper/etcd) and refreshes its ring.

### Deep Dive: Consistent Hashing + LRU Eviction

**Why not simple modulo hashing (`hash(key) % num_nodes`)?** Because adding or removing a single node changes `num_nodes`, which changes the result of the modulo for *almost every key* — a full cluster resize would invalidate nearly 100% of cached entries simultaneously, causing a massive thundering-herd of cache misses hitting the backing DB all at once. This is unacceptable at any real scale.

**Consistent hashing solves this:** map both nodes and keys onto the same hash ring (e.g., a 2^32-point circular space using a hash like MD5 or MurmurHash). Each key is owned by the first node clockwise from its hash position. When a node is added or removed, only the keys that fall in the range adjacent to that node need to move — roughly `1/N` of all keys, not all of them.

```
def get_node(key, ring):  # ring: sorted list of (hash_value, node_id)
    h = hash(key)
    idx = bisect_left(ring, h)  # binary search for first node hash >= h
    if idx == len(ring):
        idx = 0  # wrap around the ring
    return ring[idx].node_id
```

**Virtual nodes (the detail that separates textbook-correct from production-correct):** plain consistent hashing with one point per physical node produces very uneven load distribution — some nodes end up owning much larger arcs of the ring than others purely by hash luck. The fix: give each physical node many virtual points on the ring (e.g., 100-200 virtual nodes per physical node, each independently hashed). This smooths the distribution close to uniform and also means that when one physical node fails, its load is spread across many other nodes rather than dumping entirely onto its single ring-neighbor.

**LRU eviction, per node:** implemented as a hash map + doubly linked list — O(1) get/set/evict:
- Hash map: `key → node in linked list` for O(1) lookup.
- Doubly linked list: maintains recency order; every GET/SET moves the accessed node to the head; when memory is full, evict from the tail (least recently used).
```
class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.map = {}  # key -> DLL node
        self.dll = DoublyLinkedList()  # head = most recent, tail = least recent

    def get(self, key):
        if key not in self.map: return None
        node = self.map[key]
        self.dll.move_to_front(node)
        return node.value

    def set(self, key, value):
        if key in self.map:
            self.dll.move_to_front(self.map[key])
            self.map[key].value = value
        else:
            if len(self.map) >= self.capacity:
                lru_node = self.dll.pop_tail()
                del self.map[lru_node.key]
            new_node = self.dll.push_front(key, value)
            self.map[key] = new_node
```
This O(1)-per-operation property is non-negotiable given the sub-millisecond latency requirement —
anything O(log n) or worse per operation (e.g., a heap-based approach) is a worse fit here.

### Scaling the Design

- **First bottleneck:** a single node becoming a hotspot for a very popular key (a "hot key" — e.g., a viral post's cache entry hit by tens of thousands of req/sec) — consistent hashing distributes *key space* evenly but can't fix one single key being disproportionately popular. Mitigate with client-side local caching of the single hottest keys (a tiny L1 cache in the app process itself) or by replicating hot keys across multiple nodes with a randomized read choice.
- Adding nodes for capacity: consistent hashing means only ~1/N of keys need to move, so scale-out is a low-disruption operation, not an all-hands migration event.
- Replication for read scaling: each node can have 1-2 replicas serving reads, with writes going to a primary that asynchronously propagates — trades a small consistency window for higher read throughput per key range.

### Failure Handling

- **Cache node dies:** consistent hashing means only the keys it owned are affected (not the whole cluster) — those keys simply miss on next access and fall through to the backing DB (cache-aside), repopulating on a *different* node once the ring is updated to route around the dead node. This is the core resilience property of the whole design: partial failure causes partial, bounded degradation.
- **Ring/config service (ZooKeeper/etcd) unavailable:** clients continue operating with their last-known ring topology — stale topology risks routing to a dead node (handled by connection failure + fallback-to-DB on the client side) but doesn't halt the system.
- **Network partition isolating a node:** that node's keys become temporarily unreachable from isolated clients; again, bounded blast radius, not a cluster-wide outage — this is the entire point of choosing availability/partition-tolerance over strict consistency for a cache (an AP system in CAP terms, which is the right choice since the cache is never the source of truth).

### Trade-offs

| Decision | Alternative | Why Rejected |
|---|---|---|
| Consistent hashing with virtual nodes | Modulo hashing | Near-total cache invalidation on every cluster resize |
| Cache-aside pattern (app checks cache, falls to DB on miss) | Write-through / read-through built into the cache layer | Simpler operationally to keep the cache "dumb" and let application logic own the fallback; also decouples cache failure from correctness |
| AP (available, partition-tolerant) over strict consistency | Synchronous replication with consistency guarantees | A cache's entire value proposition is speed; strict consistency protocols add latency that defeats the purpose, and staleness is tolerable since the cache is never authoritative |
| O(1) LRU via hashmap + DLL | LFU or a more "accurate" eviction policy (e.g. ARC) | LRU is simpler, O(1), and good-enough for the vast majority of access patterns; only reach for LFU/ARC if measured hit-ratio data justifies the added complexity |

---

## 8. Metrics System

### Requirements

**Functional**
- Services emit time-series metrics (counters, gauges, histograms) tagged with dimensions (host, service, region).
- Support flexible queries: aggregate a metric over time windows, group by tag, compute percentiles.
- Alerting: trigger notifications when a metric crosses a threshold over a time window.

**Non-functional**
- Ingestion must handle massive write volume without becoming the bottleneck for the very services it's monitoring (a metrics outage should never cause an application outage).
- Query latency for dashboards should be a few hundred ms even over large time ranges — achieved via pre-aggregation/rollups, not brute-force scans.
- Long-term storage is expensive at raw resolution — must downsample old data (this is the defining design constraint of any real metrics system).

### Scale/Capacity Estimation

- Assume 100,000 hosts, each emitting 100 distinct metrics, at 10-second resolution.
- Ingestion rate: 100,000 × 100 / 10 sec = **1,000,000 data points/sec**.
- Each data point: `(metric_name, tags, timestamp, value)` ≈ 100 bytes raw (before compression).
- Raw ingestion volume: 1M/sec × 100 bytes = 100MB/sec ≈ **8.6TB/day** raw — this is why downsampling/retention tiers are not optional, they're the core of the storage design.
- Retention strategy driving storage size: raw (10s resolution) for 24 hours, 1-minute rollups for 30 days, 1-hour rollups for 2 years.
  - Raw tier: 8.6TB × 1 day ≈ 8.6TB (rolling window)
  - 1-min rollup: 1M/sec ÷ 6 (10s→1min = 6x reduction) × 100 bytes × 86400 sec × 30 days ≈ **~430GB** (with compression typically 5-10x better, so realistically ~50-80GB)
  - 1-hour rollup for 2 years: negligible by comparison, a few GB.
- This tiering takes total storage from a naive "8.6TB/day forever" (multi-petabyte/year) down to a manageable, roughly-constant footprint.

### API Design

```
POST /api/v1/metrics/ingest   (called by every monitored service, high volume)
  Body: [{ "metric": "http.request.latency", "tags": {"host": "web-1", "region": "us-east"},
            "timestamp": 1699999999, "value": 42.5 }, ...]   -- batched, not one-per-call
  (typically UDP or a lightweight local agent batching before a periodic HTTP/gRPC push,
   to keep per-call overhead off the application's critical path)

GET /api/v1/metrics/query
  ?metric=http.request.latency&start=...&end=...&group_by=region&agg=p99&interval=1m
  Response: { "series": [{"tags": {"region": "us-east"}, "points": [[ts, value], ...]}] }

POST /api/v1/alerts
  Body: { "metric": "http.request.error_rate", "condition": "> 0.05", "window": "5m", "notify": [...] }
```

### Data Model

A **time-series database** is the correct specialized choice here (not a general relational DB) —
purpose-built TSDBs (Prometheus's TSDB, InfluxDB, or a Cassandra-backed model like OpenTSDB) are
optimized for exactly this write pattern (append-only, time-ordered, high cardinality on tags) and
this query pattern (range scans over time, aggregation).

```
Time-series key: metric_name + sorted tag set → forms a unique "series ID"
  e.g. http.request.latency{host=web-1,region=us-east}

Storage layout (columnar, time-partitioned):
  series_id | timestamp | value
  (physically partitioned by time range — e.g., one partition file per hour —
   so old partitions can be cheaply rolled up and then deleted/archived wholesale)

Rollup tables (pre-aggregated, written by a background downsampling job):
  series_id | rollup_interval | window_start | count | sum | min | max | (percentile sketch)
```

**Why not just store raw points forever in a relational DB?** Cardinality — with 100K hosts × 100 metrics × tag combinations, the number of distinct series can reach millions; a general RDBMS index on `(metric, tags, timestamp)` degrades badly at this cardinality and write rate. TSDBs use specialized compression (delta-of-delta timestamp encoding, XOR-based float compression — the Facebook Gorilla paper's approach) achieving 10x+ compression versus naive storage, which is precisely why the storage estimate above assumed compression gains.

### High-Level Design

```
  Monitored Services (100K hosts)
        │  local agent batches metrics every few seconds
        ▼
  ┌─────────────────┐
  │  Ingestion Gateway  │  (stateless, horizontally scaled,
  │  (validates, batches,│   absorbs bursts)
  │   load-balances)     │
  └─────────┬─────────┘
            ▼
  ┌─────────────────┐
  │  Write Buffer/Queue │  (Kafka — decouples ingestion spikes
  │                      │   from storage write capacity)
  └─────────┬─────────┘
            ▼
  ┌─────────────────┐        ┌──────────────────────┐
  │  TSDB Write Path    │───▶│  Raw Storage (hot, 24h)  │
  │  (partitioned by     │    └──────────────────────┘
  │   series_id hash)    │             │
  └─────────────────┘             ▼ (background rollup job)
                            ┌──────────────────────┐
                            │  Rollup Storage          │
                            │  (1-min, 1-hour tiers,    │
                            │   compressed, long-term)  │
                            └──────────────────────┘
                                     ▲
  ┌─────────────────┐              │
  │  Query Service      │──────────────┘  (queries route to raw or
  │  (dashboards, alerts)│                  rollup tier based on
  └─────────────────┘                     requested time range)
            │
            ▼
  ┌─────────────────┐
  │  Alerting Engine    │  (continuously evaluates rules against
  │                      │   incoming/recent data, fires notifications)
  └─────────────────┘
```

**Ingestion path:** Local agent on each host batches metric points locally (avoids per-metric network calls) → pushes batches to an ingestion gateway every few seconds → gateway validates and writes to a Kafka topic (partitioned by `series_id` hash, so all points for one series land in order on one partition — important for correctness of rollups) → TSDB write workers consume from Kafka and persist to the raw (hot) storage tier → a background job continuously rolls up raw data into 1-minute and 1-hour aggregates, and once data ages past its raw retention window, the raw partition is dropped (only rollups remain).

**Query path:** Dashboard/alert query specifies a metric, tag filters, time range, aggregation → query service decides which storage tier to hit based on requested range (last 24h → raw; last 30 days → 1-min rollups; last 2 years → 1-hour rollups) → executes the aggregation (or reads pre-aggregated rollup values directly, avoiding recomputation) → returns time-series result.

### Deep Dive: Downsampling/Rollup Strategy and Percentile Aggregation Correctness

**Downsampling mechanics:** a background job (or a streaming aggregator consuming the same Kafka topic in parallel with the raw writer) buckets incoming points into fixed windows (e.g., every 60 seconds) and computes `count, sum, min, max` incrementally as points arrive — this is straightforward for count/sum/min/max since they're all trivially mergeable across sub-windows (rolling a 1-min rollup up into a 1-hour rollup is just re-aggregating the 60 one-minute buckets).

**The genuinely hard part: percentiles don't merge trivially.** You cannot average p99s or take the p99 of a set of pre-computed p99s and get a mathematically correct answer — percentiles are not associative/mergeable the way sum or max are. Two approaches:

1. **Store enough raw data to recompute percentiles exactly on demand** — expensive, defeats the purpose of rollups for long time ranges.
2. **Use a mergeable approximate percentile sketch** (t-digest or HDRHistogram are the industry-standard answers) — these data structures maintain a compressed, approximate representation of the distribution that *can* be merged across time windows while bounding error. When ingesting, each 1-minute bucket stores a small t-digest sketch (a few KB) instead of raw points; to compute a p99 over a 1-hour range, merge the 60 one-minute sketches into one and query it for p99 — the error introduced is small and bounded (typically \<1-2% relative error near the tails, which is what t-digest specifically optimizes for, unlike naive fixed-bucket histograms which lose accuracy exactly where percentile queries usually care most).

```
# conceptual: t-digest supports mergeable, streaming percentile estimation
minute_digest = TDigest()
for point in points_in_this_minute:
    minute_digest.add(point.value)
store(series_id, minute_bucket, minute_digest.serialize())  # a few KB, not raw points

# querying p99 over an hour:
digests = [load(series_id, m) for m in range(60)]
merged = TDigest.merge(digests)
p99 = merged.quantile(0.99)
```

This is the single most important "gotcha" to name in a metrics-system interview — candidates who
don't know that percentiles aren't mergeable will propose a rollup scheme that silently produces
wrong p99s, which is a serious, hard-to-detect correctness bug in a monitoring system (exactly the
systems everyone trusts to tell the truth about production health).

### Scaling the Design

- **First bottleneck:** ingestion gateway/Kafka throughput at 1M points/sec — mitigate with more Kafka partitions (partitioned by series_id, so this scales horizontally cleanly) and more gateway instances behind a load balancer; UDP-based ingestion (accepting some point loss) is a common trade-off used by real systems (e.g., StatsD) specifically because losing an occasional metric point is far preferable to metrics ingestion backpressure ever affecting application performance.
- **High cardinality tags** (e.g., a tag that includes a unique request ID) can explode the number of distinct series into the billions, which no TSDB handles gracefully — this is a well-known operational failure mode; mitigate at the ingestion/validation layer by rejecting or warning on tags with unbounded cardinality (this is a product/API-contract decision as much as a technical one).
- **Query fan-out** for a dashboard aggregating across many hosts (`group_by=region`) — pre-aggregate common groupings during the rollup job itself (materialized rollups per likely query dimension) rather than computing group-bys at query time over millions of raw series.

### Failure Handling

- **Ingestion gateway down:** local agents buffer locally for a bounded window (e.g., a few minutes of local disk/memory buffer) and retry — brief gateway blips don't lose data; sustained outages eventually drop data (acceptable, since perfect metrics durability is not worth blocking or crashing the monitored application).
- **Kafka unavailable:** same local-buffering fallback at the agent level; this is why local buffering, not just gateway-level buffering, matters — it pushes resilience to the edge, closest to the data source.
- **Rollup job fails/lags:** raw data is still safely stored in the hot tier (24h window) — a lagging rollup job risks losing the ability to roll up data before it ages out of raw storage; monitor rollup lag as a critical internal SLO with alerting on the alerting system itself (a well-known "who watches the watchers" concern worth naming).
- **Query service down:** dashboards/alerts unavailable, but ingestion is entirely unaffected (fully decoupled read/write paths) — no data loss, just a temporary visibility gap.

### Trade-offs

| Decision | Alternative | Why Rejected |
|---|---|---|
| Tiered storage with downsampling | Store all raw points forever | Storage cost grows unbounded (~3PB/year at this scale) for data whose old-and-precise values are rarely, if ever, queried |
| t-digest/HDRHistogram sketches for percentiles | Naive average of pre-computed percentiles across windows | Mathematically incorrect — percentiles are not mergeable/associative |
| Kafka as write buffer before TSDB | Direct synchronous writes to TSDB from every host | No buffer against ingestion bursts; TSDB write hiccups would directly cause data loss or backpressure onto application hosts |
| UDP/best-effort ingestion transport | TCP with guaranteed delivery/retries | For metrics specifically, occasional point loss is an acceptable trade for never letting monitoring overhead affect the monitored application's reliability |
| Local agent buffering | No local buffering, fail immediately on gateway unavailability | Brief network/gateway blips would cause needless data gaps that a few minutes of local buffer easily absorbs |

---

## Closing: The Pattern Behind the Patterns

Looking back across all eight systems, the same handful of decisions keep recurring in different
costumes:

- **Split hot metadata from cold/large payloads** (Pastebin, File Storage) — small indexed records in a fast DB, bulk bytes in object storage.
- **Push cost from the read path to a background/offline path whenever the read path has a tight latency SLA** (Autocomplete's precomputed top-K, Metrics' rollups, News Feed's fan-out-on-write).
- **Use consistent hashing whenever you need to shard *and* expect the shard count to change over time** (Distributed Cache, and implicitly any of the DB-sharding decisions above).
- **Decouple ingestion/write bursts from persistence with a queue** (Metrics, News Feed fan-out, File Storage uploads).
- **Fail open vs. fail closed is a product decision, not just an engineering one** — state it explicitly rather than assuming (Rate Limiter, Cache).

Revisit the framing question: *did you pick each primitive because the requirements demanded it, or
because it was the one you remembered from a diagram?* If you can defend every box in every diagram
above with a number or a failure scenario, you're ready for Part B.
