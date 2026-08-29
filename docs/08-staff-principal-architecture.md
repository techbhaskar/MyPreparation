---
slug: /08-staff-principal-architecture
---

# Stage 8 — Staff / Principal Architecture Thinking
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **Framing question:** *Can I make good engineering decisions when there isn't one correct answer?*
>
> This is likely **the single biggest Staff/Principal-level interview signal**. Senior engineers are
evaluated on whether they can build the right thing correctly. Staff/Principal engineers are
evaluated on whether they can navigate ambiguity, articulate trade-offs honestly, and commit to a
defensible decision under incomplete information — then explain *why* to a skeptical room.
Everything in this document is written to train that muscle, not to hand you a definitions glossary.

## Table of Contents

- [Phase 1 — Trade-off Thinking](#phase-1--trade-off-thinking)
  - [Consistency vs Availability](#consistency-vs-availability)
  - [Latency vs Durability](#latency-vs-durability)
  - [Cost vs Reliability](#cost-vs-reliability)
  - [Build vs Buy](#build-vs-buy)
  - [Simplicity vs Scalability](#simplicity-vs-scalability)
  - [Sync vs Async](#sync-vs-async)
  - [SQL vs NoSQL](#sql-vs-nosql)
- [Phase 2 — Architecture Evolution](#phase-2--architecture-evolution)
  - [The Running Example: LinkStash](#the-running-example-linkstash)
  - [1K Users](#1k-users)
  - [100K Users](#100k-users)
  - [1M Users](#1m-users)
  - [10M Users](#10m-users)
  - [100M Users](#100m-users)
- [Phase 3 — Migration](#phase-3--migration)
  - [Monolith to Microservices](#monolith-to-microservices)
  - [Database Migration](#database-migration)
  - [Schema Evolution (Expand-Contract)](#schema-evolution-expand-contract)
  - [Zero-Downtime Migration](#zero-downtime-migration)
  - [Strangler Pattern](#strangler-pattern)
  - [Backward Compatibility](#backward-compatibility)
- [Phase 4 — Multi-Region](#phase-4--multi-region)
  - [Active-Active](#active-active)
  - [Active-Passive](#active-passive)
  - [Data Residency](#data-residency)
  - [Global Routing](#global-routing)
  - [Regional Consistency](#regional-consistency)
  - [Conflict Resolution](#conflict-resolution)
- [Phase 5 — Architecture Governance](#phase-5--architecture-governance)
  - [ADRs](#adrs)
  - [Standards](#standards)
  - [Platform Thinking](#platform-thinking)
  - [Technical Debt](#technical-debt)
  - [Architecture Reviews](#architecture-reviews)
- [Phase 6 — Security Architecture](#phase-6--security-architecture)
  - [Authentication vs Authorization](#authentication-vs-authorization)
  - [OAuth/OIDC](#oauthoidc)
  - [Service-to-Service Security](#service-to-service-security)
  - [Encryption](#encryption)
  - [Secrets Management](#secrets-management)
  - [Zero Trust](#zero-trust)
  - [Threat Modeling (STRIDE)](#threat-modeling-stride)
- [Phase 7 — Cost & Operations](#phase-7--cost--operations)
  - [Capacity Planning](#capacity-planning)
  - [Cloud Cost](#cloud-cost)
  - [Over-Engineering](#over-engineering)
  - [Operational Burden](#operational-burden)
  - [Build vs Managed Services](#build-vs-managed-services)
- [Closing](#closing)

---

## Phase 1 — Trade-off Thinking

The core skill tested here is not "do you know the CAP theorem." It's: **can you argue both sides
convincingly, and then commit to a decision using the actual constraints of the problem, not a
memorized default?** Interviewers are listening for the moment you say "it depends," followed
immediately by "...and here's what it depends on, and here's what I'd pick for *this* system." A
senior engineer picks the trendy answer. A staff engineer picks the answer that survives contact
with the specific constraints in the room.

### Consistency vs Availability

**Argue for consistency:** If two users read the same bank balance seconds apart and get different answers, trust in the system collapses. Financial ledgers, inventory counts that gate physical fulfillment, and anything involving double-spend risk need strong consistency. The cost of a stale read is asymmetric and expensive — you'd rather serve an error than a wrong answer.

**Argue for availability:** If a "like" count on a social post is off by one for a few seconds, nobody notices or cares. But if the service goes down because one replica can't reach quorum, you've turned a cosmetic inconsistency into a total outage. For most consumer-facing read paths, an available-but-eventually-consistent system beats a consistent-but-sometimes-down one, because downtime is a worse user experience than staleness.

**How to actually decide:** Don't reach for CAP as a binary. Ask three questions:
1. *What does "wrong" cost, in dollars or trust, versus what does "unavailable" cost?* Double-booking a seat on a plane is a wrong-answer problem; a stale "who's typing" indicator is a nobody-cares problem.
2. *Is the inconsistency window bounded and small, or unbounded?* Eventual consistency that resolves in 200ms is very different from one that can lag minutes under partition.
3. *Can you push the correctness requirement to a narrower boundary?* You often don't need the whole system to be strongly consistent — only the specific invariant (e.g., "don't sell the same seat twice") needs a consistency guarantee, enforced at that one write path (e.g., a single-writer per seat, or a conditional write / compare-and-swap), while everything else (seat map display, search) can be eventually consistent.

**Concrete scenario:** Designing a concert ticketing system. The seat map shown to browsing users can be eventually consistent — cache it, replicate it, serve it from anywhere, tolerate a few seconds of staleness, because worst case someone tries to select an already-sold seat and gets rejected at the reservation step. But the actual seat-reservation write must be strongly consistent (single source of truth per seat, ideally a conditional write against a primary, or a distributed lock with a short TTL) because double-selling a seat is a real financial and legal problem. The staff-level answer isn't "CP" or "AP" for the whole system — it's identifying that this system has two different consistency domains and architecting the boundary between them (e.g., an eventually-consistent read replica layer in front of a strongly-consistent reservation service).

### Latency vs Durability

**Argue for latency:** Every write that waits for an fsync to disk, or waits for a quorum of replicas across regions, adds tail latency. For a system where p99 latency directly correlates with revenue (ad bidding, autocomplete, trading), shaving milliseconds by acknowledging writes early (write-back cache, async replication) is a legitimate design choice.

**Argue for durability:** If a write is acknowledged to the client but lost on a crash before it's replicated, you've told a user "yes, we saved that" and lied. For anything with legal, financial, or safety implications, durability has to be guaranteed before acknowledgment (write-ahead log flushed, or replicated to a quorum) even if it costs latency.

**How to actually decide:** The real question is *what does the client believe once you ACK?* If your API contract implies "this is safely stored," you must actually make it so before returning — anything else is a correctness bug wearing a performance win's clothing. The lever to pull is usually not "durable vs not" but *how much durability do you buy per millisecond spent*: write to a local WAL + async replicate (fast, durable against process crash, not against disk/node loss); replicate synchronously to one other node before ACK (slower, durable against single node loss); wait for quorum across AZs (slower still, durable against AZ loss). Staff-level framing: durability is not boolean, it's a *tier*, and different data deserves different tiers within the same system.

**Concrete scenario:** An e-commerce order system. The "add to cart" action can be low-durability (in-memory session store with async persistence — losing a cart on a rare crash is annoying, not catastrophic) and optimized purely for latency. The "order placed / payment captured" event must be written to a durable, replicated log (e.g., synchronously replicated DB write or a Kafka topic with acks=all) before you tell the customer "your order is confirmed," because that ACK is a promise with money and legal weight behind it. Same system, two durability tiers, chosen deliberately by what the ACK implies.

### Cost vs Reliability

**Argue for cost:** Five nines of availability is often 10-100x more expensive than three nines, because each additional nine typically requires eliminating an entire class of single points of failure (multi-AZ, then multi-region, then cross-provider). If your business tolerates a few hours of downtime a year without material harm, spending for 99.999% is burning money the business doesn't need to burn.

**Argue for reliability:** An outage during a critical business moment (Black Friday, a payroll run, a trading window) can cost more in a single incident than years of the "extra" infrastructure spend, plus reputational damage that doesn't show up on the infra bill.

**How to actually decide:** Tie the reliability target to a number the business already tracks — revenue-per-minute of downtime, contractual SLA penalties, churn risk — and work backward to the availability tier that spend justifies. This is the point where "it depends" has to become a real conversation with a business stakeholder, not an engineering guess. A staff engineer's job is to make the trade-off *visible and quantified* (e.g., "multi-region active-active costs an incremental $40K/month and buys us protection against a ~2x/year regional outage that historically cost us $150K each" — the last number needs to be attributed to a stakeholder or a knowable industry benchmark, not invented) rather than silently picking the "safe" expensive option or the "cheap" risky one.

**Concrete scenario:** A B2B SaaS analytics dashboard used internally by customers during business hours. Multi-region active-active failover is expensive and operationally complex (see Phase 4). If the customer base is 95% in one geography with clear business hours, a single-region deployment with a warm standby in another region (activated manually or via a scripted, tested runbook within, say, a 30-minute RTO) is very likely the right cost/reliability point — you buy protection against the regional-outage tail risk without paying for active-active's operational tax every single day.

### Build vs Buy

**Argue for build:** If the capability is close to your core differentiator, or if no vendor's abstraction fits your access patterns without painful workarounds, building gives you control, avoids vendor lock-in, and lets you optimize for your exact shape of problem.

**Argue for buy:** Undifferentiated heavy lifting (auth, payments processing, email deliverability, observability platforms) is a solved problem elsewhere, sold by teams whose entire job is that one thing. Building it yourself means your team now owns an ongoing tax — security patching, edge cases, on-call — for something that isn't why customers pay you.

**How to actually decide:** Ask "if we're excellent at this, do customers notice or care?" If yes, and it's close to the core value prop, lean build. If no — it's plumbing — lean buy, and spend the saved engineering time on the thing customers do notice. Second filter: total cost of ownership over 3 years, not license cost vs one-time build cost. A "free" open-source build often loses to a paid managed service once you count the on-call burden, the security patching, and the opportunity cost of the engineers maintaining it instead of building product.

**Concrete scenario:** A startup needs SMS 2FA delivery. Building your own SMS gateway integration with global telecom carriers, handling international number formatting, retry/fallback across carriers, and compliance (10DLC registration in the US, etc.) is enormous undifferentiated effort — buy this (Twilio, etc.). Contrast: if you're building a fraud-detection engine and fraud detection *is* your product's edge, building your own model pipeline instead of relying on a generic third-party fraud API is likely the right call, even though "fraud detection as a service" vendors exist — because your unique transaction data and business rules are the differentiator a generic vendor can't replicate.

### Simplicity vs Scalability

**Argue for simplicity:** A simple system (monolith, single database, synchronous calls) is easier to reason about, debug, onboard new engineers to, and change quickly. Premature scalability investment (sharding a database you don't need to shard yet, building an event-driven mesh for a system with light traffic) adds real, ongoing cognitive and operational cost for a problem you don't have.

**Argue for scalability:** If you know growth is coming (a launch is scheduled, a contract guarantees 10x volume next quarter), retrofitting scalability into a simple system under load, in production, with users watching, is far more dangerous and expensive than designing headroom in from the start.

**How to actually decide:** This is the most direct test of engineering judgment because both extremes are real career-damage stories: the team that over-engineered a system for scale that never came (and drowned in complexity and delayed launch), and the team that under-built and had a very public outage during a viral growth moment. The tie-breaker is *how confident and how soon* the scale is coming, and *how expensive it is to add later*. Cheap-to-add-later + uncertain scale → stay simple (e.g., adding a cache layer later is cheap; add it when metrics say to). Expensive-to-retrofit + high-confidence scale → build the seam now, even if you don't use it yet (e.g., choosing a partition key up front so a future shard split doesn't require a full data migration, even if you run on a single unsharded instance for the first year).

**Concrete scenario:** A new internal tool for 50 employees does not need a message queue, multiple services, or read replicas — a single Rails/Django-style monolith with one Postgres instance is not just adequate, it's *correct*, and reaching for microservices here would be a straightforward staff-level red flag to call out in review (see [Over-Engineering](#over-engineering)). Contrast: a startup that has just signed a contract to be the backend for a hardware device shipping to 2 million pre-ordered units in four months has certainty and a deadline — that team should design the ingestion path (device telemetry) with horizontal scalability from day one, because "let's revisit sharding after launch" is not an option when launch day *is* the 2-million-device spike.

### Sync vs Async

**Argue for sync:** Synchronous request/response is simpler to reason about, gives immediate error feedback, and is the right default when the caller genuinely needs the result before it can proceed (e.g., "is this password correct" gates the next screen).

**Argue for async:** Decoupling a slow or unreliable downstream step (sending an email, generating a thumbnail, calling a flaky third-party API) behind a queue lets the caller return fast, absorbs downstream slowness/outages without cascading failure, and allows retries without the caller being involved.

**How to actually decide:** Ask whether the caller's next action *depends on* the result. If yes, sync (or async-with-polling/websocket-push if the sync call would be too slow to hold a connection open for). If the caller doesn't need the result to proceed — only needs to know "this was accepted" — async. Also weigh failure semantics: sync gives you an immediate, in-band error the caller can act on; async requires you to build out-of-band failure handling (dead-letter queues, alerting, retry-with-backoff, idempotency) which is real additional engineering surface — don't reach for async and then skip building that half of it.

**Concrete scenario:** An e-commerce checkout. "Charge the customer's card" should be synchronous from the customer's point of view (they need to know now if payment failed so they can retry with another card) — but that doesn't mean the whole checkout is one long synchronous chain. "Send the order confirmation email," "notify the warehouse system," "update the recommendation model with this purchase" are all fire-and-forget from the checkout flow's perspective — publish an `OrderPlaced` event and let async consumers handle them, so a slow email provider never adds latency to, or risk of failure for, the checkout itself.

### SQL vs NoSQL

**Argue for SQL:** Strong schema guarantees, joins, transactions (ACID), and mature tooling make relational databases the right default when your data has real relationships you'll query across, and correctness/consistency matters (financial records, anything with multi-row invariants).

**Argue for NoSQL:** When your access pattern is simple and known in advance (key-value lookups, single-item reads at massive scale), when your schema is genuinely variable/document-shaped, or when you need horizontal write scalability beyond what a single-primary relational database comfortably gives you, a NoSQL store (DynamoDB, Cassandra, MongoDB) trades away joins and often strict consistency for scale and flexibility that matches the access pattern.

**How to actually decide:** This is not "relational is old, NoSQL is web-scale" — that reasoning gets called out immediately in a staff interview. Ask: (1) Do I need multi-record transactions/joins, or is every query really keyed off one entity? (2) Is my write volume/pattern something a well-indexed, well-sharded relational database (many now scale further than people assume, e.g. via read replicas, partitioning, or Vitess/Citus-style sharding) can't handle, or am I reaching for NoSQL before I've actually hit that ceiling? (3) How much does query flexibility matter — will product need new ad-hoc queries and reports next quarter that a key-value store can't answer without a second system anyway? A very common staff-level insight: most systems end up **polyglot** — relational for the transactional core (orders, accounts, inventory) and a NoSQL/specialized store for a specific hot path (session cache, activity feed, full-text search, time-series metrics) — and the skill is drawing that boundary correctly, not picking one paradigm for the whole system.

**Concrete scenario:** A social bookmarking app (used as the running example in Phase 2) stores users, bookmarks, and tags in Postgres because tags-to-bookmarks and user-to-bookmarks relationships benefit from joins and referential integrity, and the volume is nowhere near what would force a different choice. But the "who's online now" presence data and the "recently viewed" list are ephemeral, high-write, low-relational-value data — a Redis (key-value) store fits better, is dramatically cheaper to operate at that access pattern, and nobody is running an ad-hoc SQL report against presence data anyway.

---

## Phase 2 — Architecture Evolution

### The Running Example: LinkStash

To make scale tiers concrete rather than abstract, we'll follow **LinkStash**, a social bookmarking
app: users save links, tag them, follow other users, see a feed of what people they follow have
saved, and search their own and public bookmarks. This is deliberately similar in shape to
Pinterest/Delicious/Pocket-with-social. The point of this section is not the specific numbers — it's
the *narrative*: at every tier, something that worked fine starts to break, the fix is chosen under
real constraints, and the fix itself introduces the next problem. That chain of cause-and-effect is
what a staff-level system design answer sounds like.

### 1K Users

**Architecture:** A single server running the web app (monolith: API + server-rendered HTML or a thin SPA backend) and a single Postgres database, both possibly on the same box. Bookmarks, users, tags, follows all live in a handful of normalized tables. No cache, no queue, no CDN beyond maybe static asset hosting.

**What works:** Everything. At 1,000 users doing light bookmark-and-browse activity, total request volume is low enough that a single small instance handles it with room to spare. Postgres comfortably handles the join-heavy feed query ("show me bookmarks from people I follow, newest first") because the dataset is small enough to fit in memory/cache and query plans are fast even unoptimized.

**What breaks first / what's next:** Nothing breaks from load. The real risk at this tier is *building for a scale you don't have* — reaching for microservices, Kafka, or sharding here is the over-engineering failure mode (see [Over-Engineering](#over-engineering)). The one thing worth doing proactively is keeping the codebase modular internally (clear boundaries between "bookmarks," "social graph," "feed") even inside the monolith, because that seam is cheap to draw now and expensive to retrofit later — this is the "expensive to add later" exception from the simplicity-vs-scalability trade-off.

### 100K Users

**What breaks first:** The feed query. "Bookmarks from people I follow, ordered by recency" was a fine join at 1K users; at 100K users with an active social graph, some users follow hundreds of people, and computing that feed live on every page load starts showing up as the slowest endpoint — first as elevated p99 latency, then as timeouts under traffic spikes (e.g., a link goes viral and everyone refreshes their feed at once).

**The fix:** Two things typically happen together: (1) add a read-through cache (Redis) in front of the feed query, keyed by user, with a short TTL or explicit invalidation on new bookmark/follow events — this absorbs the read amplification cheaply. (2) Add database read replicas and route feed reads to them, keeping writes on the primary, since read:write ratio on a bookmarking app is heavily read-skewed.

**New problems introduced:** Caching introduces staleness — a user who just bookmarked something might not see it in their own feed immediately if the cache isn't invalidated correctly, which is a new class of bug (cache invalidation) that didn't exist before. Read replicas introduce **replication lag** — a user posts a bookmark, the write goes to the primary, they're redirected to a replica that hasn't caught up yet, and their own bookmark appears to have vanished. The team now has to solve "read-your-own-writes" consistency, typically by routing a user's own reads to the primary for a short window after they write, or by writing through the cache synchronously.

### 1M Users

**What breaks first:** The single Postgres primary itself. Even with read replicas absorbing read traffic, write volume (new bookmarks, new follows, new tags, likes/saves) on a single primary starts to hit ceiling — vertical scaling (bigger instance) has diminishing returns and becomes expensive, and more importantly, the *database becomes a single point of failure and a single point of contention* that every other decision now revolves around. Also at this tier, full-text search across bookmarks (title/description/tags) run as `LIKE` queries or naive Postgres full-text search starts to degrade noticeably.

**The fix:** Two separate fixes for two separate problems, which is itself a staff-level insight — don't reach for one big hammer. (1) For search: extract search into a dedicated search index (Elasticsearch/OpenSearch), fed by an async pipeline (change-data-capture or an event on write) rather than querying Postgres directly for search. (2) For write scaling: this is the point to seriously evaluate splitting the monolith into services aligned with clear bounded contexts — e.g., a Bookmarks service, a Social Graph (follows) service, a Feed service — each with its own datastore, so that the social graph's write pattern (which is graph-shaped and benefits from a different storage model) stops competing for the same primary's capacity as bookmark writes.

**New problems introduced:** This is where distributed systems problems start for real. Splitting services means the feed generation now needs data from two services (bookmarks + social graph) — do you call synchronously (added latency, added coupling, cascading failure risk) or do you maintain a **denormalized, precomputed feed** updated asynchronously via events (fan-out-on-write)? Most systems at this tier move toward fan-out-on-write for feed generation: when a user posts a bookmark, an event fans out and pushes an entry into each follower's precomputed feed store. This solves the read-time join problem entirely but introduces its own new problem — see 10M users below.

### 10M Users

**What breaks first:** Fan-out-on-write breaks down for **celebrity/high-follower-count accounts**. If a popular curator account with 2 million followers posts a bookmark, fanning that write out to 2 million individual feed stores synchronously (or even quickly asynchronously) is a massive write amplification spike, and it also means 2 million feed-store writes for a single action that most followers may never scroll far enough to see.

**The fix:** A hybrid fan-out model: fan-out-on-write for normal users (the vast majority, with reasonable follower counts), but fan-out-on-read (compute at request time, merging a small number of "high-fanout" sources) for celebrity accounts, merged with the precomputed feed at read time. This is the same pattern Twitter/X publicly described using. Additionally, at this scale, the search index and social graph likely need their own horizontal partitioning (sharding) since a single search cluster or single graph database instance can no longer hold the full dataset or handle the query rate.

**New problems introduced:** Hybrid fan-out means feed-serving logic is now meaningfully more complex — two code paths, two sets of edge cases, and a new failure mode where merging the precomputed and computed-on-read parts of a feed can produce ordering/duplication bugs. Sharding the social graph introduces the classic "which shard has this data" routing problem, and any query that needs to cross shards (e.g., "who do these two users have in common") gets significantly harder and slower. This is also the tier where a naive monolithic deployment pipeline breaks down — with many services now independently owned, deploy coordination, service discovery, and inter-service contract versioning (see [Backward Compatibility](#backward-compatibility)) become first-class operational concerns, likely requiring a shift to container orchestration (Kubernetes) and a service mesh for consistent retries/timeouts/observability across services.

### 100M Users

**What breaks first:** Single-region physical limits — network latency to users far from your data centers becomes a dominant part of page-load time regardless of how fast your backend is, and a single-region outage (cloud provider region failure, which does happen) now means a global outage affecting the entire user base and making headlines. Additionally, at this scale, regulatory data residency requirements (EU users' data possibly needing to stay in the EU) become a hard constraint, not a nice-to-have.

**The fix:** Multi-region deployment (see Phase 4 in full depth) — likely active-active for stateless services and read paths, with careful thought about which data must be strongly consistent globally (account credentials, billing) versus which can be regional/eventually consistent globally (a user's own bookmarks, feed). CDN and edge caching absorb static and semi-static content close to users. The social graph and feed systems built in earlier tiers now need a **global replication strategy** decision: does the social graph replicate everywhere (read-heavy, tolerate lag) with writes routed to a home region per user, or is it partitioned by region entirely?

**New problems introduced:** Every one of the earlier trade-offs (consistency vs availability, cache invalidation, replication lag) now has to be re-solved *across regions with 100+ms network latency between them* instead of across racks in one datacenter with sub-millisecond latency — the same bugs get an order of magnitude harder to reason about and debug. Conflict resolution for a user who opens the app in two regions (e.g., traveling) and bookmarks something on a flaky connection that gets applied in both regions becomes a real, user-visible edge case that needs an explicit strategy (see [Conflict Resolution](#conflict-resolution)). Organizationally, this is also the tier where the "one team, one monolith" mental model is long gone — dozens of teams own dozens of services, and architecture governance (Phase 5) stops being optional and becomes the only thing standing between the system and chaos.

---

## Phase 3 — Migration

### Monolith to Microservices

The failure mode interviewers are listening for is "just do it" or "extract everything into
services." A realistic phased plan looks like this:

**Phase 0 — Don't, until you have a reason.** Confirm the actual pain: is it a scaling bottleneck on one component, a team-coordination bottleneck (multiple teams stepping on each other in one codebase/deploy pipeline), or a genuine need for independent technology choices per component? If none of these are real yet, this migration is premature — see [Over-Engineering](#over-engineering).

**Phase 1 — Establish seams inside the monolith first.** Before extracting anything, refactor the monolith internally so that the future service boundary already exists as a module boundary — a clear internal API, no reaching across the boundary into another module's database tables directly. If you can't draw a clean line inside the monolith, you will not draw one across a network either; you'll just have a distributed monolith, which is strictly worse (network calls where function calls used to be, with none of the deployment independence benefit because everything's still tangled).

**Phase 2 — Pick the extraction order by leverage, not by ease.** Extract the component that is causing the most real pain first (e.g., the component whose team most needs independent deploys, or whose resource profile most differs from the rest — a CPU-bound service living inside an I/O-bound monolith). Resist extracting the easiest, most decoupled piece first just because it's easy — that produces quick wins but no relief for the actual bottleneck.

**Phase 3 — Strangle it out (see Strangler Pattern below), one boundary at a time.** Stand the new service up, route a slice of traffic to it (often starting with reads, or a specific customer segment, or via a feature flag), verify behavior matches, then cut over fully, then delete the old code path. Never do a big-bang rewrite-and-switch.

**Phase 4 — Fix the data layer last, and expect it to be the hardest part.** The service can be extracted at the code/API level while still reading the monolith's database initially (a legitimate intermediate state) — but eventually it needs its own datastore to be truly independent. This is a separate, harder migration (see Database Migration below) and should be sequenced deliberately, not rushed to satisfy an arbitrary "no shared databases" purity rule before the team is ready.

**Phase 5 — Invest in the operational floor before scaling out further.** Each new service needs its own CI/CD, monitoring, on-call ownership, and a way to trace a request across service boundaries (distributed tracing). Skipping this and extracting 10 services without also building this operational foundation is how organizations end up with an unmanageable, undebuggable system — the classic "microservices before you were ready" horror story.

### Database Migration

Live database migrations (e.g., moving from MySQL to Postgres, from a monolith's shared DB to a
service-owned DB, or from on-prem to cloud) with zero acceptable downtime typically follow the
**dual-write / backfill / cutover** pattern:

1. **Dual-write phase:** The application starts writing every new write to *both* the old and new datastore, while all reads still come from the old one. This is the riskiest phase — dual writes can partially fail (write succeeds to old, fails to new, or vice versa), so you need either a transactional outbox pattern, idempotent writes with retry, or a reconciliation job that catches drift, plus alerting on write mismatches.
2. **Backfill phase:** A background job copies all *historical* data from the old store to the new one, typically in batches with rate limiting so it doesn't compete with production load. This runs concurrently with dual-writes (which are already keeping new data in sync), so backfill only needs to cover data older than when dual-write started.
3. **Verification phase:** Before cutting over any real traffic, run a comparison/checksum job across both stores — row counts, sampled record diffs, or a full diff if feasible — and don't proceed until discrepancies are understood and resolved (some discrepancy may be expected/benign, like timestamp precision differences; some is a dual-write bug that must be fixed).
4. **Read cutover, gradually:** Shift a small percentage of *read* traffic to the new store first (shadow reads that are compared but not served, then a real percentage of served reads, ramped up), monitoring error rates and latency at each step. Keep the ability to instantly roll back the read path to the old store via a feature flag.
5. **Full cutover and dual-write teardown:** Once reads are fully on the new store and stable, stop writing to the old store, and only then decommission it after a safety buffer period (e.g., keep the old store as a read-only archive for a few weeks in case rollback is needed).

The staff-level point to make explicit: **the risk in this migration is not the technology, it's the
transition period** where two sources of truth exist simultaneously — every design decision in this
plan exists to minimize how long that period lasts and how much damage a mismatch during it can do.

### Schema Evolution (Expand-Contract)

Also called "parallel change." The problem it solves: you cannot atomically change a schema and
every reader/writer of it at the same instant when there are multiple service instances deploying
independently (rolling deploys) or multiple services sharing a database.

- **Expand:** Add the new schema element (a new column, a new table) *without* removing or repurposing the old one. Deploy this. Nothing reads or requires the new element yet — it's purely additive, so old code keeps working unmodified.
- **Migrate (dual-write / backfill):** Update application code to write to *both* the old and new schema elements. Backfill historical rows so the new element is populated for existing data too, same pattern as the database migration above.
- **Transition reads:** Once the new element is reliably populated for all rows (old and new), change readers to read from the new element instead of the old one. Roll this out gradually, service by service if multiple services are involved, monitoring for issues.
- **Contract:** Once nothing reads or writes the old schema element anymore — verified, not assumed — remove it. This is a separate deploy from the expand step, often weeks later, specifically so there's a safe rollback window throughout.

**Concrete scenario:** Splitting a single `name` column into `first_name` and `last_name`. Expand: add both new columns (nullable). Migrate: application writes to all three columns on every user update; a backfill job parses existing `name` values into the two new columns. Transition: update every read path (profile display, search, exports) to use the new columns, verified via logging/metrics that nothing still queries `name`. Contract: drop the `name` column. The entire point of doing it in four separate steps instead of one migration is that at every step, both old and new code can run simultaneously without breaking — which is required because you can't instantly redeploy every service and every in-flight request handler at the same moment.

### Zero-Downtime Migration

Zero-downtime isn't a single technique, it's the sum of several: (1) **rolling deploys** so old and
new code versions run side-by-side briefly, which requires backward/forward compatible APIs and
schemas (see below) during that window; (2) **feature flags** to decouple "deploy" from "release" —
ship the code dark, verify it, then flip it on, and flip it off instantly if something's wrong,
without a redeploy; (3) **database migrations that are themselves zero-downtime** via expand-
contract, never a blocking schema change that locks a large table; (4) **load-balancer draining** so
in-flight requests to an instance being taken down for a deploy finish gracefully instead of being
dropped; (5) **backward-compatible message formats** on any queues/event streams so consumers
running old code don't crash on new-format messages during the rollout window. The unifying staff-
level principle: zero-downtime is achieved by *never requiring two things to change atomically* —
every migration is decomposed into steps where each individual step is safe to run for an indefinite
period if something stalls it.

### Strangler Pattern

Named after strangler fig vines that grow around a host tree and gradually replace it. Applied to
software: put a facade (often an API gateway or reverse proxy) in front of the legacy system, and
incrementally build new functionality behind that facade, routing an increasing share of traffic to
the new implementation while the old one keeps serving everything not yet migrated — until
eventually the old system handles nothing and can be deleted.

**Worked example:** A legacy monolithic e-commerce platform's search feature is slow, hard to change, and tightly coupled to the product catalog database. Rather than a rewrite:
1. Put an API gateway in front of the `/search` endpoint that currently routes 100% of traffic to the legacy monolith's search handler.
2. Build a new, standalone search service backed by Elasticsearch, fed by a change-data-capture stream off the product catalog (so it stays in sync without touching the monolith's write path).
3. Route a small percentage of search *read* traffic (e.g., 1%, or a specific low-risk user segment) to the new service via the gateway, comparing results/latency/errors against the legacy path (shadow testing or a real but small live split).
4. Gradually ramp the traffic percentage as confidence builds, watching relevance quality and performance at each step, with instant rollback via the gateway's routing config if problems appear.
5. Once 100% of search traffic is served by the new service and it's been stable for a burn-in period, remove the legacy search code and its database queries from the monolith entirely — this is the step teams often skip, leaving dead code and confusion; deleting it is part of finishing the migration, not optional cleanup.

The strangler pattern's value is that at every point in the process, the system is fully functional
and in production — there's no "big bang cutover night" with a rollback plan that's never actually
been tested at scale, which is the exact failure mode strangler avoids.

### Backward Compatibility

At staff level, backward compatibility is a *contract*, and the discipline is treating any API,
event schema, or database schema consumed by more than one deployable unit as something you cannot
break without a coordinated multi-step process. Practical rules: additive changes (new optional
field, new endpoint) are safe and can ship anytime; removing or renaming a field, changing a field's
type or semantics, or changing required-ness are breaking changes that require a deprecation window
— announce it, support both old and new for a defined period, monitor actual usage of the old form
(don't just assume nobody uses it — instrument it), and only remove after usage drops to zero or the
deprecation deadline passes with explicit stakeholder sign-off. For public/external APIs, this often
means versioning (`/v1/`, `/v2/`) and a long-lived support window measured in months or years; for
internal service-to-service APIs, the window can be shorter but the discipline is the same — the
mistake staff engineers catch in review is a team assuming "we control both sides so we can just
break it," when in practice a rolling deploy means both sides *are* running simultaneously for some
window no matter how well-coordinated the team is.

---

## Phase 4 — Multi-Region

### Active-Active

Multiple regions simultaneously serve live production traffic, each capable of handling reads and
writes. **Argument for:** best latency for globally distributed users (each user hits their nearest
region), highest availability (a full region failure just means losing a fraction of capacity,
traffic reroutes to surviving regions), and it forces you to build good multi-region hygiene early
rather than discovering it during a crisis. **Argument against:** it's the most operationally
complex option — every stateful component needs a real strategy for cross-region data replication
and conflict resolution (see below), testing is harder (you now need to test region-failure
scenarios regularly, e.g., via chaos engineering, or you don't actually know failover works), and it
costs more to run (duplicate capacity, cross-region data transfer costs). **Decide based on:**
whether your data model can tolerate the consistency trade-offs active-active forces (see Regional
Consistency) and whether your team has the operational maturity to run it — active-active adopted
before the team can reliably test and monitor it is a common source of the worst kind of incident:
the failover mechanism itself causing an outage because it was never exercised.

### Active-Passive

One region is the primary, serving all live traffic; one or more standby regions replicate data
continuously but don't serve traffic until a failover is triggered (manually or automatically).
**Argument for:** dramatically simpler to reason about — one source of truth at a time, no cross-
region write conflicts to resolve, lower cost (standby capacity can be smaller than full production
scale if failover isn't instantaneous). **Argument against:** failover is a rare event, which means
it's undertested by default — the standby region's failover path is exactly the kind of code path
that only runs during an actual crisis, which is the worst time to discover a bug in it (regular
failover drills are mandatory to make active-passive trustworthy). Also, users far from the single
active region always pay the latency cost, all the time, not just during a failure. **Decide based
on:** if your traffic is regionally concentrated (most users near one region) and your organization
can commit to actually running regular failover drills, active-passive is usually the right starting
point before justifying active-active's cost and complexity.

### Data Residency

Regulatory regimes (GDPR in the EU, similar laws in Brazil/China/India/etc.) can require that
certain personal data about a region's residents physically stay within that region's borders, or at
minimum that the region of record and access controls are auditable. This is a **hard constraint**,
not a trade-off to optimize — you don't get to pick "a little bit of compliance" for cost reasons.
Architecturally, this typically means: partitioning user data by "home region" determined at account
creation (or residency declaration), storing that user's personal data only in datastores physically
located in that region, and being careful that *derived* data (aggregated analytics, ML training
sets, logs) doesn't inadvertently leak personal data across the boundary — a very common real-world
compliance failure is an analytics pipeline or a centralized logging system that quietly copies EU
user data into a US-based data warehouse. Global routing (below) must be residency-aware: an EU
user's request should be routed to and processed by EU infrastructure end-to-end, not just have its
final storage happen to be in the EU while intermediate processing touches other regions. This also
complicates disaster recovery — you can't just fail an EU region over to a US standby if that would
move EU residents' data outside the EU, so residency-constrained regions often need in-region
redundancy (multiple AZs within the compliant region) rather than relying on cross-region failover.

### Global Routing

Getting a user's request to the "right" region involves layered mechanisms: **DNS-based routing**
(e.g., GeoDNS or latency-based routing policies like AWS Route 53 latency-based routing) directs a
user to the nearest/lowest-latency region at the DNS resolution level — coarse-grained, cached by
resolvers, but cheap and simple. **Anycast** (a single IP address advertised from multiple regions,
with network routing delivering the packet to the nearest one) gives finer-grained, faster failover
than DNS (no DNS TTL/cache delay) and is how CDNs and some global load balancers work. On top of
network-level routing, **application-level routing** is often needed for residency or session-
affinity reasons — e.g., routing a specific user to their "home region" regardless of which edge
they hit, requiring a fast global lookup (often an edge-cached mapping) of user-to-home-region
before the request is proxied onward. The staff-level nuance: "route to nearest" (optimizing
latency) and "route to home region" (satisfying residency or data-locality) are different goals that
can conflict, and the routing layer needs to know which rule wins for which class of request.

### Regional Consistency

Once data is replicated across regions, you must decide, per data type, what consistency guarantee
it gets *across* regions — this is the multi-region instance of the consistency-vs-availability
trade-off from Phase 1, and the same reasoning applies. Account credentials and billing state
usually need strong consistency (a single global source of truth, or synchronous cross-region
consensus, accepting the latency cost) because acting on stale data here is dangerous. Session
state, feed content, and most user-generated content can be eventually consistent across regions
(asynchronous replication, accept a replication-lag window) because the cost of a few seconds of
staleness is low and the availability/latency win is large. A common pattern is "**home region
writes**" — a piece of data has one authoritative region where writes are accepted (often the user's
home region), asynchronously replicated to other regions for local reads, which avoids needing full
multi-master conflict resolution for most data while still giving fast local reads everywhere.

### Conflict Resolution

Conflicts arise whenever more than one region can accept a write for the same logical piece of data
(true multi-master) — e.g., a user opens the app in two regions during travel, or a network
partition causes both regions to accept writes that later need to be merged. Common strategies, in
increasing order of sophistication: **last-write-wins (LWW)** using a timestamp — simple, but can
silently lose data if clocks are skewed or two writes are genuinely concurrent (this is the naive
default and worth naming as such in an interview — good to know it, better to know its failure
mode); **vector clocks / version vectors** to detect true concurrency (as opposed to a causal
happens-before relationship) so the system can at least know a conflict occurred rather than
silently picking one; **CRDTs (Conflict-free Replicated Data Types)** for data structures where
merges can be defined mathematically to always converge without data loss (e.g., a counter that only
increments, a set with add-wins semantics) — powerful but only applicable to specific data shapes,
not a general solution; and **application-level/manual conflict resolution**, where the system
detects a conflict and either surfaces it to the user ("this document was edited elsewhere, merge
changes?") or applies domain-specific merge logic (e.g., a shopping cart conflict resolves by
unioning items rather than picking one side). The staff-level answer picks the *cheapest strategy
that's actually correct for that data's semantics* — reaching for CRDTs everywhere is over-
engineering; using naive LWW for financial data is a correctness bug waiting to happen.

---

## Phase 5 — Architecture Governance

### ADRs

An **Architecture Decision Record** is a short, durable document capturing a significant technical
decision, the context that drove it, the alternatives considered, and the trade-offs accepted. Its
purpose is not bureaucracy — it's institutional memory: six months later, when someone asks "why
don't we just use Kafka here instead," the ADR answers that question without a meeting, and when
circumstances change, it's the natural place to record that the decision is being revisited.

**Template:**

```markdown
# ADR-NNN: <Short, decision-focused title>

## Status
Proposed | Accepted | Superseded by ADR-NNN | Deprecated

## Context
What is the problem or forcing function? What constraints (technical,
organizational, timeline, cost) apply? What is currently true that makes
this decision necessary now?

## Decision
The specific choice being made, stated plainly and unambiguously.

## Alternatives Considered
For each real alternative: what it is, its pros/cons, and specifically why
it was not chosen. (If there was only one real option, say so — but usually
there were at least 2-3 seriously considered.)

## Consequences
What becomes easier? What becomes harder? What new risks or operational
burdens does this introduce? What follow-up work does this create?

## Notes / References
Links to spikes, benchmarks, related ADRs, discussion threads.
```

**Worked example:**

```markdown
# ADR-014: Use Kafka for cross-service event distribution

## Status
Accepted

## Context
Three services (Orders, Inventory, Notifications) currently communicate via
direct synchronous HTTP calls. This has caused two production incidents in
the last quarter where Notifications' latency degraded and caused Orders'
checkout endpoint to time out, despite Notifications being a non-critical
path for checkout. We need to decouple non-critical downstream consumers
from the services that produce the events they care about, and we expect
2-3 more services (Analytics, Fraud) to need the same order/inventory
events within the next two quarters.

## Decision
Adopt Apache Kafka as the event backbone. Orders and Inventory will publish
domain events (OrderPlaced, InventoryAdjusted) to Kafka topics; downstream
consumers (Notifications, and future Analytics/Fraud) will consume
asynchronously instead of being called synchronously.

## Alternatives Considered
- **AWS SQS/SNS**: Simpler to operate (fully managed, no cluster to run),
  cheaper at our current volume. Rejected because we need multiple
  independent consumer groups replaying the same stream at different
  offsets (Analytics needs to reprocess historical events; SQS's
  at-least-once delete-on-read model doesn't support this without
  fan-out to multiple queues, which is more operational surface than
  one Kafka cluster).
- **Keep synchronous calls, add circuit breakers/timeouts**: Cheapest,
  no new infrastructure. Rejected because it doesn't solve the core
  problem — Orders still has zero business reason to know Notifications
  exists, and a circuit breaker just changes "checkout times out" into
  "checkout silently doesn't notify," which is a different bug, not a fix.
- **Managed Kafka (Confluent Cloud / MSK)** vs self-hosted: chosen managed
  MSK specifically to avoid taking on Kafka operational expertise we don't
  have yet; revisit self-hosting only if MSK costs become prohibitive at
  our volume (tracked as a trigger, not a fixed date).

## Consequences
- Easier: Orders and Inventory are now decoupled from every downstream
  consumer's availability and latency; adding a new consumer (Fraud) needs
  zero changes to the producers.
- Harder: We now have eventual consistency between Orders and its
  consumers — Notifications may send a confirmation email a few seconds
  after checkout completes, not immediately. Product has signed off on
  this being acceptable.
- New operational burden: on-call now needs Kafka consumer-lag monitoring
  and alerting; this is new dashboard/runbook work tracked in TICKET-4821.
- Risk: at-least-once delivery means consumers must be idempotent; audit
  confirmed Notifications and the planned Fraud consumer both need
  idempotency keys added — tracked in TICKET-4822/4823.

## Notes / References
Load test results: <link>. Related: ADR-009 (service boundaries).
```

### Standards

Architecture standards (API design conventions, logging/observability formats, a required set of
health-check endpoints, approved technology lists) exist to trade a small amount of local team
autonomy for a large reduction in system-wide cognitive load and operational risk. The staff-level
judgment call is *scope*: mandate standards where inconsistency creates real cross-team cost (e.g.,
every service must emit logs in a common structured format, or on-call for one team can't debug
another team's service during an incident) but avoid mandating standards where the cost of
divergence is low and the cost of enforcement is high (e.g., forcing every team onto the exact same
internal code style within a service they alone own and maintain). A good test: "if team A does this
differently from team B, does it cause a problem for anyone other than team A?" If yes, standardize.
If the divergence is purely a taste difference contained within one team's ownership boundary, let
it be — governance that reaches too far breeds resentment and workarounds, which defeats the
purpose.

### Platform Thinking

Platform thinking means treating the shared, cross-cutting infrastructure and tooling that product
teams depend on (CI/CD, deployment tooling, the service mesh, internal developer portals, shared
auth libraries, provisioning of new services) as a product in its own right, with its own roadmap,
its own "customers" (the internal product teams), and its own quality bar — rather than as an ad hoc
pile of scripts one team maintains as a side project. The staff-level signal here is recognizing
*when* an organization has crossed the threshold where this investment pays off: a handful of
services can share tooling informally, but once there are dozens of services and teams, the absence
of a genuine internal platform means every team re-solves the same problems (how do I get a new
service deployed, how do I get a dashboard, how do I get secrets) slightly differently, multiplying
operational risk and onboarding time across the org. The trade-off to acknowledge honestly: building
a platform team is itself an investment with real cost (headcount, and the platform becoming a
dependency/bottleneck if it's under-resourced relative to the teams it serves) — platform thinking
done badly just becomes another team's technical debt that every other team is now blocked on.

### Technical Debt

The hardest part of tech debt is not identifying it — every engineer can point at that thing. It's
**communicating and prioritizing it to leadership** who are optimizing for a different set of
visible metrics (feature velocity, revenue). The staff-level approach: translate debt into the
language leadership already uses. Instead of "the payment service's code is messy," say "the payment
service's deploy failure rate is 3x the org average, which cost us N hours of incident response last
quarter and is the direct cause of the two-week slip on the last three features that touched it —
paying down the core issue (extracting the retry logic into a tested module) is a two-week
investment that we estimate saves M engineer-weeks per quarter going forward." Concretely: (1) make
debt visible and inventoried (a lightweight registry, not a novel — one line per item: what it is,
what it costs, what fixing it costs); (2) attach a real cost estimate to each item, in terms
leadership tracks (incident hours, slipped deadlines, on-call pages, security exposure) rather than
aesthetic complaints; (3) bring debt paydown into the same prioritization process as features —
competing for the same roadmap slots with the same cost/benefit framing — rather than treating it as
something squeezed into "20% time" that quietly never happens; (4) time debt paydown to when it's
cheapest to justify — e.g., attached to a feature that already has to touch that code, rather than
as a standalone project that's a harder sell in isolation.

### Architecture Reviews

A good architecture review is a structured conversation designed to surface problems *before*
they're built, not a rubber-stamp or a gotcha session. A working format: (1) the proposing team
writes up the design beforehand (often as an ADR-style doc or a short design doc) and circulates it
in advance — reviews where people read the doc live in the meeting waste everyone's synchronous
time; (2) the review itself opens with the proposer walking through context and the decision, then
explicitly inviting challenge on the alternatives-considered section specifically, since that's
where the most valuable pushback lives ("did you consider X" is more useful than "I don't like Y");
(3) the reviewer's job is to pressure-test, not redesign — asking about failure modes, scale
assumptions, operational ownership, security/compliance implications, and what happens when a stated
assumption turns out false, rather than relitigating the whole design from scratch or imposing a
personal preference; (4) the outcome is a clear decision — approved, approved-with-changes
(specific, written), or needs-rework-and-a-follow-up-review — never a vague "sounds good, let's see
how it goes" that leaves no actual record of what was agreed. The staff-level skill being exercised
on both sides: the presenter needs to have genuinely done the trade-off analysis (not just picked a
favorite tool and back-filled justification), and the reviewer needs to ask the question that
actually changes the decision, not the question that shows off the reviewer's own knowledge.

---

## Phase 6 — Security Architecture

### Authentication vs Authorization

**Authentication (AuthN)** answers "who are you" — verifying identity, typically via credentials, a token, a certificate, or a biometric. **Authorization (AuthZ)** answers "what are you allowed to do" — given a verified identity, deciding whether a specific action on a specific resource is permitted. The two are frequently conflated in casual conversation but must be architected as distinct concerns: a system can authenticate someone perfectly (it really is that user) and still need a separate, explicit decision about whether that user can delete this particular record. Common failure mode worth naming in an interview: services that check "is there a valid token" (AuthN) and treat that as sufficient, skipping a real AuthZ check on the specific resource being accessed — this is the root cause of a large fraction of real-world "insecure direct object reference" (IDOR) vulnerabilities, where a logged-in user can access another user's data just by changing an ID in the URL because the service verified *who* they were but never checked *whether they were allowed to see this specific object*.

### OAuth/OIDC

**OAuth 2.0** is an authorization framework — it lets a user grant a third-party application limited access to their resources on another service, without sharing their password with that third party. **OpenID Connect (OIDC)** is an identity layer built on top of OAuth 2.0 — it adds a standardized way to actually authenticate the user and get verified identity information (an ID token), which OAuth alone does not provide (OAuth tokens prove access, not identity, a distinction worth stating explicitly since it's commonly muddled).

**Authorization Code Flow** (the flow relevant to almost all server-side web app system design discussions):
1. The user clicks "Log in with Google" on your app. Your app redirects the browser to the identity provider's (Google's) authorization endpoint, including your app's client ID, a redirect URI, requested scopes, and a `state` parameter (a random value your app generates and later verifies, to prevent CSRF on the redirect).
2. The user authenticates with Google and consents to the requested scopes.
3. Google redirects the browser back to your app's redirect URI with a short-lived **authorization code** in the query string (not a token yet — this is deliberate, so the sensitive token never transits through the browser/URL).
4. Your app's backend (not the browser) makes a direct, server-to-server request to Google's token endpoint, exchanging the authorization code plus your app's client secret for an **access token** (and, for OIDC, an **ID token** containing verified identity claims, and often a **refresh token**).
5. Your app uses the access token to call Google's APIs on the user's behalf, and validates/decodes the ID token to establish who the user is in your own system (typically creating or matching a local user record keyed by the ID token's `sub` claim).

The key system-design-relevant detail: the authorization code is exchanged for tokens *server-side*,
using a client secret that never reaches the browser — this is why the authorization code flow
(rather than the older, now-discouraged implicit flow that returned tokens directly to the browser)
is the standard for anything with a backend. For public clients without a backend (mobile apps,
SPAs), the modern standard adds **PKCE** (Proof Key for Code Exchange) — the client generates a
random secret, sends its hash upfront, and must present the original secret at token exchange, which
prevents an intercepted authorization code from being redeemed by an attacker who doesn't have that
secret.

### Service-to-Service Security

Once you have more than one service, "who is calling this internal API" needs its own answer,
distinct from end-user authentication. **mTLS (mutual TLS)** has both sides of a connection present
and verify a certificate (not just the server proving its identity to the client, as in normal TLS,
but the client also proving its identity to the server) — this is the standard approach in a service
mesh (Istio, Linkerd) where every service-to-service call is automatically wrapped in mTLS, giving
strong cryptographic identity per service without each service needing to implement its own auth
check for every caller. **Service accounts** are non-human identities (a service or a workload gets
its own credential, distinct from any human's) used for authenticating scheduled jobs, service-to-
service calls not covered by a mesh, or a service calling a cloud provider's API — the staff-level
discipline here is scoping each service account to the *minimum permissions that specific service
needs* (least privilege) rather than a broad shared credential, so that a compromised service's
blast radius is limited to what it actually needed access to, not everything the org has.

### Encryption

**Encryption at rest** protects data stored on disk (databases, object storage, backups) from being read if the physical media or storage layer is compromised (a stolen disk, a misconfigured backup bucket, a cloud provider breach) — most managed databases and object stores offer this as a checkbox (transparent, storage-layer encryption), which handles the common case, but doesn't protect against a compromised *application* that has legitimate query access, which is a different threat requiring field-level encryption for especially sensitive fields (e.g., encrypting SSNs at the application layer before they ever reach the database, so even a full DB dump doesn't expose them in plaintext). **Encryption in transit** protects data moving over a network from interception (TLS for external traffic, and mTLS or at minimum TLS for internal service-to-service traffic — "it's inside our VPC so it doesn't need TLS" is a common and risky assumption, since it assumes the internal network can never be compromised, which real breaches have repeatedly disproven). **Key management basics:** encryption is only as strong as key handling — never hardcode keys in source or config files; use a dedicated key management service (AWS KMS, GCP KMS, HashiCorp Vault) that supports key rotation, access auditing (who used this key, when), and separation between who can *use* a key (encrypt/decrypt via an API call) versus who can *export* the raw key material (the latter should be extremely restricted, often disallowed entirely for cloud-managed keys) — this separation is what makes a key management service meaningfully more secure than an application just holding a raw key in memory or config.

### Secrets

Secrets (API keys, database credentials, TLS private keys, third-party tokens) need a lifecycle, not
just a storage location: (1) **never in source control** — this needs automated enforcement (pre-
commit hooks, CI scanning for accidentally committed secrets), not just a policy nobody checks; (2)
**centralized secret storage** (Vault, AWS Secrets Manager, GCP Secret Manager) rather than
scattered environment variables or config files, so there's one place to audit access and one place
to rotate from; (3) **rotation** — secrets should be rotatable without a deploy or downtime, which
requires the application to support reloading a credential rather than baking it in at startup only,
and rotation should happen on a schedule *and* immediately whenever a secret is suspected to have
leaked; (4) **least-privilege scoping**, same principle as service accounts — a secret should grant
access to exactly what its consuming service needs, not a shared master credential reused across
many services, because a shared secret means a single leak compromises everything that shares it.

### Zero Trust

The old model assumed anything inside the corporate network/VPC perimeter was trusted, and security
effort focused on hardening the perimeter (firewalls at the edge). Zero trust starts from the
opposite assumption: **no request is trusted by default regardless of where it originates**,
including requests from inside the network — every request must be authenticated and authorized on
its own merits, every time. Practically, this means: mTLS or equivalent identity verification for
every service-to-service call rather than trusting "it came from inside the VPC"; per-request
authorization checks rather than a one-time network-level access grant; and continuous verification
(short-lived credentials/tokens that expire and must be refreshed, rather than long-lived trust once
established). The driving reason this model won by staff-level architecture consensus: perimeter-
based trust fails catastrophically once *any* single internal system is compromised (a phished
employee laptop, a vulnerable internal service), because the attacker then has broad lateral access
to everything else that trusted the network perimeter — zero trust limits blast radius by never
granting that broad implicit trust in the first place, at the cost of more infrastructure (identity-
aware proxies, universal mTLS, per-request policy evaluation) than perimeter security required.

### Threat Modeling (STRIDE)

Threat modeling is the practice of systematically asking "how could this system be attacked" *during
design*, before code is written, rather than discovering vulnerabilities in production or via a pen
test after the fact. **STRIDE** is a mnemonic for a category checklist used to prompt this thinking
for each component/data flow in a system design:
- **S**poofing — can an attacker pretend to be someone/something they're not? (mitigated by strong authentication)
- **T**ampering — can an attacker modify data in transit or at rest without authorization? (mitigated by integrity checks, signing, encryption)
- **R**epudiation — can a user deny having performed an action, with no way to prove otherwise? (mitigated by audit logging, non-reputable action records)
- **I**nformation disclosure — can data be exposed to someone who shouldn't see it? (mitigated by encryption, access controls, careful error messages that don't leak internals)
- **D**enial of service — can an attacker make the system unavailable to legitimate users? (mitigated by rate limiting, resource quotas, redundancy)
- **E**levation of privilege — can an attacker gain more permissions than they should have? (mitigated by least privilege, thorough authorization checks, input validation preventing injection that could escalate access)

At a conceptual level for system design interviews, the point isn't reciting the acronym — it's
demonstrating that you walk through a design's data flows and trust boundaries (every place data
crosses from one trust level to another — client to server, service to service, service to database)
and ask, for each one, which of these six categories is a realistic risk given what that component
does, then name a concrete mitigation. A staff-level answer identifies the two or three STRIDE
categories that actually matter for the system being discussed (e.g., a payments system cares
enormously about tampering and repudiation; a public content-sharing app cares more about denial-of-
service and information disclosure) rather than mechanically listing all six with generic
mitigations for a system where most of them aren't the real risk.

---

## Phase 7 — Cost & Operations

### Capacity Planning

Capacity planning is estimating the resources (compute, storage, network, database connections) a
system needs, ahead of when it needs them, so scaling is a deliberate provisioning decision rather
than a reactive scramble during an outage. The staff-level approach: start from a real, defensible
traffic estimate (current growth rate extrapolated, a known upcoming launch/marketing push, seasonal
patterns from historical data — not a guess), convert that into concrete resource numbers per
component (requests/sec → instances needed given measured per-instance throughput; data growth/month
→ storage and the timeline until the current provisioned tier runs out), and build in headroom
calibrated to how *spiky* the traffic actually is, not a blanket "2x everything" — a system with
smooth, predictable traffic needs much less headroom than one with sharp, unpredictable spikes (a
flash sale, a viral social moment). Equally important is planning for *failure* capacity, not just
growth capacity: if you run N instances/replicas across 3 availability zones for redundancy, you
must provision enough total capacity that losing one AZ still leaves the remaining two able to
absorb full load (N+1 or better, sized to the actual failure domains you're protecting against) — a
common real incident pattern is a system that "had enough capacity" in aggregate but not enough once
you subtract the capacity that was in the AZ that just failed.

### Cloud Cost

The major cost levers, and where teams commonly overspend without realizing it:
- **Compute:** paying for provisioned capacity that's idle most of the time (over-provisioned instance sizes, forgetting to scale down after a traffic spike, dev/staging environments left running 24/7 when they're only used during business hours). Mitigations: autoscaling tied to real utilization metrics, scheduled shutdown for non-production environments, right-sizing based on actual measured utilization rather than a guessed instance size at launch that's never revisited.
- **Storage:** keeping everything on the most expensive, highest-performance storage tier indefinitely, including old logs, old backups, and infrequently accessed data that would be fine on a cheaper cold-storage tier. Mitigations: lifecycle policies that automatically tier or delete data by age, and actually deleting data that has no retention requirement rather than keeping "just in case."
- **Egress / data transfer:** this is the cost lever engineers underestimate most consistently — cloud providers charge relatively little to bring data *in*, but charge meaningfully for data leaving the network, and especially for cross-region or cross-AZ transfer. A common expensive mistake: chatty cross-AZ or cross-region service calls (each one incurring a small transfer charge that adds up at volume) or serving large assets (video, large API responses) directly from origin instead of through a CDN, paying full egress rates on every request instead of a CDN's typically cheaper edge-serving rate.
- **Data transfer between managed services:** similar to egress — moving large volumes of data between a database and a data warehouse, or replicating across regions, has a direct, often underestimated cost that should be modeled *before* committing to a multi-region or heavy-ETL architecture, not discovered on the first bill.

**Common cost mistakes worth naming explicitly:** provisioning for peak load 24/7 instead of autoscaling; forgetting about egress when comparing "cheap" cross-region architectures against single-region ones; never revisiting reserved-capacity/committed-use discounts as actual usage patterns change; and the subtle one — architectural decisions made for elegance or "best practice" (e.g., splitting into many small microservices, each with its own database, each replicated across 3 AZs) that are individually reasonable but whose *aggregate* fixed cost (baseline compute + storage + redundancy per service, multiplied across dozens of services) dwarfs the actual traffic being served, especially early on. This last point is exactly where cost and over-engineering intersect.

### Over-Engineering

Recognizing over-engineering is a core staff-level skill because juniors and seniors are often the
ones proposing it — usually with good intentions (wanting to build something "right," or
anticipating scale that may never come) — and it's the staff engineer's job to push back
constructively, not just approve because the proposal is technically sound in isolation. **Signals
it's happening:** a design introduces a new technology or pattern (a message queue, a new
microservice, a new database) to solve a problem that hasn't actually occurred yet, justified by
"what if we need to scale" with no concrete number or timeline attached; a design has multiple
layers of abstraction/configurability for requirements that are actually fixed and unlikely to
change (a plugin system for a business rule that's changed once in three years); the proposal's
complexity is justified by "best practice" or "what [famous company] does," without connecting that
practice to this system's actual constraints (a 20-person startup does not have Google's scale
problems, and copying Google's solutions imports Google's operational complexity without Google's
problem or Google's SRE headcount to run it). **How to push back constructively:** don't just say
"that's over-engineered" — ask the proposer to state the concrete scale/requirement that
necessitates this complexity, and if they can't point to one, propose the simpler alternative and
explicitly name what signal would tell you it's time to revisit (e.g., "let's ship this as a single
service; if we see p99 latency on the search path exceed 500ms or write volume exceed X/sec, that's
our trigger to reconsider"). This reframes the pushback from a judgment call about someone's design
taste into a shared, objective threshold — which is both kinder and more effective than a flat "no."

### Operational Burden

Every component added to a system has an ongoing cost beyond its build cost: someone has to be on-
call for it, monitor it, patch its dependencies, understand its failure modes at 3am, and eventually
migrate it when it goes end-of-life. This cost is easy to underweight during design because it's
paid continuously and by (often) a different set of people than whoever proposed the design, over a
much longer time horizon than the project that introduced it. The staff-level discipline is to ask,
for any new piece of infrastructure or service, "who is on-call for this, and have they agreed to
that burden" *before* it ships — a design that quietly makes an existing on-call rotation
responsible for a new failure mode nobody briefed them on is a governance failure, not just a
technical one. Concretely, this weighs directly against build-vs-buy (a self-hosted, self-managed
piece of infrastructure carries more operational burden than a managed equivalent) and against
splitting a monolith into many services faster than the team can build the operational tooling
(monitoring, tracing, runbooks) to support them — see the Monolith to Microservices phased plan's
explicit callout of this risk.

### Build vs Managed Services

A decision framework, extending the general build-vs-buy trade-off (Phase 1) specifically to
infrastructure:

1. **Is this differentiating, or is it plumbing?** If customers would never notice or care whether you self-host this or use a managed service (a message queue, a relational database, a search index, a caching layer), default toward managed — this is almost never your competitive edge.
2. **What's the real TCO, not just the sticker price?** A managed service's monthly bill looks expensive next to "free" self-hosted open source — until you add the engineer-hours for setup, patching, upgrades, scaling, backup/restore testing, and incident response for the self-hosted version, plus the opportunity cost of those engineers not working on product. For most teams below a certain scale, this comparison favors managed decisively.
3. **At what scale does managed stop making sense?** Managed services have their own ceiling — cost that scales linearly (or worse) with usage can eventually exceed what a dedicated team running the equivalent self-hosted infrastructure would cost, especially at very large, steady-state scale. This is a real inflection point for some companies (several well-known "cloud repatriation" stories exist), but it typically only applies once you're spending enough that a dedicated platform team paying for itself is realistic — most companies never reach this point, and estimating it prematurely (assuming you'll be "too big for managed services" while still small) is itself a form of over-engineering.
4. **What's the lock-in and exit cost?** A managed service with a proprietary API (versus one that's API-compatible with an open standard, e.g., a managed Postgres versus a fully proprietary NoSQL API) is cheaper to migrate away from later if the calculus changes — worth weighing even when managed is clearly the right initial choice, since it affects how much of a bet you're making.
5. **Does your team have, or want to build, the specific expertise this requires?** Running a distributed system like Kafka or Elasticsearch well is a real, non-trivial skill set. If the team doesn't have it and doesn't have a strategic reason to build it in-house (it's not your differentiator), a managed offering isn't just cheaper, it's a real risk reduction — self-hosting something the team doesn't deeply understand yet is how "just use open source, it's free" becomes an expensive multi-day outage.

---

## Closing

Every phase above resolves to the same underlying move: name the real constraints, argue both sides
honestly, and commit to a decision that's defensible given *this* system, not a generically
"correct" one. There usually isn't a single right answer — consistency vs availability, build vs
buy, active-active vs active-passive, standardize vs let teams diverge, all resolve differently
depending on numbers and context that only exist in the specific problem in front of you.

*Can I make good engineering decisions when there isn't one correct answer?* That's the question every scenario in this document was built to rehearse — and it's the one a Staff/Principal interview loop is, in the end, entirely designed to answer.
