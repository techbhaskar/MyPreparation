---
slug: /05b-hld-mastery-level3-4-async-and-realtime
---

# Stage 5 (Part B) — HLD Mastery: Level 3 Async/Event Systems & Level 4 Real-Time Systems
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **Framing question:** *Can I combine the building blocks appropriately instead of memorizing
architectures?* > > Every system below is built from the same ~15 primitives you already know: load
balancers, stateless app servers, a message queue/log, a KV store, a relational store, a blob store,
consistent hashing, a WebSocket/connection-management layer, and idempotency/retry/backoff patterns.
The skill being tested at Staff level is not "have you seen this exact diagram before" — it's "can
you assemble the primitives, justify each choice with a number, and know exactly where it breaks."

## Table of Contents

**Level 3 — Async / Event Systems**
1. [Notification Platform](#1-notification-platform)
2. [Logging Platform](#2-logging-platform)
3. [Job Scheduler](#3-job-scheduler)
4. [Webhook Delivery Platform](#4-webhook-delivery-platform)

**Level 4 — Real-Time Systems**
5. [Chat / WhatsApp-style Messaging](#5-chat--whatsapp-style-messaging)
6. [Presence System](#6-presence-system)
7. [Live Location (Uber-style)](#7-live-location-uber-style)
8. [Collaborative Editing (OT vs CRDT)](#8-collaborative-editing-ot-vs-crdt)

---

# 1. Notification Platform
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- Any internal service can trigger a notification via API or event: push (APNs/FCM), email, SMS, in-app.
- Templating: a notification is `template_id + locale + variables`, not hardcoded strings.
- User preferences: channel opt-in/out, quiet hours, per-category subscription (marketing vs transactional — transactional cannot be opted out).
- Provider abstraction: swap Twilio for a different SMS vendor without touching calling services.
- Retry on transient provider failure; no duplicate delivery on retry.
- Delivery status tracking (sent, delivered, bounced, failed) fed back to callers.

**Non-functional**
- At-least-once delivery for transactional notifications (OTP, payment confirmation); best-effort, deduped for marketing.
- p99 end-to-end latency < 5s for transactional push/SMS; email can tolerate minutes.
- Multi-tenant fan-out: a single "your order shipped" event might be one recipient; a marketing campaign might be 50M recipients — both must not starve each other.
- Provider outage isolation: FCM being down must not delay SMS sending.

### Scale/Capacity estimation

Assume a mid-size consumer company: 50M MAU.
- Transactional notifications: ~5 per user per day → 250M/day ≈ 2,900/sec average, peak 3-5x → ~12k/sec.
- Marketing campaigns: occasional blasts of 20M recipients that should drain in under 30 minutes → ~11k/sec burst, scheduled off-peak.
- Average payload with template resolved ~2 KB. Storage of notification log at 250M/day × 2KB ≈ 500 GB/day raw — this goes to cold storage/warehouse after 30 days hot.
- Provider rate limits are the real bottleneck: FCM ~ unlimited practically, APNs ~ thousands/sec per cert, SMS providers often capped at hundreds/sec per account — this drives the need for per-provider queues and token-bucket throttling, not just internal capacity.

### API design

```
POST /v1/notifications
{
  "template_id": "order_shipped",
  "locale": "en-US",
  "recipient_id": "user_123",
  "variables": {"order_id": "A1", "eta": "Aug 26"},
  "channels": ["push", "email"],      // optional override; else use user prefs
  "priority": "transactional",        // transactional | marketing
  "idempotency_key": "order_A1_shipped"
}
→ 202 Accepted { "notification_id": "n_789" }

GET /v1/notifications/{id}/status
→ { "channel": "push", "state": "delivered", "ts": ... }

POST /v1/templates          (admin) - create/version a template
PUT  /v1/users/{id}/preferences   - opt in/out per category+channel
```

Bulk/campaign path is separate: `POST /v1/campaigns` takes a segment query or a recipient-list file
(uploaded to blob storage) and is processed asynchronously by a fan-out job, never synchronously
through the single-notification API.

### Data model

- **Templates** (Postgres): `template_id, locale, channel, body, version, category`. Relational because templates are low-volume, need versioning/rollback, and admin UIs benefit from transactions.
- **User preferences** (Postgres or a KV store like DynamoDB): `user_id, category, channel, opted_in`. Read-heavy, small rows, keyed by user_id → KV/DynamoDB is fine here; Postgres also fine at this scale. Pick DynamoDB if this needs to scale past single-node Postgres comfortably.
- **Notification log** (Cassandra/DynamoDB, time-series-ish): `notification_id (PK), recipient_id, channel, state, created_at, provider_response`. Write-heavy, append-mostly, queried by ID or recent-by-user — wide-column store fits better than relational at 250M rows/day.
- **Idempotency table**: `idempotency_key → notification_id`, TTL 24h, in Redis for fast dedup check.

### High-Level Design

```
                         ┌──────────────┐
 Internal services ───▶  │  Notify API   │──▶ validate, resolve template,
 (order, billing, ...)   │ (stateless)   │    check prefs, dedup key
                         └──────┬───────┘
                                │ publish (partition by recipient_id)
                                ▼
                       ┌──────────────────┐
                       │  Kafka: notify-   │
                       │  requests topic   │
                       └────────┬─────────┘
                                │
                 ┌──────────────┼───────────────┐
                 ▼              ▼               ▼
          ┌───────────┐  ┌───────────┐   ┌───────────┐
          │ Push       │  │ Email      │   │ SMS        │
          │ Dispatcher │  │ Dispatcher │   │ Dispatcher │  (consumer groups,
          └─────┬─────┘  └─────┬─────┘   └─────┬─────┘   one per channel)
                │              │               │
        token-bucket    token-bucket     token-bucket
        rate limiter    rate limiter     rate limiter
                │              │               │
                ▼              ▼               ▼
             APNs/FCM        SES/SendGrid     Twilio/etc
                │              │               │
                └──────┬───────┴───────┬───────┘
                       ▼               ▼
               delivery webhooks → Status Updater → Notification Log (Cassandra)
                                                    → callback to originating service
```

**Request flow:** caller hits Notify API → API resolves template + locale + variables into final content, checks user preference (skip if opted out, unless transactional), writes an idempotency record, and publishes a message to Kafka partitioned by `recipient_id` (so retries/ordering per user are preserved). Channel-specific dispatcher consumer groups pull from the topic, apply a **per-provider token-bucket rate limiter** (because provider limits are the real constraint, not our own throughput), call the provider SDK, and write the result to the notification log. Provider delivery webhooks (APNs feedback, SES bounce notifications) update final state asynchronously.

### Deep Dive

**1. Provider abstraction without leaking provider quirks.** Define a `NotificationProvider` interface: `send(recipient, content) -> ProviderResult{status, provider_message_id}`. Each dispatcher loads its provider via config, not code branching — this is the one place polymorphism earns its keep, because we genuinely swap SMS vendors for cost/reliability reasons in production. Provider-specific rate limits and retry policies (e.g., Twilio backs off differently than a carrier-direct API) live in per-provider config, not in the dispatcher core loop.

**2. Exactly-once *effect*, at-least-once *delivery*.** Kafka + consumer crash-restart means a dispatcher might process the same message twice. We cannot get true exactly-once against an external SMS carrier (once sent, sent). The mitigation: idempotency key = hash(template_id, recipient_id, variables, day) stored in Redis with a SETNX before calling the provider; if the key exists, skip and just re-emit the previously recorded status. This bounds duplicate *user-visible* sends to the retry window, not eliminates the class entirely — acceptable for notifications (unlike payments).

**3. Isolating marketing blasts from transactional traffic.** A 20M-recipient campaign must not delay someone's OTP. Two Kafka topics per channel (`push-transactional`, `push-marketing`) with separate consumer group scaling — transactional consumers are always warm and modestly sized; marketing consumers autoscale up during a campaign and are explicitly rate-limited to leave provider headroom for transactional traffic (e.g., reserve 20% of the SMS provider's rate limit for transactional, cap marketing at 80%).

### Scaling the design

- Dispatchers scale horizontally by adding Kafka consumers up to partition count; partition count sized for peak channel throughput (e.g., 64 partitions for push).
- Template resolution is CPU-light and cacheable (templates change rarely) — cache in each API node's memory with a short TTL + pub/sub invalidation on template update.
- For very high fan-out campaigns, don't materialize the recipient list synchronously — stream user IDs from the segment query directly into Kafka via a paginated background job, so campaign start latency doesn't depend on segment size.

### Failure handling

- Provider down → dispatcher's calls fail → exponential backoff + circuit breaker per provider; messages stay in Kafka (durable) until the breaker closes, no data loss, just delayed delivery. Alert if backlog age exceeds threshold (e.g., 10 min for transactional).
- Poison messages (malformed template variables) → dead-letter topic after N retries, don't block the partition behind them.
- Kafka partitioning by `recipient_id` means one problematic user's messages don't block other users, but a hot template (mass campaign to one shard) can create partition skew — mitigate with a good hash key or splitting large campaigns across a synthetic sub-key.

### Trade-offs

- **Kafka topic-per-channel vs single topic with routing**: per-channel topics chosen for independent scaling and failure isolation, at the cost of more operational topics to manage.
- **At-least-once + idempotency vs building exactly-once semantics**: cheaper and simpler; accepted because a duplicate notification is an annoyance, not a financial loss (unlike the webhook/payment case).
- **Sync template resolution in API vs deferring to dispatcher**: resolving early lets us validate the request (bad variables) before accepting it, at the cost of doing it once per request even for channels that might be skipped by preferences — acceptable since resolution is cheap.

---

# 2. Logging Platform
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- Applications emit structured log lines (JSON) via a lightweight agent/SDK.
- Centralized search: full-text + structured field filters (service=X AND level=ERROR AND time range).
- Dashboards/alerts on log-derived metrics (error rate spike).
- Retention tiers: hot (searchable, 7-14 days), warm/cold (queryable but slower, 90 days–1 year), archive (compliance, years).

**Non-functional**
- Ingestion must never block or crash the emitting application (backpressure absorbed at the edge).
- Durability: acceptable to lose a small % of logs under extreme load (this is *not* a transactional system) but must not silently drop everything.
- Ingest scale: must handle bursty spikes (a bad deploy can 100x log volume in seconds).
- Search p95 < 2s for a 15-minute window over recent hot data.

### Scale/Capacity estimation

- 5,000 services, each emitting ~50 log lines/sec average → 250k lines/sec ≈ 250k events/sec sustained, bursts to 1M/sec during incidents.
- Average log line ~500 bytes (JSON with metadata) → 250k × 500B = 125 MB/s ≈ 10.8 TB/day raw ingest.
- With compression (~5:1 typical for repetitive log text) → ~2.2 TB/day stored hot.
- Hot retention 14 days → ~30 TB hot index size (needs to fit across a sharded search cluster, not one box).
- This scale immediately rules out "just grep files on a box" and justifies a distributed pipeline — this is the number that makes the architecture below defensible rather than over-engineering.

### API design

Ingestion is not a public request/response API in the traditional sense — it's an agent protocol,
but we still define it:

```
Agent → Ingest Gateway (gRPC or HTTP/2 streaming):
POST /v1/ingest/batch
{
  "logs": [
    {"ts":..., "service":"checkout", "level":"ERROR", "trace_id":"...", "msg":"...", "fields":{...}}
    ... batched, gzip-compressed, up to 1-5 MB per batch
  ]
}
→ 200 { "accepted": 480, "rejected": 0 }

Query API (used by dashboard/UI):
POST /v1/search
{ "query": "service:checkout AND level:ERROR", "from":..., "to":..., "limit":100 }
```

Batching + compression at the agent is a deliberate choice: 250k individual HTTP requests/sec would
drown the gateway in connection overhead; batches of ~500 lines every 1-2s per host cuts request
count by orders of magnitude.

### Data model

- **Hot tier**: Elasticsearch/OpenSearch (or Loki-style approach). Index per day per service-group, sharded. Chosen because full-text + structured filter search is exactly what an inverted-index engine is for; you would not build this on Postgres at this scale.
- **Warm/cold tier**: log batches stored as compressed Parquet/columnar files in object storage (S3), partitioned by date/service. Queried via a scan engine (e.g., Athena/Presto/ClickHouse) — cheaper storage, slower ad hoc query, acceptable for "investigate an incident from 3 months ago."
- **Metadata/index catalog**: which S3 prefixes correspond to which date/service, in a small relational table.
- Document schema (ES): `{timestamp, service, host, level, trace_id, span_id, message, fields: {...dynamic...}}` — `fields` mapped as a flattened/dynamic type to avoid mapping explosions from arbitrary keys.

### High-Level Design

```
[App + sidecar agent] --batch, gzip, async--▶ [Ingest Gateway (stateless, LB'd)]
                                                        │
                                                        ▼ validate, add ts if missing, sample if over quota
                                              [Kafka: raw-logs topic, partitioned by service]
                                                        │
                            ┌───────────────────────────┼──────────────────────────┐
                            ▼                            ▼                          ▼
                   [Hot Indexer workers]         [Cold Archiver workers]   [Metrics Extractor]
                   parse → bulk index to           batch → Parquet →        derive counters
                   Elasticsearch (hot)             write to S3 (cold)       (error rate/sec) →
                                                                             push to TSDB/Prometheus
                            │                                                        │
                            ▼                                                        ▼
                   [Search API] ◀── Kibana/Grafana UI                    [Alerting on rate spikes]
```

**Request flow:** each host runs a lightweight agent that tails log files or receives structured logs via a local socket, buffers them in memory (with disk spillover as a safety net), and ships gzip-compressed batches to the Ingest Gateway over HTTP/2 or gRPC. The gateway does minimal validation and immediately republishes to Kafka partitioned by service (keeps a given service's logs roughly time-ordered within a partition and lets one noisy service's volume not require repartitioning everything). Two independent consumer groups read the same topic: hot indexers parse and bulk-write into Elasticsearch for interactive search; cold archivers batch into Parquet files on S3 for cheap long-term retention. A third consumer derives real-time metrics (error counts per service per minute) for alerting, decoupled from full-text search so a search cluster hiccup doesn't blind alerting.

### Deep Dive

**1. Backpressure and sampling under a log storm.** The scenario that breaks naive designs: a bad deploy causes a crash loop that produces 50x normal log volume. If we ingest all of it faithfully, Kafka and Elasticsearch fall over exactly when engineers most need the system. The fix is a layered defense: (a) the agent applies a local token bucket per host — beyond a threshold it starts sampling (keep 1 in N, always keep ERROR/FATAL) and tags the batch with a `dropped_count` so the search UI can show "12,000 lines suppressed here"; (b) the Ingest Gateway applies a per-service quota against Kafka partition throughput and returns 429/backoff signals the agent respects; (c) Elasticsearch bulk indexers apply their own admission control (reject or delay indexing if cluster is red/yellow) rather than queueing unboundedly and OOMing. The principle: **never drop silently, degrade visibly, protect ERROR-level signal preferentially.**

**2. Elasticsearch sharding/lifecycle to keep hot search fast.** Time-based indices (one index per service-group per day) let us apply Index Lifecycle Management: an index is "hot" (SSD nodes, more replicas, actively written) for 1-2 days, rolls to "warm" (fewer replicas, cheaper nodes) for the rest of the 14-day hot window, then is deleted from ES (data already safely in cold Parquet). Shard count per index is sized so no single shard exceeds ~30-50GB (the well-known ES rule of thumb) — for a 2TB/day hot index that's roughly 40-60 primary shards distributed across the cluster. Search queries are automatically scoped to the relevant date-range indices via an index pattern, so a "last 15 minutes" query only touches today's hot shards, not the full 14-day history.

### Scaling the design

- Kafka partition count for `raw-logs` sized to the noisiest service's peak throughput, not the average — a single hot partition becomes the ingestion bottleneck otherwise.
- Elasticsearch scales by adding data nodes; the real constraint is usually not CPU but heap/JVM GC pressure from field-mapping explosions — enforce field-count limits per document at the gateway (reject documents with runaway dynamic `fields`).
- Cold tier scales trivially (S3 + stateless Parquet writers); query-time scaling handled by the query engine's own worker pool (Presto/Athena), decoupled entirely from ingestion.

### Failure handling

- Ingest Gateway down → agents buffer locally to disk (bounded ring buffer) and retry with backoff; a multi-minute gateway outage is tolerable, a multi-hour one starts dropping oldest-first.
- Elasticsearch cluster degraded → hot indexer consumer group falls behind, Kafka retains data per its retention window (e.g., 3 days) — as long as ES recovers within that window, no data loss, just delayed searchability. Cold archiving continues unaffected since it's a separate consumer group.
- One indexer crashing mid-batch → Kafka consumer offset not committed until bulk-index ack succeeds, so on restart it reprocesses the batch — indexing to ES is close to idempotent if document IDs are derived deterministically (hash of content+offset) rather than auto-generated, avoiding duplicate documents on reprocessing.

### Trade-offs

- **Best-effort/lossy under extreme load vs. guaranteed durability**: chosen deliberately — a logging platform that back-pressures the *application* to guarantee no log loss would be a worse outage multiplier than losing some DEBUG lines during a storm.
- **Elasticsearch (rich query, expensive) for hot + Parquet/S3 (cheap, slower) for cold**: a single-tier "keep everything in ES forever" is simpler but the cost curve is brutal at this ingest rate; two tiers cost more engineering but 10x less storage spend.
- **Agent-side batching/sampling vs. server-side only**: pushing some intelligence to the edge (agent) adds deployment complexity (agent versioning across 5,000 services) but is the only way to survive a log storm without the network itself becoming the bottleneck.

---

# 3. Job Scheduler
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- Schedule a job to run once at a specific future time, or on a recurring cron-like schedule.
- Support millions of distinct scheduled jobs (per-user reminders, per-tenant billing runs, etc.), not just a handful of ops cron jobs.
- Guarantee a job executes at-least-once at (or very shortly after) its scheduled time.
- Support job payload = "call this webhook/enqueue this task" — the scheduler triggers work, it doesn't necessarily do the work itself.
- Allow cancel/reschedule/update before firing.
- Handle retries with backoff if the triggered work fails.

**Non-functional**
- Scheduling accuracy: fire within a bounded window (e.g., ±5s for time-critical, ±60s acceptable for most).
- Must not double-fire a job under normal operation, and must bound duplicate firing even under failover (at-least-once, not "at-least-fifty-times").
- Horizontally scalable to tens of millions of pending jobs.
- Survive scheduler node crashes without losing or indefinitely delaying jobs.

### Scale/Capacity estimation

- Target: 100M scheduled jobs in the system at any time (e.g., a reminders product with 20M users averaging 5 pending reminders each, plus system cron jobs).
- Average firing rate: if jobs are roughly evenly distributed over a month, that's 100M / (30×86400) ≈ 39 jobs/sec average, but real-world clustering (everyone schedules "9am tomorrow") creates bursts of 10-50x average → design for ~2,000 jobs/sec peak firing.
- Each job record ~1 KB (payload + metadata) → 100M × 1KB = 100 GB — fits comfortably in a sharded relational or KV store, this is not a "big data" storage problem, it's a **precise-timing-at-scale** problem.
- Polling-based naive design (`SELECT * WHERE due_time < now()`) against 100M rows is the anti-pattern to explicitly reject in an interview — it doesn't scale and creates thundering-herd queries; the design below avoids full-table scans entirely.

### API design

```
POST /v1/jobs
{
  "run_at": "2026-08-25T09:00:00Z",       // one-off
  "cron": null,                            // OR "0 9 * * MON" for recurring
  "action": {"type": "webhook", "url": "...", "payload": {...}},
  "max_retries": 3,
  "idempotency_key": "reminder_user123_A"
}
→ 201 { "job_id": "j_456", "next_run_at": "..." }

DELETE /v1/jobs/{id}          -- cancel
PATCH  /v1/jobs/{id}          -- reschedule
GET    /v1/jobs/{id}          -- status: scheduled | firing | succeeded | failed | cancelled
```

### Data model

Two different access patterns need two different structures:

- **Job definitions** (sharded relational, e.g., sharded Postgres or a distributed SQL like CockroachDB/Vitess): `job_id (PK), owner_id, cron_expr, action_json, max_retries, status, created_at`. This is the source of truth, needs ACID for create/cancel/update, sharded by `job_id` hash or `owner_id` for even distribution.
- **Time-bucketed schedule index** (this is the key design decision): rather than querying job definitions by time, maintain a **time-wheel / bucketed index** in Redis or a dedicated scheduling store: keys like `schedule:bucket:{minute_timestamp}` → sorted set of `job_id`s due in that minute, score = exact due second. A background dispatcher only ever reads the *current* bucket(s), never scans the whole job table.
- Recurring jobs store their cron expression once in the job definition; after each fire, the dispatcher computes the next occurrence and re-inserts a single new entry into the future bucket — recurring jobs never live as "N future rows," only ever one pending entry at a time.

### High-Level Design

```
                     ┌───────────────┐
  Client/Service ──▶ │  Scheduler API │──▶ writes job def (Postgres, sharded)
                     └───────┬───────┘     + inserts into time-bucket index (Redis)
                             │
                    ┌────────▼─────────────────────────┐
                    │  Time-Bucket Index (Redis Cluster) │
                    │  bucket:2026-08-25T09:00 → {job_ids}│
                    └────────┬────────────────────────┘
                             │  every few seconds, each of N Dispatcher
                             │  nodes claims a shard of "current + past-due" buckets
                    ┌────────▼─────────┐
                    │  Dispatcher pool  │ -- distributed lock per bucket-shard
                    │  (leader-election  │    (avoid double-processing)
                    │   per shard, via   │
                    │   Redis/ZK lease)  │
                    └────────┬─────────┘
                             │ for each due job: mark "firing", enqueue to Kafka
                             ▼
                    ┌───────────────────┐
                    │ Kafka: job-fire    │
                    │ topic               │
                    └────────┬───────────┘
                             ▼
                    ┌───────────────────┐
                    │ Executor workers    │──▶ call webhook / invoke task,
                    │ (retry+backoff)     │     update job status in Postgres,
                    └───────────────────┘     re-insert next occurrence if recurring
```

**Request flow:** creating a job writes the durable definition to sharded Postgres and computes its due-bucket key (rounded to the minute), pushing `job_id` into that bucket's sorted set in Redis with the exact second as score. A pool of dispatcher processes each own a partition of buckets (consistent hashing over bucket keys, similar to how Kafka consumer groups own partitions) and, every couple seconds, pop due entries (score ≤ now) from their owned buckets using `ZRANGEBYSCORE` + `ZREM` inside a Lua script for atomicity. Due jobs are pushed to a Kafka `job-fire` topic; executor workers consume, perform the actual action (HTTP call, enqueue), record success/failure, and — for recurring jobs — compute the next `run_at` and write a fresh bucket entry.

### Deep Dive

**1. Avoiding the thundering herd / hot-bucket problem.** If everyone schedules "reminder at 9:00:00am," a naive per-minute bucket holding all of them creates a spike that one dispatcher node can't drain in time. Two mitigations: (a) buckets are further sub-partitioned by a hash of `job_id` (e.g., 16 sub-shards per minute-bucket) so multiple dispatcher nodes pull from the same logical minute in parallel; (b) the dispatch loop pulls in small batches (e.g., 500 at a time) and immediately hands off to Kafka rather than processing inline, so "popping the due set" is fast and decoupled from "doing the work," which is exactly the async-system pattern — the scheduler's job is precise triggering, not slow execution.

**2. Exactly-once-ish firing under dispatcher crash/failover.** The atomic Lua script (check score ≤ now, remove from sorted set, return job_id) means once a dispatcher pops a job, it's no longer visible to any other dispatcher — but if that dispatcher crashes *after* popping and *before* successfully publishing to Kafka, the job is lost from the schedule index entirely. The fix: instead of a bare pop, use a **claim-with-lease** pattern — move the job atomically into an "in-flight" sorted set with a lease expiry (e.g., 30s) instead of deleting it outright; only remove it from in-flight once Kafka publish is acked. A separate reaper periodically re-queues in-flight entries whose lease has expired (dispatcher presumed dead) back into the due bucket. This bounds duplicate firing to "at most once per lease timeout on dispatcher crash," which combined with idempotency keys on the executor side gets effective at-least-once with rare, harmless duplicates — never job loss.

### Scaling the design

- Redis Cluster shards the time-bucket index by bucket-key hash; horizontal scale by adding shards, since buckets are naturally independent of each other.
- Dispatcher pool scales like a consumer group — add nodes, rebalance bucket-shard ownership (via a coordination service or consistent hashing with periodic re-announce, e.g., etcd leases).
- Job-definition store (Postgres) scales by sharding on `owner_id`, since almost all reads/writes are per-owner (create/cancel/list-my-jobs); the schedule index, not the definition store, handles the "what's due now" query path, so the definition store never needs a time-range index for hot-path dispatch.

### Failure handling

- Dispatcher node crash mid-lease → reaper re-queues after lease expiry; jobs fire late (bounded by lease timeout, e.g., up to 30-60s) but not lost.
- Kafka/executor outage → job-fire messages queue durably in Kafka; jobs still "fire" from the scheduler's perspective on time, execution is just delayed until executors recover — status stays "firing" until an executor confirms, with an alert if that state persists too long.
- Redis cluster node loss → bucket data for that shard's near-future jobs could be lost if not replicated; mitigate with Redis replication (primary+replica per shard) and treat Postgres job-definition table as the recovery source — a periodic reconciliation job can rebuild missing near-term bucket entries from the definitions table for jobs due in the next hour, as a safety net.

### Trade-offs

- **Time-bucketed index vs. a straightforward `WHERE due_at <= now` query with a good index**: the bucketed approach is more moving parts, but avoids the classic scaling wall where a growing jobs table makes range-scans progressively slower and creates lock contention on hot recent rows; it's the right call specifically because the estimated scale (100M+ jobs) makes naive polling untenable.
- **Separate "trigger" (scheduler) and "execute" (Kafka + workers) responsibilities**: keeps the scheduler simple and fast, at the cost of an extra hop — worth it because execution can be slow/unreliable (webhooks) while triggering must stay precise.
- **Lease-based claim vs. simple distributed lock per job**: leases scale far better (one lock per bucket-shard, not per job) but accept a small late-firing window on crash, which is the right trade for a scheduler where "a few seconds late" is fine but "silently never fired" is not.

---

# 4. Webhook Delivery Platform
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- Let tenants register a URL to receive event notifications (e.g., "payment.completed").
- Deliver events to registered URLs reliably: at-least-once delivery.
- Retry failed deliveries with exponential backoff over a bounded window (e.g., up to 24h).
- Sign each payload (HMAC) so receivers can verify authenticity.
- Dead-letter events that exhaust retries, and let tenants inspect/replay them.
- Per-tenant delivery logs and success-rate dashboards.

**Non-functional**
- One slow/broken tenant endpoint must not delay delivery to other tenants (isolation).
- Ordered delivery *per resource* is nice-to-have but not guaranteed globally (explicitly scope the guarantee).
- Delivery p95 < 2s for healthy endpoints.
- Scale to hundreds of thousands of registered endpoints and tens of millions of events/day.

### Scale/Capacity estimation

- 500k registered webhook endpoints across tenants; average tenant subscribes to 3 event types.
- Source events: 50M business events/day (e.g., a mid-size payments platform) → ~580/sec average, peak 5x → ~3,000/sec.
- Each event may fan out to multiple subscribed endpoints (avg fan-out factor 1.5) → ~4,500 delivery attempts/sec at peak, before counting retries.
- Assume 5% of deliveries fail on first attempt (flaky endpoints) needing retry → adds ~225/sec of retry traffic, spread out over the backoff schedule so it doesn't spike simultaneously.
- Delivery log record ~1KB, 50M×1.5 ≈ 75M rows/day ≈ 75GB/day — retained ~30 days hot for replay/debugging, then archived.

### API design

```
# Tenant-facing (management)
POST /v1/endpoints
{ "url": "https://tenant.com/hook", "events": ["payment.completed"], "secret": "auto-generated" }
→ { "endpoint_id": "ep_1", "secret": "whsec_..." }

GET  /v1/endpoints/{id}/deliveries?status=failed
POST /v1/deliveries/{id}/replay

# Internal (event producers call this, not the tenant)
POST /internal/v1/events
{ "event_type": "payment.completed", "tenant_id": "t_1", "data": {...}, "event_id": "evt_9" }

# Outbound to tenant endpoint (what we send)
POST https://tenant.com/hook
Headers: X-Webhook-Signature: hmac-sha256=..., X-Webhook-Id: evt_9, X-Webhook-Timestamp: ...
Body: {"event_type":"payment.completed","data":{...}}
```

`event_id` from the producer is the idempotency key receivers use to dedupe on their end — this is a
first-class part of the contract, not an implementation detail, since at-least-once delivery
guarantees the receiver *will* see duplicates eventually.

### Data model

- **Endpoints** (Postgres): `endpoint_id, tenant_id, url, secret_hash, subscribed_events[], status(active/disabled)`. Relational, low volume, needs consistency for tenant config.
- **Delivery attempts** (Cassandra/DynamoDB, partitioned by `endpoint_id`): `delivery_id, event_id, endpoint_id, attempt_number, status, response_code, attempted_at, next_retry_at`. High write volume, queried mostly by endpoint (for a tenant's dashboard) or by event_id (for tracing) — wide-column store with a secondary index or a duplicated table keyed by event_id for the reverse lookup.
- **Dead-letter store**: same shape as delivery attempts but `status=dead_lettered`, plus the full original payload retained (in blob storage if large) so a replay can reconstruct the exact original request.

### High-Level Design

```
 Internal producers ──▶ [Event Ingest API] ──▶ [Kafka: events topic, partitioned by tenant_id]
                                                          │
                                                          ▼
                                            [Fan-out Worker] -- looks up subscribed
                                             endpoints per event_type/tenant, writes
                                             one "delivery task" per endpoint
                                                          │
                                                          ▼
                                      [Kafka: delivery-tasks topic, partitioned by endpoint_id]
                                                          │
                                        ┌─────────────────┼──────────────────┐
                                        ▼                 ▼                  ▼
                                 [Delivery Worker Pool -- one logical queue per endpoint,
                                  HTTP POST + HMAC sign, timeout ~5s]
                                        │
                          success ──────┴────── failure
                             │                      │
                             ▼                      ▼
                    mark delivered            schedule retry via
                    write to log              Job Scheduler (see #3) w/
                                               exponential backoff + jitter
                                                      │
                                          exhausted retries (e.g., after 15
                                          attempts / 24h) ──▶ Dead Letter Store
                                                                     │
                                                            tenant dashboard / replay API
```

**Request flow:** a producing service posts an event to the internal ingest API, which durably publishes to a Kafka `events` topic partitioned by `tenant_id` (keeps a tenant's events roughly ordered without creating one giant partition for the whole platform). A fan-out worker consumes each event, looks up which endpoints are subscribed to that event type for that tenant, and emits one delivery task per endpoint onto a second topic partitioned by `endpoint_id` — this partitioning choice is deliberate: it means all tasks for one flaky endpoint land on the same partition, so a slow/broken endpoint backs up *its own* partition without head-of-line-blocking other tenants' partitions. Delivery workers pull tasks, sign the payload with the endpoint's HMAC secret, POST with a short timeout, and on failure schedule a retry using the same time-bucketed scheduler pattern from the Job Scheduler design (exponential backoff: 1m, 5m, 30m, 2h, 6h, 24h with jitter) rather than reinventing retry scheduling.

### Deep Dive

**1. Endpoint isolation ("noisy neighbor" problem).** With naive partitioning by event or by tenant only, one tenant with a permanently-broken endpoint would flood retries into shared infrastructure or, worse, if partitioned by tenant, a single tenant with two endpoints — one healthy, one broken — could have the broken one's retries crowd out the healthy one's fresh deliveries on the same partition/worker. Partitioning delivery tasks by `endpoint_id` solves the cross-tenant case cleanly. Within a single endpoint, we still need per-endpoint concurrency limits and circuit breaking: track a rolling failure rate per endpoint; if it exceeds a threshold (e.g., >50% failures over 5 minutes), flip the endpoint to a "degraading" state — extend its backoff floor and cap concurrent in-flight attempts to 1, rather than continuing to hammer a dead server at full worker concurrency. This protects our own worker pool capacity from being consumed by endpoints that are simply down.

**2. At-least-once delivery, ordering, and idempotency contract.** We only promise **per-resource ordering** (e.g., all events for `order_123` arrive in order) by keying Kafka partitions on a resource ID when relevant, never global ordering across all events (that would force a single partition and kill throughput). At-least-once means retries can create duplicates — the platform makes this explicit and easy to handle by attaching a stable `event_id` to every delivery and documenting "dedupe on event_id" as the integration contract, rather than trying to build exactly-once delivery over HTTP, which is not achievable end-to-end anyway (the receiver's ack itself can be lost after they've processed it). Signature verification (`X-Webhook-Signature`) additionally protects against payload tampering and lets receivers reject replayed/forged requests from anyone but us.

### Scaling the design

- Kafka partition count for `delivery-tasks` sized generously (e.g., 256+) since it's keyed by endpoint_id and we want many endpoints to spread across workers; consumer group size scales with partition count.
- Delivery workers are stateless and scale horizontally; the bottleneck is typically outbound HTTP concurrency and DNS/connection overhead to thousands of distinct hosts — mitigate with connection pooling per endpoint host and aggressive timeouts (5s) so one slow endpoint doesn't tie up a worker thread for long.
- Retry scheduling reuses the Job Scheduler's time-bucket index rather than a bespoke mechanism — this is the "combine building blocks" insight the framing question is testing for: a webhook retry is just a scheduled job with a payload.

### Failure handling

- Kafka broker/partition unavailable → producer-side retries with backoff at the ingest API; events are not accepted (503) until durably written, so producers know to retry rather than assuming success.
- Delivery worker crash mid-attempt → Kafka offset not committed until the HTTP call result (success or scheduled-retry) is durably recorded, so a crash simply causes reprocessing of that task (potential duplicate delivery — acceptable per the at-least-once contract).
- Dead-letter volume spike (e.g., a popular tenant's endpoint goes down for hours) → alert on dead-letter rate per tenant; tenant dashboard shows the failures in near-real-time so they can fix their endpoint and use the replay API rather than us silently losing their events.

### Trade-offs

- **At-least-once + documented dedupe contract vs. attempting exactly-once**: exactly-once webhook delivery is not achievable over an unreliable network with an external receiver anyway (the classic two-generals problem) — codifying at-least-once and pushing dedupe to the receiver via `event_id` is more honest and simpler than pretending otherwise.
- **Per-endpoint partitioning vs. per-event-type partitioning**: better isolation, worse "fan-out simplicity" (fan-out worker must explicitly map event→endpoints rather than relying on topic structure) — isolation wins because a broken customer endpoint is the single most common real-world failure mode for this system.
- **Reusing the Job Scheduler for retries vs. an in-process retry queue**: adds a cross-system dependency, but avoids duplicating precise-timing infrastructure and gets crash-safety "for free" — the right call once you already have a scheduler as a platform primitive.

---

# 5. Chat / WhatsApp-style Messaging
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- 1:1 and group messaging (groups up to a few hundred members).
- Delivery receipts (sent → delivered → read) per message per recipient.
- Offline delivery: messages sent while a user is offline are delivered when they reconnect.
- Media messages (images/video) via reference, not inline blob.
- Multi-device: a user can be logged in on phone + web simultaneously, message state stays consistent.

**Non-functional**
- Message delivery latency p95 < 500ms when both parties online.
- Support tens of millions of concurrent WebSocket connections.
- Messages must not be lost even if a server crashes mid-delivery.
- Ordering: messages within a single conversation appear in a consistent order to all participants.

### Scale/Capacity estimation

- 200M MAU, 20M concurrent connections at peak (10% concurrency — realistic for a global chat app across time zones).
- Average 40 messages sent per active user per day → 200M × 40 = 8B messages/day ≈ 92,600 msg/sec average, peak 3x ≈ 280k msg/sec.
- Each connection server (commodity box) can hold ~50k-100k concurrent WebSocket connections (memory-bound, ~10-20KB per connection incl. buffers) → 20M connections / 75k per box ≈ 270 connection servers.
- Message row ~500 bytes (sender, recipient/group, ciphertext, timestamps) → 8B/day × 500B = 4TB/day raw message storage — needs a write-optimized, horizontally-shardable store, not a single Postgres instance.

### API design

Primarily a persistent protocol (WebSocket) plus REST for history/setup:

```
WS connect: wss://chat.example.com/v1/connect?token=...
Client → Server (over WS):
{ "type": "send", "client_msg_id": "uuid", "to": "user_456" or "group_789", "body": {...enc...} }
Server → Client:
{ "type": "message", "msg_id": "m_1", "from": "user_123", "body": {...}, "server_ts": ... }
{ "type": "ack", "client_msg_id": "uuid", "msg_id": "m_1", "status": "sent" }
{ "type": "receipt", "msg_id": "m_1", "status": "delivered"|"read", "by": "user_456" }

REST (for history, not real-time):
GET /v1/conversations/{id}/messages?before=m_1&limit=50
POST /v1/conversations/{id}/read  { "up_to_msg_id": "m_50" }
```

`client_msg_id` is generated client-side so sends are idempotent across retries (e.g., client
resends if it doesn't get an ack within a timeout).

### Data model

- **Message store**: Cassandra/ScyllaDB, partitioned by `conversation_id`, clustered by `message_id` (time-ordered, e.g., Snowflake/ULID so IDs sort chronologically). Chosen over relational because writes are append-only, extremely high volume, and the dominant query ("give me the last 50 messages in this conversation") is a perfect clustered-column range scan — exactly Cassandra's sweet spot, and it shards horizontally without the operational pain of manually sharding Postgres at this volume.
- **Conversation/membership metadata** (Postgres or a KV store): `conversation_id, member_ids[], type(1:1/group), last_message_id`. Lower volume, benefits from stronger consistency for membership changes (add/remove from group).
- **Per-user connection registry** (Redis): `user_id → {server_id, connection_id}` for each active device connection — this is how the system knows *which connection server* to route a message to for delivery.
- **Offline/undelivered queue**: a per-user Cassandra table or Redis list of message IDs not yet acked as delivered, drained on reconnect.

### High-Level Design

```
                     ┌───────────────────────────────────────┐
   Client A ───WS───▶│      Connection Server (Gateway) A      │
                     └───────────────┬─────────────────────────┘
                                     │ 1. lookup recipient's connection
                                     │    via Redis registry
                                     ▼
                     ┌───────────────────────────────────────┐
                     │   Redis: user_id → {server_id, conn_id} │
                     └───────────────┬─────────────────────────┘
              recipient online, on Server B         recipient offline
                                     │                        │
                                     ▼                        ▼
                     ┌─────────────────────────┐   ┌─────────────────────┐
                     │  Message Router / Kafka   │   │ Write to Message    │
                     │  (server-to-server via     │   │ Store + Offline     │
                     │   pub/sub or direct RPC)   │   │ Queue, push          │
                     └───────────────┬───────────┘   │ notification (APNs) │
                                     ▼                └─────────────────────┘
                     ┌───────────────────────────────────────┐
                     │      Connection Server (Gateway) B      │──WS──▶ Client B
                     └─────────────────────────────────────────┘
                                     │
                                     ▼
                     [Message Store: Cassandra, partition=conversation_id]
                     [also durably written here BEFORE ack to sender — durability first]
```

**Request flow:** Client A sends a message over its WebSocket to whichever connection server it's attached to. That server first **durably writes the message** to the Cassandra message store (this happens before anything else — durability is not contingent on the recipient being online) and returns a `sent` ack to A with the server-assigned `msg_id`. It then looks up the recipient's current connection location in the Redis registry. If B is online (possibly on a *different* connection server, which is the common case at this scale), the message is routed server-to-server — either via a lightweight internal pub/sub (Redis Pub/Sub or a dedicated routing layer) or by publishing to a per-server Kafka topic — to Gateway B, which pushes it down B's WebSocket and later relays B's `delivered` receipt back through the same path to A. If B is offline, the message sits in the message store (already durable) and an offline-queue entry plus a push notification (via the Notification Platform, #1) is generated; on B's next connect, the client fetches undelivered messages via the REST history endpoint using its last-seen `msg_id` as a cursor.

### Deep Dive

**1. Connection management at scale — the routing problem.** With 270 connection servers and 20M live sockets, "how does server A know which server holds user B's socket" is the central hard problem, not the WebSocket handling itself (that part is a solved problem via any async I/O framework). The Redis registry (`user_id → server_id`) is the answer, but it must handle: (a) **multi-device** — a user can have 2-3 simultaneous connections (phone, web, desktop), so the value is actually a set of `{device_id, server_id, conn_id}`, and a send fans out to all of them; (b) **staleness on crash** — if a connection server crashes without deregistering its sockets, the registry has stale entries; mitigate with a short TTL/heartbeat (each connection server refreshes its entries every ~15s) so stale entries expire quickly, combined with the sender simply getting a failed-route and falling back to offline delivery, which is self-healing rather than requiring perfect registry accuracy; (c) **registry as a scaling bottleneck** — at 20M connections with heartbeat refresh, that's meaningful Redis write QPS, so the registry itself is sharded (Redis Cluster) by `user_id` hash.

**2. Ordering and multi-device consistency.** Within one conversation, message order must look the same to every participant regardless of which server handled which message. Using a globally sortable ID scheme (e.g., a Snowflake ID or a per-conversation monotonic counter assigned at write time by the message store, not by the client) ensures the write path itself defines the canonical order — clients then simply render messages sorted by `msg_id`, and clock skew across connection servers never becomes an ordering bug because we never rely on wall-clock timestamps as the sort key. For multi-device read-state, "read up to msg_id X" is stored per-device but the group/conversation UI typically shows the max across a user's devices — a design choice to surface, not a hard requirement, and worth stating explicitly as a scoped decision in an interview.

### Scaling the design

- Connection servers scale horizontally and are the most elastic tier — autoscale on concurrent-connection count, not CPU, since the bottleneck is memory/file-descriptors per box.
- Message store (Cassandra) scales by adding nodes and relies on `conversation_id` as partition key — the risk is a "hot partition" for extremely large groups (thousands of members all posting); mitigate by bucketing very large group conversations into time-sliced sub-partitions (`conversation_id + day`) so a single partition doesn't grow unbounded.
- Redis registry shards by `user_id`; scale by adding shards, since lookups are always by a known user_id with no cross-shard queries needed.

### Failure handling

- Connection server crash → all its sockets drop; affected clients' apps auto-reconnect (standard mobile chat client behavior) to a new server via the load balancer, re-register in Redis, and pull any missed messages via the offline-queue/history cursor — no message loss because writes were durable before any delivery attempt.
- Cassandra node loss → tolerated via replication factor 3 and quorum writes; a full replica-set outage for a partition is the only real message-loss scenario, mitigated by cross-AZ replica placement.
- Redis registry unavailable → sends can't find the recipient's live connection and fall back to "treat as offline" (queue + push notification) — degraded (higher latency, no realtime delivery) but not lossy, which is the right failure mode to design for.

### Trade-offs

- **Durable write before ack vs. ack-then-persist-async**: costs a bit of latency (one write to Cassandra in the critical path) but guarantees "sent" never lies to the user — chosen because message loss is the single least acceptable failure mode for a chat product.
- **Server-to-server routing via registry lookup vs. broadcast/flood to all servers**: registry lookup is more complex to build but scales to millions of connections; broadcasting every message to all 270 servers would be wasteful and doesn't scale past a much smaller cluster size.
- **Cassandra for message store vs. sharded Postgres**: Cassandra chosen for write throughput and natural horizontal scaling of an append-mostly, partition-key-accessed workload; loses easy secondary-index/ad hoc query flexibility that Postgres would give, which is an acceptable trade since chat history access patterns are narrow and well-known in advance.

---

# 6. Presence System
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- Track each user's online/offline/away/typing state.
- Let a client subscribe to presence updates for a specific set of other users (e.g., "my contacts" or "members of this group") and get near-real-time updates.
- Typing indicators, scoped to a specific conversation, auto-expiring.
- "Last seen" timestamp for offline users.

**Non-functional**
- This is a **fan-out-dominated** system, not a storage-dominated one — the hard constraint is update propagation volume, not data size.
- Presence updates should reach interested subscribers within ~1-2 seconds.
- Must tolerate extremely high update churn (every reconnect, every typing keystroke debounce) without melting the backend.
- Approximate correctness is acceptable (a presence system that's occasionally a few seconds stale is fine; one that falls over under load is not).

### Scale/Capacity estimation

This is where the "deceptively hard" fan-out problem lives — walk through it with real numbers.

- 20M concurrent online users (same order as the chat system above, since presence rides alongside chat).
- Each user has, on average, 150 contacts/group-mates interested in their presence (a typical social graph fan-out).
- **Naive approach cost**: every state change (online/offline/typing) broadcast individually to every interested party. If even 5% of the 20M online users change state per minute (connect, disconnect, start typing) — that's 1M state changes/minute — each fanning out to 150 subscribers = **150M presence messages/minute ≈ 2.5M/sec**. This number is the whole point of the design: naive pub/sub-to-everyone does not survive contact with this fan-out multiplier, and an interview answer that doesn't produce this number hasn't found the hard part yet.
- Typing indicators are the worst offender: a user typing generates an event roughly every 2-3 keystrokes if sent naively — must be **debounced client-side** (send "typing" at most once per 3-5s while actively typing, plus one "stopped" event) before it ever reaches the backend, cutting volume by ~10-20x before the fan-out problem even starts.

### API design

```
WS (same connection as chat, multiplexed):
Client → Server: { "type": "presence.subscribe", "user_ids": ["u1","u2",...] }  // e.g., visible contacts
Client → Server: { "type": "typing", "conversation_id": "c1", "state": "start"|"stop" }
Server → Client: { "type": "presence.update", "user_id": "u1", "state": "online"|"offline", "last_seen": ... }
Server → Client: { "type": "typing.update", "conversation_id": "c1", "user_id": "u1", "state": "start" }

REST (fallback / initial load):
GET /v1/presence?user_ids=u1,u2,u3   → bulk current-state snapshot
```

Subscriptions are explicit and scoped (a client only subscribes to presence for users currently
visible in its UI — the open conversation list — not its entire 150-contact graph at once), which is
itself a major fan-out mitigation baked into the API contract.

### Data model

- **Current presence state**: Redis, `user_id → {state, last_seen, updated_at}` with a short TTL (e.g., 60-90s) — presence is inherently ephemeral, so a TTL-based store is a natural fit: if a connection server crashes without sending an explicit "offline" event, the key simply expires and the user is correctly inferred offline within the TTL window, which is a much simpler correctness story than trying to reliably detect every disconnect.
- **Subscription graph** (who's watching whom): held in-memory on connection servers, keyed by connection, not in a shared DB — a subscription is a live, connection-scoped fact ("this open WebSocket wants updates for these 20 users right now"), so it doesn't need durability at all; it's rebuilt on reconnect.
- No long-term historical presence storage needed beyond "last_seen" (one timestamp per user, can live in the same Redis hash or the main user profile store).

### High-Level Design

```
 Client ──WS──▶ [Connection Server] ── on connect: SET presence:u1 online, TTL 90s
                        │                on disconnect/heartbeat-miss: eventually TTL-expires
                        │
                        ▼ subscribe request: user_ids=[u2,u3,...]
              [Local subscription table: connection → watched user_ids]
                        │
                        ▼
        ┌───────────────────────────────────────────┐
        │   Presence Pub/Sub layer (Redis Pub/Sub or   │
        │   a lightweight internal broker), topic per   │
        │   user_id: "presence:u2" etc.                  │
        └───────────────────────┬───────────────────────┘
                                 │ state change for u2 published once
                 ┌───────────────┼────────────────┐
                 ▼                ▼                ▼
        [Conn Server A]   [Conn Server B]   [Conn Server C]
        (has 40 subs      (has 12 subs      (has 0 subs
         for u2 → fans     for u2 → fans     for u2 → drops,
         out locally)      out locally)      not subscribed)
```

**Request flow:** on connect, a client subscribes only to the presence of currently-relevant users (visible chat list). The connection server keeps this subscription set **locally in memory** and additionally subscribes, on behalf of its aggregate set of watched users, to a pub/sub channel per watched user (or a sharded set of channels if per-user channels are too many — see deep dive). When any user's state changes (connect, disconnect, TTL expiry, typing start/stop), exactly **one** publish happens to that user's presence channel; every connection server currently subscribed to it (because at least one of its local clients cares) receives that single message and fans it out only to its own locally-interested connections. This two-level fan-out — one global publish per state change, then local redistribution per connection server — is what keeps the 2.5M/sec naive number from ever materializing as actual cross-network fan-out at that multiplier.

### Deep Dive

**1. The fan-out problem, solved properly.** The naive mistake is fanning out at the *event* level directly to every *subscriber connection* from a central point — that's O(subscribers) work per event, done centrally, at 2.5M/sec-equivalent scale. The fix restructures fan-out into two cheaper stages: **(a) interest aggregation at the edge** — each connection server subscribes to a pub/sub topic for a given watched user *once*, regardless of how many of its local connections care about that user (a popular user watched by 5,000 people spread across 270 connection servers generates at most 270 subscriptions to their channel, not 5,000); **(b) local multicast** — when a connection server receives one pub/sub message, it looks up its local in-memory subscriber list for that user_id and pushes to each of those sockets directly, in-process, which is cheap (no network hop per subscriber). This turns "O(total subscribers) network messages per state change" into "O(distinct connection servers with an interested client) network messages, then O(local subscribers) in-process pushes" — for a viral user watched broadly, this is a ~1000x reduction (270 vs 5,000+) in cross-network fan-out traffic, and for the typical low-fan-out user it's simply cheap either way.

**2. Debouncing and coalescing to cut volume before it starts.** Beyond typing-indicator client-side debounce, presence state changes themselves are coalesced: a flaky connection that drops and reconnects within a few seconds (common on mobile, e.g., switching from WiFi to cellular) should **not** cause an "offline" then "online" flicker to every subscriber. The connection server delays publishing an "offline" transition by a short grace period (e.g., 5-10s) and cancels it if the user reconnects within that window — this single mechanism eliminates a large fraction of real-world presence churn, since brief reconnects are far more common than genuine session ends. Combined with the TTL-based expiry (rather than relying on explicit disconnect events, which can be missed on ungraceful termination), the system favors **eventual, approximately-correct presence over perfectly real-time, expensively-precise presence** — a deliberate and defensible choice given the non-functional requirement above.

### Scaling the design

- Pub/sub layer shards by user_id hash across a Redis Cluster (or a purpose-built broker) — each shard only handles publishes/subscriptions for its slice of users, so total throughput scales linearly with shard count.
- Connection servers cap the number of distinct users they'll maintain a live subscription for in aggregate (with LRU eviction of least-recently-viewed) as a safety valve against pathological clients that try to watch huge sets.
- For "who's online in this group of 10,000 members" style queries (not just 1:1 contact presence), don't use the per-user pub/sub path at all — serve from the Redis current-state hash with a bulk multi-get, since polling a bounded snapshot is cheaper than push fan-out for very large group presence views.

### Failure handling

- Connection server crash → its local subscriptions vanish (in-memory, not durable) but clients reconnect elsewhere and resubscribe — presence subscriptions are treated as soft state by design, so this is a non-event operationally, just a brief gap in updates for affected clients.
- Redis pub/sub shard down → publishes/subscriptions for its slice of users fail silently (pub/sub has no delivery guarantee/replay by nature) — acceptable given presence's approximate-correctness requirement; the TTL-based current-state hash (if on a separately-replicated Redis) still lets clients get correct state via the bulk-fetch fallback even if real-time push is briefly degraded.
- Thundering reconnect after a regional outage (mass reconnect storm) → connection servers rate-limit their own outbound "online" publishes per second and coalesce bursts, since a synchronized mass-reconnect is exactly the pathological case the debounce/coalesce logic above needs to survive.

### Trade-offs

- **Two-level fan-out (global publish + local multicast) vs. a simple central pub/sub broadcast to all subscriber connections**: more architectural complexity (connection servers must track and deduplicate their own subscription interest) but is the difference between a system that scales to tens of millions of users and one that doesn't — this is the crux insight to state explicitly in an interview.
- **TTL/heartbeat-based liveness vs. explicit disconnect detection**: simpler and self-healing under ungraceful failures, at the cost of a bounded "offline" detection delay (up to the TTL window) — a good trade since presence exactness isn't required.
- **Approximate/eventually-consistent presence vs. strongly consistent**: deliberately chosen; a strongly consistent presence system would require coordination overhead completely disproportionate to the value of a feature where "online 2 seconds ago" is functionally identical to "online now" for the end user.

---

# 7. Live Location (Uber-style)
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- Driver app streams GPS coordinates every few seconds while on a trip or available.
- Rider app sees the driver's live position on a map, updating smoothly.
- Support ETA computation and matching nearby drivers to a rider request (geospatial "who is near X" query).
- Historical trip path storage for receipts/support/fraud review.

**Non-functional**
- Location updates must reach the interested rider within ~1-2 seconds of the driver's device sending them.
- Must support millions of concurrently active drivers reporting continuously.
- Bandwidth/battery-conscious on the driver side (mobile network, battery life matter).
- Geospatial proximity queries ("drivers within 3km") must be fast (sub-100ms) to support real-time matching.

### Scale/Capacity estimation

- 5M concurrently active drivers globally (subset of a larger driver base) reporting location every 4 seconds → 5M / 4 = 1.25M location updates/sec.
- Each update payload ~100 bytes (lat, lng, heading, speed, driver_id, timestamp) → 1.25M × 100B = 125 MB/sec ingest.
- A typical trip lasts ~15 minutes = 225 location pings per trip; historical path storage at, say, 20M trips/day × 225 pings × 100 bytes ≈ 450 GB/day of raw path history — needs cheap storage, not a hot query path (only accessed for receipts/support, rarely).
- Live "current position" state, by contrast, is tiny per driver (one row/key each) but needs extremely fast read/write and geospatial indexing — 5M drivers × ~200 bytes ≈ 1GB, easily an in-memory structure, not a disk-oriented DB.
- This split — **tiny, hot, geo-indexed "current state"** vs. **large, cold, append-only "history"** — is the central data-model decision for this whole system.

### API design

```
Driver app → Server (frequent, lightweight, over a persistent connection or efficient short-poll):
POST /v1/location/ping   (or WS message)
{ "driver_id": "d1", "lat":..., "lng":..., "heading":..., "speed":..., "ts":... }

Rider app → Server:
GET /v1/trips/{trip_id}/driver-location    (initial fetch)
WS subscribe: { "type":"track", "trip_id": "t1" }  → stream of driver position updates

Matching service (internal):
GET /internal/v1/nearby-drivers?lat=..&lng=..&radius_km=3&limit=20
```

Driver pings are intentionally *not* a rich synchronous request/response API — they're a fire-and-
forget stream, because the driver doesn't need per-ping acknowledgment beyond basic delivery
confirmation, and minimizing round-trip chatter matters for battery/bandwidth.

### Data model

- **Current position (hot)**: an in-memory geospatial store — Redis with `GEOADD`/`GEOSEARCH` (geohash-based sorted sets under the hood), keyed by a driver-state hash: `driver:{id} → {lat, lng, heading, ts}` plus membership in a `GEO` index for proximity queries. Chosen specifically because Redis's geo commands give sub-millisecond "nearby" queries against millions of points without standing up a dedicated geospatial database for what is fundamentally ephemeral, constantly-overwritten state.
- **Trip path history (cold)**: append-only, written to a wide-column store (Cassandra) or even directly batched to object storage as compressed per-trip files, partitioned by `trip_id`. Never queried in the hot path — only pulled for a support ticket or receipt map render, so optimizing for cheap storage over query speed is correct here.
- **Trip metadata** (Postgres): `trip_id, driver_id, rider_id, status, start/end location, fare`. Needs transactional consistency (payment/status transitions), low volume relative to location pings.

### High-Level Design

```
[Driver App] --ping every ~4s--▶ [Location Ingest Gateway (stateless, regional)]
                                          │
                          ┌───────────────┼───────────────────┐
                          ▼                                    ▼
              [Redis Geo: current position]        [Kafka: location-history topic]
              GEOADD driver_geo lng lat driver_id            │
              HSET driver:{id} {lat,lng,heading,ts}          ▼
                          │                        [History Writer] → batch-write
                          │                          to Cassandra/S3 (cold, per trip_id)
                          ▼
        ┌─────────────────────────────────┐
        │  Matching Service                  │── GEOSEARCH driver_geo
        │  ("nearby drivers for rider req")   │   BYRADIUS 3km → candidate list
        └─────────────────────────────────┘
                          
        ┌─────────────────────────────────┐
        │  Trip Tracking Service             │── on rider subscribe, poll/subscribe
        │  (pushes driver pos to rider)       │   Redis for driver's current pos,
        └─────────────────┬─────────────────┘   push via WS to rider at ~1s cadence
                           ▼
                     [Rider App] (map updates)
```

**Request flow:** the driver app pings its location roughly every 4 seconds to a regionally-local ingest gateway (regional to minimize latency — location data is inherently local, no need to round-trip to a single global region). The gateway does two things per ping: (1) synchronously updates the driver's current-position entry in Redis (both the geo index for proximity search and a plain hash for direct lookup), which is the fast, hot-path write that everything real-time depends on; (2) asynchronously publishes the raw ping to Kafka for durable history, decoupled from the hot path so history-writing backpressure never slows down live tracking. For matching, the rider-request service performs a `GEOSEARCH` against the Redis geo index to find candidate drivers within a radius, ranks them (distance, ETA, driver rating/acceptance), and dispatches a request. Once a trip is active, the rider's app subscribes (via WebSocket, similar to the chat/presence connection layer) to that specific driver's position; the tracking service reads the driver's current position from Redis on each update (or via Redis keyspace notifications for a more push-driven approach) and relays it to the subscribed rider at a smoothed cadence (~1/sec, even if pings arrive at a different rate, to keep the rider's map animation smooth without over-sending).

### Deep Dive

**1. Geospatial indexing choice and why Redis Geo over a general geospatial DB.** The "nearby drivers" query is on the critical path of ride matching and must be fast even with millions of drivers moving continuously — a workload that's 99% overwrite (update this driver's position) and frequent radius reads, with essentially zero need for complex geospatial predicates (polygons, geofences are a separate, lower-frequency concern handled elsewhere). Redis's `GEOADD`/`GEOSEARCH` (geohash + sorted set internally) gives O(log n) inserts and fast radius queries entirely in memory, which matches this access pattern far better than a disk-backed spatial index (e.g., PostGIS) designed for richer but less frequently-updated geospatial data. The trade is durability — Redis geo data is ephemeral by design here (a driver's position from 30 seconds ago is worthless anyway), so losing it on a crash just means "a driver briefly disappears from search results until their next ping re-adds them," which self-heals within one ping interval and is an acceptable failure mode given the 4-second refresh cadence.

**2. Smoothing/interpolation and update-rate mismatch between driver and rider.** If the driver pings every 4 seconds and the rider's map simply snaps to each new point, the marker visibly jumps — bad UX. The tracking service (or, more commonly, client-side logic fed by the same backend) interpolates between the last two known points over the update interval, animating the marker smoothly rather than teleporting it, using heading/speed fields from the ping to extrapolate a plausible path along roads (a simplified version of what a real system pairs with map-matching against road network data). This is a client-rendering concern more than a backend-scaling one, but it's worth naming explicitly in an interview because "why does the driver dot look janky" is exactly the kind of follow-up a staff-level interviewer probes — the backend's job is to deliver fresh, low-latency points; smooth *rendering* of sparse points is a separate, composable concern.

### Scaling the design

- Ingest gateways and Redis geo indices are sharded **regionally** (e.g., by city/metro area) — location and matching are inherently local, so there is no reason for a driver in São Paulo and a driver in Seattle to share a geo index shard; this regional sharding is the primary scaling lever and also reduces latency by keeping data close to where it's produced and consumed.
- Within a region, if a single Redis instance's geo index becomes a bottleneck (unlikely below several million points, but possible in a mega-city), further shard by a coarse geohash prefix (e.g., first 3-4 characters), routing pings and queries to the correct shard based on the ping's own coordinates.
- History writing (Kafka → Cassandra/S3) scales independently and trivially since it's pure append-only fan-out, decoupled entirely from the latency-sensitive live-tracking path.

### Failure handling

- Ingest gateway or Redis shard outage in a region → live tracking and new-trip matching degrade in that region (drivers temporarily invisible to matching) but existing trips continue (payment/trip state lives in Postgres, unaffected) — bounded, self-healing blast radius rather than a global outage.
- Driver app loses connectivity (tunnel, dead zone) → client buffers pings locally and flushes on reconnect with original timestamps preserved, so history remains accurate even though live tracking shows a gap (rider UI shows "driver's connection is unstable" rather than a silently frozen, stale marker).
- Kafka/history pipeline backlog → purely a historical-data concern, has zero impact on live matching or tracking since those never read from the history path — this isolation is a direct payoff of the hot/cold data-model split made earlier.

### Trade-offs

- **In-memory Redis geo index (fast, ephemeral) vs. a persistent geospatial database**: massively faster for the actual access pattern (continuous overwrite + radius search), at the cost of accepting ephemeral/best-effort durability for current position — correct trade because current position is inherently transient information.
- **Regional/city-based sharding vs. a single global geo index**: adds operational complexity (data locality, cross-region trip edge cases like airport transfers) but is necessary — a single global index would add useless latency and create a single point of contention for a problem that's naturally partitioned by geography.
- **Decoupled hot (live) and cold (history) paths via async Kafka fan-out vs. one unified write path**: extra moving parts, but ensures the two very different workloads (sub-second live tracking vs. bulk historical analytics) never contend with or throttle each other.

---

# 8. Collaborative Editing (OT vs CRDT)
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

### Requirements

**Functional**
- Multiple users edit the same document simultaneously; each sees others' edits appear live.
- Edits must converge: after all operations propagate, every client shows the identical final document.
- Support common operations: insert/delete text, and ideally richer structure (formatting, later comments) — scope this design to text for depth.
- Offline editing: a client can make changes while disconnected and merge cleanly on reconnect.
- Undo/redo that behaves intuitively even amid concurrent remote edits.

**Non-functional**
- Local edits must feel instant (no round-trip to server before the local cursor updates) — this is a hard latency requirement, not a nice-to-have.
- Convergence must be guaranteed, not probabilistic — no "sometimes documents diverge" is acceptable.
- Must scale to documents with long edit histories and many collaborators (dozens, occasionally hundreds, concurrently).
- Should be interview-discussable primarily at the concept/trade-off level — implementing a full OT or CRDT engine is its own multi-month project; the goal here is to reason about which approach fits which constraints.

### Scale/Capacity estimation

- A large but not extreme collaborative editor: 10M documents actively edited monthly, average 3 concurrent editors per active session, peak documents with 50-100 concurrent editors (a large shared doc).
- Average edit operation is tiny (a single character insert/delete, ~20-50 bytes including metadata like author/position/timestamp/vector-clock).
- An active editing session might generate ~5-10 operations/sec per user typing at a natural pace → a 50-person concurrent doc could see 250-500 ops/sec funneling through one document's edit stream — this is a low absolute number, but it must be **strictly ordered/merged correctly**, which is the actual hard problem, not raw throughput.
- Document history (for undo, version history, "who wrote this") accumulates operations over the doc's lifetime — a long-lived heavily-edited doc could have millions of operations; periodic **compaction/snapshotting** of the operation log into a materialized document state is necessary so replay-from-scratch isn't required for every load.

### API design

```
WS connect: wss://docs.example.com/v1/documents/{doc_id}/edit

Client → Server (send local op, optimistically applied locally already):
{ "type": "op", "doc_id": "d1", "base_version": 42, "op": {"type":"insert","pos":10,"text":"hi"} }
  // or, for a CRDT approach: { "type":"op", "op": {...CRDT operation with unique id + causal metadata...} }

Server → Client (broadcast transformed/merged op to all other connected clients):
{ "type": "op", "doc_id": "d1", "version": 43, "op": {...transformed...}, "author": "u1" }

REST:
GET /v1/documents/{id}          → current materialized snapshot + current version
GET /v1/documents/{id}/history  → version history for time-travel/undo UI
```

The API shape is nearly identical whether the server runs OT or a CRDT underneath — the interesting
differences are entirely in what the server (OT) or the merge function (CRDT) does with the op,
which is exactly why this is a good "concept-level" interview topic: the wire protocol doesn't force
the choice, the consistency model does.

### Data model

- **Document snapshot** (materialized current state): stored in a document/blob store (could be Postgres JSONB for structured content, or object storage for larger docs) — this is what's served on initial load, avoiding replaying the entire operation history every time someone opens the doc.
- **Operation log**: append-only, ordered by `(doc_id, version)` or, for CRDTs, by causal/vector-clock metadata — stored in a wide-column or log-oriented store (Kafka retained long-term, or Cassandra) since it's write-heavy, append-only, and read sequentially for replay/history/undo.
- **Periodic snapshots**: every N operations (e.g., 500) or T minutes, materialize the current state and store it, so recovery/late-join only needs "latest snapshot + operations since" rather than the full history — directly analogous to log compaction in any event-sourced system.

### High-Level Design

```
                    ┌───────────────────────────────────┐
  Client A ──WS────▶│                                     │
  Client B ──WS────▶│   Document Session Server            │  (one logical owner
  Client C ──WS────▶│   (per doc_id, or per-doc shard)      │   per active doc —
                    │                                     │   sticky routing)
                    └──────────────┬──────────────────────┘
                                   │  serializes/orders incoming ops,
                                   │  applies transform/merge function,
                                   │  broadcasts resulting op + new version
                                   │  to all other connected clients
                                   ▼
                    ┌───────────────────────────────────┐
                    │   Operation Log (append-only,        │
                    │   ordered per doc_id)                │
                    └──────────────┬──────────────────────┘
                                   │ periodic
                                   ▼
                    ┌───────────────────────────────────┐
                    │   Snapshot Store (materialized doc)  │──▶ served on initial
                    └───────────────────────────────────┘     load / late join
```

**Request flow:** all clients editing a given document connect to the same logical **document session server** (routed by consistent hashing on `doc_id`, so one server is the authority for a given document's ordering at any moment — this sticky-routing requirement is itself a key architectural consequence of both OT and most practical CRDT server implementations needing *a* place where concurrent ops get sequenced or merged). A client applies its own edit **optimistically and instantly** to its local copy (this is what makes typing feel responsive) and asynchronously sends the operation to the session server tagged with the document version/vector-clock it was based on. The server resolves concurrency (via OT transform or CRDT merge, see deep dive), assigns the operation an authoritative position in the ordered log, appends it, and broadcasts the resolved operation to every other connected client, who apply it to reconcile their local state with the authoritative order.

### Deep Dive — OT vs CRDT, conceptually

**Operational Transformation (OT).** The core idea: when two users make concurrent edits based on the same starting version, the server (or peers) **transform** one operation against the other so that applying them in either order produces the same result. Classic example: doc is `"ab"`; User A inserts `"x"` at position 0 → `"xab"`; concurrently User B inserts `"y"` at position 2 (based on the original `"ab"`) → intends `"aby"`. If B's operation is naively applied after A's without adjustment, `"xab"` + insert-at-2 gives `"xayb"` — wrong, position 2 in the original doc is no longer position 2 after A's insert shifted things. OT's transform function adjusts B's operation's position (+1, because an insert happened before position 2) so it correctly becomes insert-at-3 against the post-A state, yielding `"xaby"` — the correct merged result both users converge to. This requires a carefully proven transform function for every pair of operation types (insert-insert, insert-delete, delete-delete, etc.) — historically the hardest part of building OT correctly, since a subtly wrong transform function causes silent divergence that's very hard to detect and debug (this was the source of many real bugs in early collaborative editors like early Google Wave/early Docs implementations). OT typically requires a **central server** to be the arbiter of a single global ordering against which transforms are computed, which fits a client-server architecture naturally but doesn't extend as cleanly to full peer-to-peer or long-offline scenarios.

**Conflict-free Replicated Data Types (CRDTs).** The core idea: design the data structure itself so that **any order of applying operations converges to the same result**, without needing a central transform step — merge is mathematically guaranteed to be commutative, associative, and idempotent. For text editing, the common approach (e.g., RGA — Replicated Growable Array, or the approach behind Yjs/Automerge) assigns every character (or character run) a globally unique, causally-ordered ID (e.g., `(site_id, logical_clock)`), and each character's ID also references the ID of the character it was inserted after. This means every replica can independently receive operations in *any* order — even wildly out of order, even after being offline for days — and deterministically reconstruct the same final sequence, because the structure encodes enough causal metadata to reassemble correct order regardless of arrival sequence. There's no central arbiter required for correctness (though a server is still commonly used for routing/persistence/presence, not for correctness). The cost: per-character metadata overhead (tombstones for deleted characters that must often be retained rather than physically removed, to preserve merge correctness) can bloat document size over a long edit history, and mapping CRDT internals cleanly onto rich structured documents (tables, nested formatting) is meaningfully harder than for plain text.

**The practical trade-off to state in an interview.** OT: simpler core data model, well-understood, but the transform functions are notoriously easy to get subtly wrong, and it fundamentally wants a central sequencing server — offline/peer-to-peer support is bolted on, not natural. CRDT: naturally supports offline editing and peer-to-peer sync (no arbiter needed for convergence correctness), and is what most modern collaborative editors (Figma's own approach, Notion, and libraries like Yjs/Automerge) have converged toward for exactly this reason — but pays a real storage/complexity cost (tombstones, more complex garbage collection of old metadata) and richer structured-document support is still an active engineering area. **The one-line answer a staff candidate should be able to give:** "If the product is fundamentally always-online client-server (e.g., a live-only whiteboard), OT's simplicity is fine; if offline-first, multi-device, or peer-to-peer sync is a real requirement, CRDTs are the better foundation despite the storage overhead — which is exactly why nearly every editor built in the last decade with serious offline requirements has chosen CRDT-based approaches."

### Scaling the design

- Document session ownership is sharded by `doc_id` (consistent hashing) across session servers — a single document's ordering/merge authority lives on one server at a time, but different documents scale horizontally across the fleet trivially since they never interact.
- For CRDTs specifically, periodic garbage collection of tombstones (once all replicas are known to have seen a deletion, causally, the tombstone can be safely pruned) keeps long-lived-document metadata bounded — this is a real operational job, not a footnote, for any long-running CRDT-backed document.
- Extremely large concurrent-editor counts on one document (hundreds) stress the broadcast fan-out from the session server — mitigate by batching/coalescing operations broadcast within short windows (e.g., 50-100ms) rather than one network round-trip per keystroke per client, trading a small, imperceptible latency increase for much lower message volume.

### Failure handling

- Session server crash → clients reconnect and are re-routed (consistent hashing) to a new owning server for that doc_id, which reloads the latest snapshot + subsequent ops from the durable log — no data loss since ops were appended to the durable log before being broadcast/acked, only a brief reconnect blip.
- Client goes offline mid-edit → for CRDT-based systems this is close to a first-class case: the client keeps editing locally, buffering ops, and on reconnect sends its buffered ops which merge correctly regardless of how much has changed server-side in the meantime; for OT-based systems, a long offline period is harder — the client's operations are based on a version far behind current, requiring either transforming across a long chain of missed operations (expensive, more failure-prone) or falling back to a manual conflict-resolution/merge UI for very long offline gaps.
- Network partition splitting collaborators across two temporarily-isolated session servers (rare, but possible during infra issues) → CRDT convergence guarantees mean once connectivity is restored and ops exchange, the documents merge correctly with no data loss; OT requires more careful reconciliation since two independent sequencing authorities may have each locally ordered things differently — a real argument in CRDT's favor for any deployment that can't rule out partitions.

### Trade-offs

- **OT vs CRDT** (the central trade-off of this whole system, restated crisply): OT gives a simpler mental model and smaller runtime metadata footprint but requires a central sequencer and handles offline/long-disconnect poorly; CRDT gives natural offline/multi-replica convergence with no central arbiter needed for correctness but costs more per-operation metadata and harder garbage collection.
- **Optimistic local apply + async server reconciliation vs. waiting for server round-trip before showing an edit**: optimistic apply is essential for interactive feel, at the cost of needing a reconciliation step (transform or merge) when the server's authoritative response differs from what was locally guessed — unavoidable complexity given the latency requirement.
- **Periodic snapshotting vs. always replaying full operation history**: snapshotting adds a background compaction process to maintain, but avoids ever-growing load-time cost as a document's history grows into the millions of operations — necessary once you consider a document's realistic multi-year lifetime.

---

## Closing

Across all eight systems, the same handful of decisions kept recurring: *where does durability
happen relative to acknowledgment* (webhook, chat, scheduler), *how do you avoid centralizing a fan-
out that grows multiplicatively* (presence, notifications), *what's ephemeral vs. what must survive
a crash* (live location, presence, job scheduler), and *what consistency guarantee does the product
actually need, versus what's the strongest guarantee available* (webhook ordering, collaborative
editing, chat multi-device). None of these are memorized diagrams — they're the same handful of
trade-off axes, reapplied.

**Framing question, again:** *Can I combine the building blocks appropriately instead of memorizing architectures?* If you can look at any one of these eight systems and point to which primitive is doing the heavy lifting and why a *different* choice would have broken under the stated numbers, that's the signal a Staff-level interview is actually probing for.
