# Stage 4 — HLD Foundations

> **Framing question:** *How do I go from ambiguous requirements to a defensible architecture?*

This is the first stage where you stop reciting vocabulary (Stage 1: caching, CAP, consistency models), stop reasoning about isolated building blocks (Stage 2: databases, queues, load balancers), and stop analyzing other people's systems (Stage 3: case studies) — and instead **build one yourself, live, in front of an interviewer, starting from nothing but a one-sentence prompt.**

Every phase below is a muscle you will use in every HLD interview you ever take, from a 45-minute new-grad screen to a 90-minute Staff-level onsite loop. The phases are sequential on purpose — skipping one (especially Phase 1 or Phase 2) is the single most common reason strong engineers get weak HLD scores. We will run **two threads** through the whole document as worked examples: a **URL shortener** (simple, good for showing the full method cleanly) and a **ride-sharing pickup service** (complex, good for showing how the method scales up to multi-service systems). Cross-references to caching, consistency, and specific data stores point back at Stage 1 (Building Blocks) and Stage 2 (Infra Deep Dives) — this stage assumes that vocabulary and spends its budget on *judgment and sequencing*.

---

## Table of Contents

1. [Phase 1 — Requirement Discovery](#phase-1--requirement-discovery)
   - [Functional Requirements](#functional-requirements)
   - [Non-Functional Requirements](#non-functional-requirements)
   - [Scope](#scope)
   - [Constraints](#constraints)
   - [Assumptions](#assumptions)
   - [Prioritization (MoSCoW-style)](#prioritization-moscow-style)
   - [The First 5 Minutes: A Full Clarifying-Question Script](#the-first-5-minutes-a-full-clarifying-question-script)
2. [Phase 2 — Capacity Estimation](#phase-2--capacity-estimation)
   - [DAU/MAU](#daumau)
   - [QPS](#qps)
   - [Peak QPS](#peak-qps)
   - [Read/Write Ratio](#readwrite-ratio)
   - [Storage Estimation](#storage-estimation)
   - [Bandwidth](#bandwidth)
   - [Growth Estimation](#growth-estimation)
   - [Back-of-Envelope Calculations](#back-of-envelope-calculations)
   - [Fully Worked Example: Social Feed System](#fully-worked-example-social-feed-system)
   - [Numbers Every Engineer Should Know](#numbers-every-engineer-should-know)
3. [Phase 3 — API & Contract Design](#phase-3--api--contract-design)
   - [Resource Modeling](#resource-modeling)
   - [REST](#rest)
   - [RPC/gRPC Concepts](#rpcgrpc-concepts)
   - [Sync vs Async APIs](#sync-vs-async-apis)
   - [Pagination](#pagination)
   - [Idempotency](#idempotency)
   - [Versioning](#versioning)
4. [Phase 4 — Data Modeling](#phase-4--data-modeling)
   - [Entities](#entities)
   - [Relationships](#relationships)
   - [Access Patterns](#access-patterns)
   - [SQL vs NoSQL Decision Framework](#sql-vs-nosql-decision-framework)
   - [Keys](#keys)
   - [Indexes](#indexes)
   - [Partition Keys](#partition-keys)
   - [Data Ownership](#data-ownership)
5. [Phase 5 — Architecture Decomposition](#phase-5--architecture-decomposition)
   - [Service Boundaries](#service-boundaries)
   - [Monolith vs Microservices](#monolith-vs-microservices)
   - [Domain Boundaries (DDD Bounded Contexts)](#domain-boundaries-ddd-bounded-contexts)
   - [Data Ownership (Service Level)](#data-ownership-service-level)
   - [Sync vs Async Communication](#sync-vs-async-communication)
6. [Phase 6 — Scaling](#phase-6--scaling)
   - [Statelessness](#statelessness)
   - [Horizontal Scaling](#horizontal-scaling)
   - [Caching](#caching)
   - [Replication](#replication)
   - [Sharding](#sharding)
   - [Async Processing](#async-processing)
   - [Hotspot Handling](#hotspot-handling)
7. [Phase 7 — Architecture Review](#phase-7--architecture-review)
   - [Bottlenecks](#bottlenecks)
   - [Failure Paths](#failure-paths)
   - [Security](#security)
   - [Observability](#observability)
   - [Cost](#cost)
   - [Trade-offs](#trade-offs)
   - [Evolution (10x/100x Preview)](#evolution-10x100x-preview)
8. [The HLD Interview Checklist](#the-hld-interview-checklist)

---

## Phase 1 — Requirement Discovery

### Functional Requirements

**What it means in an interview context.** Functional requirements (FRs) are the verbs your system must support — the concrete actions a user or another system performs. In an interview, the FR list is the contract you and the interviewer agree on before any box gets drawn. Every subsequent decision (data model, API shape, service boundary) should trace back to an FR. If you can't point to which FR justifies a component, you probably shouldn't have drawn it yet.

The trap at senior level isn't forgetting to ask for FRs — it's **accepting too many of them**. Interviewers deliberately give an open-ended prompt ("design a ride-sharing pickup service") to see whether you'll try to build Uber's entire product surface in 45 minutes, or whether you'll scope down to a defensible core and say so explicitly.

**Step-by-step method.**
1. Restate the prompt in your own words in one sentence.
2. List the actors: end users, other services, admins, background jobs.
3. For each actor, list the 3-6 core verbs (create, read, update, cancel, search, match...).
4. Explicitly separate "must build" verbs from "would be nice, out of scope" verbs — say this out loud.
5. Write the list somewhere visible (whiteboard/doc) — you will refer back to it in Phase 3 (API design) and Phase 4 (data model).

**Worked mini-example — URL Shortener.**
- Actor: any user (anonymous or authenticated).
- FRs: (1) given a long URL, return a short URL; (2) given a short URL, redirect to the original long URL; (3) optionally, let a user set a custom alias; (4) optionally, expire a link after a TTL.
- Explicitly out of scope unless asked: analytics/click tracking, user accounts, spam/abuse detection — call these out and ask if they're needed.

**Worked mini-example — Ride-Sharing Pickup Service.**
- Actors: rider, driver, dispatch/matching system.
- FRs: (1) rider requests a pickup at a location; (2) system finds and assigns a nearby available driver; (3) driver accepts/rejects; (4) both parties see live location until pickup; (5) trip start is confirmed.
- Explicitly out of scope: pricing/surge, payments, ratings, multi-stop trips — flag them, defer them.

**Common mistakes.** Diving into components before listing verbs. Listing FRs as vague nouns ("notifications," "search") instead of user-facing actions. Silently assuming scope instead of stating it. Trying to cover every feature of the real-world product (Uber, Bitly, Twitter) instead of the 3-5 verbs that matter for the interview's remaining 40 minutes.

### Non-Functional Requirements

**What it means in an interview context.** Non-functional requirements (NFRs) — availability, latency, consistency, durability, scalability — are what actually drive your architecture. Two systems with identical FRs (e.g., "shorten a URL") produce wildly different designs depending on whether redirects must be <10ms globally or whether eventual consistency is acceptable for click counts. Interviewers grade heavily on whether your NFRs are *specific* and whether your later decisions are *traceable* to them.

**Step-by-step method.**
1. Ask about scale first (see Phase 2) — NFRs are meaningless without a scale number attached.
2. Go through the standard NFR checklist and pick 2-4 that actually matter for this system — don't recite all of them:
   - Availability target (99.9%? 99.99%?) and whether downtime is tolerable at all (e.g., payments vs. a news feed).
   - Latency target, and for which operation specifically (read vs. write; p50 vs. p99).
   - Consistency requirement (strong vs. eventual) — tie this to a specific field, not the whole system.
   - Durability (can we ever lose a write?).
   - Scalability (steady growth vs. spiky/viral).
3. State explicit numbers, not adjectives: "fast" is not an NFR, "p99 redirect latency < 100ms" is.
4. Note which NFRs are in tension (strong consistency vs. low latency; high availability vs. strong consistency — this is CAP, see Stage 1) — this tension *is* the design problem you're about to solve.

**Worked mini-example — URL Shortener.** Redirect (read) path: extremely latency-sensitive (<50ms), extremely read-heavy, availability > consistency (a slightly stale redirect target is fine). Shorten (write) path: durability matters (can't lose a mapping), but write QPS is low, so it's not the bottleneck. This asymmetry is exactly why Phase 6 will treat reads and writes completely differently.

**Worked mini-example — Ride-Sharing Pickup.** Location updates: extremely latency-sensitive but individually low-value (losing one GPS ping is fine — eventual consistency, at-most-once is acceptable). Driver-match assignment: must be strongly consistent (never assign two riders to one driver) even at some latency cost. This is a single system with two different consistency requirements in two different subflows — a hallmark of a senior-level answer.

**Common mistakes.** Giving one blanket consistency/availability answer for the whole system instead of per-operation. Stating NFRs without numbers. Forgetting durability entirely (it's invisible until an outage). Not naming the CAP-style tension explicitly, which is usually exactly what the interviewer wants to hear you reason about.

### Scope

**What it means in an interview context.** Scope is the boundary line: what you will design in detail versus what you will name but not expand. In a time-boxed interview, scope management is a signal of seniority — junior candidates try to design everything shallowly; senior candidates design a core deeply and defer the rest with a one-line justification.

**Step-by-step method.**
1. After listing FRs, group them into "core flow" (2-3 items you'll design end-to-end) and "secondary" (named, deferred).
2. State the boundary out loud: "I'll focus on the create-short-URL and redirect flows in depth. I'll mention analytics and custom aliases but won't design their storage in detail unless we have time."
3. Re-check scope after Phase 2 (capacity) — sometimes a "secondary" feature turns out to dominate the storage/traffic profile (e.g., click analytics can outweigh the URLs themselves), and you should flag that trade-off even if you don't fully design it.
4. Revisit scope at the end if time allows, and expand into a previously-deferred item — this is a strong closing move.

**Worked mini-example.** For the ride-sharing service, core scope = request → match → accept → live tracking → trip start. Deferred: pricing engine, payment processing, ratings/reviews, driver onboarding. State this plainly in the first five minutes.

**Common mistakes.** Never stating scope at all (interviewer has to guess what you're planning to cover). Setting scope once and never revisiting it as new information (from capacity estimates or interviewer hints) arrives. Treating "out of scope" as "doesn't exist" rather than "named and deliberately deferred" — a good architecture still needs a seam where the deferred feature would plug in later (see Phase 7's Evolution section).

### Constraints

**What it means in an interview context.** Constraints are the boundaries imposed on you, not chosen by you: team size, existing infrastructure, compliance regime, budget, latency SLAs imposed by a client contract, a mandate to use a particular cloud or a particular existing service. At Staff level especially, interviewers may drop constraints mid-interview ("actually, this must run in a data-residency-restricted region" or "we can't use a managed service, everything is on-prem") specifically to see whether you adapt your design or ignore the new information.

**Step-by-step method.**
1. Ask whether there are technology constraints (must/must-not use particular stores, cloud, language).
2. Ask about compliance/regulatory constraints (PII handling, data residency, PCI-DSS if payments are involved — highly relevant for PayPal-style interviews).
3. Ask about organizational constraints (existing services you must integrate with, team ownership boundaries).
4. When a constraint arrives mid-interview, explicitly say how it changes your design rather than silently ignoring it — this is graded.

**Worked mini-example — Ride-Sharing.** If told "drivers' location history is subject to data-retention regulation, must be deletable within 30 days on request," this directly affects Phase 4 (need per-record TTL or a deletion pipeline) and Phase 7 (must design a deletion/audit path).

**Common mistakes.** Not asking about constraints at all and assuming a green-field, unconstrained world. Treating a constraint as an FR (they're different: an FR is what the system does, a constraint is what limits how you build it). Ignoring a constraint dropped later in the interview because your whiteboard is already "done."

### Assumptions

**What it means in an interview context.** No interview gives you complete information, and asking to clarify literally everything wastes your limited time. The skill is stating an assumption explicitly and moving on — this shows judgment and gives the interviewer an easy hook to correct you if you assumed wrong, without derailing the session.

**Step-by-step method.**
1. When a data point isn't given and isn't worth spending clarification time on, state your assumption out loud: "I'll assume a 100:1 read:write ratio for redirects vs. shortens unless you tell me otherwise."
2. Keep a running visible list of assumptions (a corner of the whiteboard) so you and the interviewer can revisit them.
3. Prefer *round, defensible, industry-typical* numbers when assuming (see Phase 2's "numbers every engineer should know").
4. If an assumption turns out to be wrong mid-interview, don't panic — adjust and briefly note what changes downstream.

**Worked mini-example.** "I'll assume most links are read within days of creation and rarely after, so I can assume a large fraction of reads are cache-hittable" — this assumption directly justifies a caching strategy in Phase 6.

**Common mistakes.** Silently assuming without saying so (interviewer can't correct you, and it looks like you didn't consider it). Making assumptions on things that were cheap to just ask about. Making an assumption and then never using it anywhere in the design (padding, not substance).

### Prioritization (MoSCoW-style)

**What it means in an interview context.** Once FRs and NFRs are listed, you need an explicit ranking so that if you run out of time (you will), you've spent it on the highest-value parts. MoSCoW — **M**ust have, **S**hould have, **C**ould have, **W**on't have (this round) — is a lightweight, interview-friendly version of this. You don't need the formal acronym; you need the behavior: rank, then build in rank order.

**Step-by-step method.**
1. Tag every FR/NFR as Must / Should / Could / Won't.
2. Must = the core verb(s) that define the system's reason to exist (for a URL shortener: shorten + redirect).
3. Should = valuable but the system is still recognizable without it (custom alias, expiry).
4. Could = nice, clearly time-permitting (analytics dashboard).
5. Won't = explicitly named and dropped for this session (user accounts, admin portal).
6. Build your design walking through Musts first, fully, before spending any time on Shoulds.

**Worked mini-example — Ride-Sharing.** Must: request pickup, match driver, live tracking to pickup. Should: cancellation flow, ETA updates. Could: driver-side incentives, ratings. Won't: payments, pricing engine.

**Common mistakes.** Spending 20 of your 45 minutes on a "Could" (e.g., an elaborate analytics pipeline) while the "Must" (core matching flow) is still hand-wavy. Not revisiting priority when the interviewer gives a hint like "let's go deeper on the matching algorithm" — that's a live signal to re-rank.

### The First 5 Minutes: A Full Clarifying-Question Script

This is the script a strong senior/staff candidate actually runs, near-verbatim, in the opening minutes of an HLD interview. Adapt names/nouns to the prompt; the structure is reusable for any system.

> **1. Restate and scope the problem.**
> "So we're designing [system] — let me make sure I have the core use case right: [one-sentence restatement]. Is that the right scope, or is there a narrower/broader version you want me to focus on?"
>
> **2. Core functional requirements.**
> "What are the must-have actions? For [system], I'm assuming: [list 2-4]. Anything I'm missing, and is there anything on this list that's actually out of scope for today?"
>
> **3. Users and scale.**
> "Roughly how many users / requests are we designing for — are we talking thousands, millions, or hundreds of millions of daily active users? Is traffic steady or spiky (e.g., time-of-day peaks, viral spikes, seasonal)?"
>
> **4. Read/write shape.**
> "Is this read-heavy, write-heavy, or roughly balanced? [state your guess and ask them to confirm/correct]"
>
> **5. Consistency vs. availability.**
> "If a partition or node failure happens, do we prefer staying available with possibly-stale data, or rejecting requests to stay strictly consistent? Does that answer differ between [operation A] and [operation B]?" — e.g., "does it differ between placing an order and viewing a product page?"
>
> **6. Latency expectations.**
> "Is there a target latency, e.g., p99 under X ms for [core read/write]? Is this global (multi-region) or single-region for now?"
>
> **7. Data retention / compliance.**
> "Any compliance constraints — PII, data residency, retention/deletion requirements? Any regulatory context I should design around (this matters a lot in fintech/payments contexts)?"
>
> **8. Existing systems / constraints.**
> "Are we greenfield, or integrating with/replacing an existing system? Any technology constraints — must use, must avoid?"
>
> **9. Confirm priority.**
> "Given time, I'll design [Must-have core flow] in depth first, then come back to [Should-haves] if we have time — does that match what you want to see?"

Notice the pattern: **restate → FRs → scale → read/write shape → consistency/latency NFRs → constraints → priority confirmation.** This order matters — scale (step 3) must come before you can meaningfully answer read/write ratio or latency targets, and consistency/latency (steps 5-6) should come before you draw a single box, because they determine which boxes you'll draw.

---

## Phase 2 — Capacity Estimation

### DAU/MAU

**What it means in an interview context.** Daily/Monthly Active Users anchor every other number you'll compute. Interviewers want to see you convert a user-facing scale ("100 million users") into an engineering-facing load number (QPS, storage) through a clear, stated chain of reasoning — not a memorized final number.

**Step-by-step method.**
1. Ask for or assume a DAU figure (round number: 1M, 10M, 100M).
2. Ask/assume actions-per-user-per-day for each core FR (e.g., "average user shortens 0.1 URLs/day and clicks 5 short links/day").
3. Multiply DAU × actions/user/day = total daily actions per FR.
4. State the assumption explicitly if MAU is given instead of DAU (common ratio: DAU ≈ 10-20% of MAU for a typical consumer app; higher for daily-habit apps).

**Worked example.** DAU = 10M for a social feed app. Assume each user posts 0.5 times/day and views their feed 10 times/day (each feed view fetches ~20 posts).

**Common mistakes.** Treating DAU and MAU as interchangeable. Forgetting to state the actions-per-user assumption (the DAU number alone tells you nothing). Using an unrealistically round but implausible action rate (e.g., "every user posts 100 times a day") without sanity-checking against real-world intuition.

### QPS

**What it means in an interview context.** Queries per second is the number that actually sizes your servers, connection pools, and cache layers. It's derived from DAU × actions-per-day, divided down to a per-second average.

**Step-by-step method.**
1. `Total daily requests = DAU × actions-per-user-per-day` (per FR, since read and write actions differ).
2. `Average QPS = Total daily requests / 86,400 seconds` (86,400 = seconds/day; round to 100,000 for quick mental math).
3. Do this **separately** for reads and writes — this is the number that will drive the read/write ratio discussion.

**Worked example (continuing feed system).** Daily feed views = 10M users × 10 views/day = 100M views/day. Each view fetches ~20 posts → 2B post-reads/day. Average read QPS = 2,000,000,000 / 100,000 ≈ **20,000 QPS** (using the ~100K seconds/day approximation).

**Common mistakes.** Forgetting the divide-by-86,400 step and reporting a daily total as if it were QPS. Not separating read QPS from write QPS. Doing needlessly precise arithmetic instead of round numbers — precision here is false confidence; the goal is order-of-magnitude.

### Peak QPS

**What it means in an interview context.** Real traffic isn't uniform across 24 hours — it has a daily peak (evening usage spikes), and some systems have extreme spikes (viral events, flash sales, a payment provider's Black Friday traffic). Peak QPS, not average QPS, is what determines your provisioning and your scaling story — this is the number that actually threatens to take your system down.

**Step-by-step method.**
1. Apply a peak factor to average QPS — a common, interview-safe default is **2-3x** average for typical diurnal traffic patterns.
2. For systems with known spiky behavior (flash sales, viral content, breaking news), state a higher multiplier explicitly and justify it (e.g., 10x for a flash-sale checkout system).
3. Always state which multiplier you're using and why — this is a place where "I'm assuming 3x for a typical daily peak; if this product has viral/flash-sale dynamics that would be much higher" shows judgment.

**Worked example.** Average read QPS = 20,000. Peak (3x for evening usage spike) = **60,000 QPS**. This peak number, not the average, is what you provision cache/DB capacity for in Phase 6.

**Common mistakes.** Designing capacity around average QPS only (system falls over at the first real traffic peak — a classic interview "gotcha" the interviewer will probe). Picking a peak multiplier with no justification. Forgetting that peak factor can differ from write peak to read peak (e.g., write peak for a ticket-sale system at on-sale time can be 50-100x average, while read peak might only be 3x).

### Read/Write Ratio

**What it means in an interview context.** The ratio between read and write volume is one of the highest-leverage numbers in the whole interview — it directly determines whether you lean on caching, read replicas, CQRS-style separation, or optimize for write throughput instead (see Stage 1 caching, Stage 2 replication).

**Step-by-step method.**
1. Compute read QPS and write QPS independently (Phase 2's QPS step, per FR).
2. Express as a ratio (e.g., 100:1 read-heavy, or close to 1:1 balanced).
3. State the architectural implication immediately: "This is heavily read-skewed, so I'll prioritize caching and read replicas over write-optimized storage."

**Worked example — URL Shortener.** Assume 100M redirects/day (reads) vs. 1M new shortens/day (writes) → **100:1 read:write**. This single ratio justifies putting a cache in front of the redirect path and not worrying much about write throughput.

**Worked example — Ride-Sharing location pings.** Location updates from active drivers might be close to **write-heavy** (every driver pings every few seconds) with comparatively few reads (riders checking ETA) — the opposite profile, justifying a different design (ingest pipeline + in-memory latest-location store rather than a cache-in-front-of-DB pattern).

**Common mistakes.** Assuming every system is read-heavy (many aren't — telemetry, logging, location tracking, IoT ingestion are write-heavy). Computing the ratio but never using it to justify a design decision later.

### Storage Estimation

**What it means in an interview context.** Storage sizing tells you whether you need a single database instance, a sharded fleet, or a specialized large-object store — and it directly informs the SQL vs. NoSQL and partitioning discussions in Phase 4.

**Step-by-step method.**
1. Define the size of one record/row/object in bytes (list every field with a byte estimate).
2. Multiply by records-created-per-day (from your write QPS numbers).
3. Multiply by retention period (or by projected growth over N years — see Growth Estimation below).
4. Add overhead for indexes/replication (rule of thumb: +20-50% for indexes, xN for replication factor).
5. Convert to human-readable units (GB/TB/PB) using powers-of-2 approximations (see "Numbers Every Engineer Should Know").

**Worked example — URL Shortener.** One record: short code (7 bytes) + long URL (avg 100 bytes) + metadata (created_at, user_id, expiry ≈ 20 bytes) ≈ **~130 bytes/record**, round to 150 with overhead. At 1M new shortens/day × 365 days × 5 years ≈ 1.8B records. 1.8B × 150 bytes ≈ **270 GB** raw — comfortably fits on a single well-indexed database or a small sharded cluster; this number is what tells you *not* to over-engineer this part of the ride-sharing/URL-shortener design.

**Common mistakes.** Forgetting metadata/index overhead and only counting the "primary" field. Forgetting replication factor when sizing total disk footprint. Spending too long computing exact byte counts instead of reasonable round estimates — the goal is "does this fit on one box, few boxes, or do we need serious sharding," not a spreadsheet-grade number.

### Bandwidth

**What it means in an interview context.** Bandwidth (ingress/egress) estimation reveals whether network I/O, not CPU or disk, is your bottleneck — especially relevant for media-heavy systems (video, images) or high-fanout systems (feeds, notifications).

**Step-by-step method.**
1. `Bandwidth = QPS × average payload size` (do ingress and egress separately — they're often asymmetric).
2. Convert to a standard unit (MB/s or Gbps) and sanity-check against typical NIC/link capacity (a single modern server NIC is commonly 10-25 Gbps; a CDN edge or object store scales far beyond a single box).

**Worked example (feed system egress).** Peak read QPS = 60,000, each response ≈ 5KB (20 posts × ~250 bytes each, JSON) → 60,000 × 5KB = 300,000 KB/s = **~300 MB/s ≈ 2.4 Gbps** egress at peak — well within a CDN's capability but a strong signal that a CDN/edge cache (not the origin) should serve this traffic (ties back to Stage 1 caching/CDN concepts).

**Common mistakes.** Ignoring bandwidth entirely and only estimating storage/QPS (bandwidth is often the actual bottleneck for media platforms). Confusing bits and bytes (a very common arithmetic slip — always state which unit you're using).

### Growth Estimation

**What it means in an interview context.** Interviewers often ask you to project 3-5 years out, both to test your arithmetic and to see whether you design a system that has an obvious, non-catastrophic upgrade path (see Phase 7's Evolution section and Stage 8's scaling-ladder exercise).

**Step-by-step method.**
1. State a growth rate assumption (e.g., "assume DAU grows 2x year-over-year for 3 years, then flattens" or simply "assume linear growth for the storage estimate, flag that real growth is usually front-loaded and non-linear").
2. Recompute your Phase 2 numbers (DAU → QPS → storage) at the future date, not just today.
3. Identify at what point (which year, which multiple) a single-node or unsharded design would break — this is the number that justifies designing for sharding/horizontal scaling *now* vs. later.

**Worked example.** URL shortener at 1M writes/day today; assume 3x growth over 5 years → ~3M writes/day, storage ≈ 270GB × 3 ≈ 800GB. Still single-cluster-friendly, so: "I won't shard from day one, but I'll choose a partition key now (Phase 4) so that sharding later is a config change, not a rewrite."

**Common mistakes.** Only estimating for today's scale and never projecting forward (interviewers explicitly probe growth to test long-term thinking, a Staff-level differentiator). Over-engineering for a 100x future that may never arrive at the cost of a working V1 (the "evolution" answer should be "here's the seam where we'd shard," not "let's shard from day one" — see Phase 6).

### Back-of-Envelope Calculations

**What it means in an interview context.** This is the meta-skill underlying every number above: doing defensible arithmetic quickly, out loud, with round numbers, in a way the interviewer can follow and sanity-check in real time.

**Step-by-step method / checklist.**
1. Always round: 86,400 seconds/day → 100,000; 1024 → 1000; use powers of 10 unless precision genuinely matters.
2. State every assumption as you use it — don't do silent mental math.
3. Work in one direction at a time (DAU → daily actions → QPS → peak QPS; separately, DAU → storage) rather than trying to compute everything simultaneously.
4. Sanity-check the final number against intuition ("60,000 QPS peak — is that plausible for a mid-size social app? Yes, that's in the range of real systems at that DAU").
5. Write the chain of numbers on the board/doc as you go so the interviewer can follow and correct any wrong assumption early.

**Common mistakes.** Doing math in your head silently and only announcing the final answer (interviewer can't follow your reasoning, and a single silent error propagates undetected). Excessive precision (calculating to the exact byte/dollar) that wastes time without adding signal. Getting stuck doing arithmetic instead of stating an assumption and moving on when a number isn't given.

### Fully Worked Example: Social Feed System

Let's run one complete, start-to-finish capacity estimation with every step shown, for a Twitter/Instagram-style social feed.

**Given/assumed:** DAU = 50 million. Each user posts an average of 0.2 times/day. Each user opens their feed 8 times/day, and each feed load fetches 20 posts. Each post record averages 300 bytes (text + metadata; media stored separately in blob storage and out of scope here). Data retained for 5 years. Read:write ratio and peak factor to be derived.

**Step 1 — Daily actions.**
- Writes (posts created): 50,000,000 × 0.2 = **10,000,000 posts/day**.
- Feed loads: 50,000,000 × 8 = 400,000,000 feed loads/day.
- Reads (post-reads via feed): 400,000,000 × 20 = **8,000,000,000 post-reads/day**.

**Step 2 — Average QPS.**
- Write QPS = 10,000,000 / 100,000 (rounded seconds/day) = **100 QPS**.
- Read QPS = 8,000,000,000 / 100,000 = **80,000 QPS**.

**Step 3 — Read/write ratio.**
- 80,000 : 100 = **800:1**, heavily read-skewed → caching and read replicas are the headline design decisions (Phase 6), not write optimization.

**Step 4 — Peak QPS.**
- Assume 3x diurnal peak factor (no viral/flash-sale dynamic stated):
  - Peak write QPS ≈ 100 × 3 = **300 QPS**.
  - Peak read QPS ≈ 80,000 × 3 = **240,000 QPS**.

**Step 5 — Storage over 5 years.**
- Posts over 5 years: 10,000,000/day × 365 × 5 ≈ **18.25 billion posts**.
- Raw storage: 18.25B × 300 bytes ≈ 5,475,000,000,000 bytes ≈ **5.5 TB** raw text/metadata.
- Add index overhead (+30%) ≈ **7.1 TB**.
- Add replication factor 3 (Stage 2 concept — standard for durability) ≈ **~21 TB** total disk footprint across the fleet.
- (Note: media/images/video would be stored separately in object storage, typically 100-1000x larger than the text metadata — flag this explicitly as a separate, much bigger estimate if media is in scope.)

**Step 6 — Bandwidth (read path, peak).**
- Each feed response ≈ 20 posts × 300 bytes ≈ 6 KB (plus HTTP/JSON overhead, round to ~8KB).
- Peak feed-load QPS ≈ 240,000 / 20 (posts per load) = 12,000 feed-loads/sec at peak.
- Egress ≈ 12,000 × 8KB = 96,000 KB/s ≈ **~96 MB/s ≈ 0.77 Gbps** at peak for the text/metadata payload alone — very CDN/cache-friendly.

**Conclusion drawn from the numbers:** 800:1 read-skew + a comfortably-sized 21TB dataset + sub-1Gbps text egress tells us this is a "cache aggressively, read-replica the database, and don't over-think write-path sharding yet" system — exactly the kind of design-justifying conclusion an interviewer wants to see you state explicitly, not just the arithmetic itself.

### Numbers Every Engineer Should Know

**Latency numbers (approximate, order-of-magnitude — memorize the *relative* gaps, not exact digits):**

| Operation | Approx. Latency |
|---|---|
| L1 cache reference | ~1 ns |
| Branch mispredict | ~5 ns |
| L2 cache reference | ~7 ns |
| Mutex lock/unlock | ~25 ns |
| Main memory (RAM) reference | ~100 ns |
| Compress 1KB with a fast compressor | ~10 μs |
| Send 1KB over 1 Gbps network | ~10 μs |
| Read 4KB randomly from SSD | ~150 μs |
| Read 1MB sequentially from RAM | ~ a few μs |
| Round trip within same datacenter | ~0.5 ms |
| Read 1MB sequentially from SSD | ~1 ms |
| Disk seek (spinning HDD) | ~10 ms |
| Read 1MB sequentially from HDD | ~20-30 ms |
| Round trip between continents (e.g., US↔Europe) | ~100-150 ms |

**Takeaway to state in interviews:** memory is ~100x faster than SSD, SSD is ~10-100x faster than spinning disk for random access, and a cross-continent network round trip dwarfs almost any local disk/memory operation — which is *the* justification for caching, regional replication, and CDNs.

**Powers of 2 / storage sizing shortcuts:**

| Power | Value | Approx. |
|---|---|---|
| 2^10 | 1,024 | ~1 thousand (KB) |
| 2^20 | ~1,048,576 | ~1 million (MB) |
| 2^30 | ~1.07 billion | ~1 billion (GB) |
| 2^40 | ~1.1 trillion | ~1 trillion (TB) |
| 2^50 | ~1.13 quadrillion | ~1 quadrillion (PB) |

**Other standing assumptions worth memorizing:**
- Seconds in a day ≈ 86,400 → round to **100,000** for quick mental math.
- A typical ASCII character ≈ 1 byte; a typical UUID ≈ 16 bytes (36 as a string); a typical timestamp ≈ 8 bytes.
- A single modern DB server can often handle low-thousands to tens-of-thousands of simple QPS depending on query complexity and hardware — beyond that, think replicas/caching/sharding.
- Availability math: 99.9% ("three nines") ≈ 8.7 hours of downtime/year; 99.99% ("four nines") ≈ 52 minutes/year; 99.999% ("five nines") ≈ 5 minutes/year. Knowing this lets you translate an SLA into a gut-check on architecture complexity required.

---

## Phase 3 — API & Contract Design

### Resource Modeling

**What it means in an interview context.** Before choosing REST vs. RPC or writing endpoint signatures, you need to decide what your *nouns* are — the resources the API exposes. This step is where your Phase 1 FRs and Phase 4 entities meet the outside world. Getting resource modeling right makes the rest of API design almost mechanical; getting it wrong produces an API that's awkward for every client that touches it.

**Step-by-step method.**
1. List the nouns from your FRs (e.g., `ShortURL`, `Ride`, `Driver`, `Post`).
2. Decide which are top-level resources (independently addressable, have their own ID) vs. sub-resources/fields on another resource.
3. Identify the actions on each resource and map them to HTTP verbs (REST) or RPC method names.
4. Check for actions that don't fit CRUD cleanly (e.g., "accept a ride," "cancel a trip") — these need either a sub-resource ("POST /rides/{id}/acceptance") or an RPC-style verb-based call, and you should consciously pick one and say why.

**Worked example — Ride-Sharing.** Resources: `Ride` (id, rider_id, pickup_location, status, driver_id), `Driver` (id, location, availability_status), `RideRequest` (the act of requesting, which becomes a `Ride` once matched). The "accept" action becomes `POST /rides/{id}/accept` — an action-oriented sub-resource, because "accept" isn't a natural CRUD verb on `Ride`.

**Common mistakes.** Modeling verbs as resources or vice versa (e.g., a `/shorten` endpoint with no `ShortURL` resource concept behind it makes later pagination/versioning awkward). Overfitting everything into strict CRUD when the domain has genuine state-transition actions (accept/cancel/complete) that read better as explicit actions.

### REST

**What it means in an interview context.** REST is the default lingua franca for client-facing and many service-to-service APIs. Interviewers expect you to sketch 3-6 endpoints for your core flow with correct verb/status-code usage — not a full OpenAPI spec, but enough to show you think about the API as a contract, not an afterthought.

**Step-by-step method.**
1. Map each core FR to `METHOD /resource(/{id})(/sub-resource)`.
2. Use HTTP verbs correctly: GET (read, safe/idempotent), POST (create, non-idempotent unless keyed — see Idempotency), PUT/PATCH (update, PUT = full replace/idempotent, PATCH = partial), DELETE (remove, idempotent).
3. Define request/response bodies for the 2-3 most important endpoints only — don't spec every field for every resource.
4. Pick sensible status codes (200/201/204 for success variants, 400/404/409/429 for common error cases) and mention at least one non-happy-path status explicitly (shows you think about failure, tying into Phase 7).

**Worked example — URL Shortener.**
```
POST /api/v1/urls
  Request:  { "long_url": "https://example.com/...", "custom_alias": "optional", "ttl_days": 30 }
  Response: 201 { "short_url": "https://sho.rt/aZ9k2", "expires_at": "..." }

GET /sho.rt/{code}
  Response: 301/302 redirect to long_url
  Errors:   404 if code not found or expired, 410 if explicitly revoked

GET /api/v1/urls/{code}/stats   (secondary/"Should have" feature)
  Response: 200 { "clicks": 1234, "created_at": "..." }
```

**Worked example — Ride-Sharing.**
```
POST /api/v1/rides                  -> create a ride request (rider)
GET  /api/v1/rides/{id}             -> poll/get current ride status
POST /api/v1/rides/{id}/accept      -> driver accepts (idempotency key required)
POST /api/v1/rides/{id}/cancel      -> either party cancels
```

**Common mistakes.** Using GET for state-changing operations (breaks caching/idempotency assumptions). Using 200 for everything instead of meaningful status codes. Over-speccing every field of every resource instead of focusing on the 2-3 endpoints central to the core flow. Forgetting to design at least one error path.

### RPC/gRPC Concepts

**What it means in an interview context.** For internal service-to-service communication (as opposed to public/client-facing APIs), RPC-style contracts — especially gRPC — are often a better fit than REST: strongly-typed schemas (protobuf), efficient binary serialization, built-in streaming, and lower per-call overhead. Interviewers want to hear you choose REST vs. RPC deliberately, not by default.

**Step-by-step method.**
1. Identify which API boundaries in your design are public/client-facing (favor REST/GraphQL for broad client compatibility, human-readability, caching via HTTP semantics) vs. internal service-to-service (favor gRPC for performance, strong typing, streaming).
2. If you propose gRPC, name the specific advantage you're using: protobuf schema + codegen for type safety across services, HTTP/2 multiplexing for lower latency, or bidirectional streaming (e.g., driver location streaming).
3. Don't over-claim — gRPC is harder to debug from a browser/curl and has a steeper operational learning curve; mention this trade-off if pressed.

**Worked example — Ride-Sharing.** The mobile app talks to a public REST/GraphQL gateway (Phase 5 API layer). Internally, the Matching Service streams location updates to the Dispatch Service via a gRPC bidirectional stream — a natural fit since it's continuous, structured, internal, and latency-sensitive.

**Common mistakes.** Proposing gRPC everywhere "because it's faster" without acknowledging that client-facing APIs benefit from REST's ubiquity and cacheability. Not knowing the concrete gRPC feature (streaming, protobuf typing, HTTP/2) that justifies the choice — a vague "gRPC is more efficient" doesn't score as well as naming the specific mechanism.

### Sync vs Async APIs

**What it means in an interview context.** Not every operation should block the caller until fully complete. Long-running or fan-out-heavy operations (e.g., "process a video," "match a ride across a large city," "send a notification to a million followers") are better modeled as async: accept-and-acknowledge immediately, do the work in the background, notify or let the client poll for completion.

**Step-by-step method.**
1. For each core API, ask: "Can this complete within a normal request timeout window (sub-second to a few seconds)?" If yes → sync. If no, or if it fans out to many downstream effects → async.
2. Design the async contract explicitly: what does the initial call return (a job/request ID, a 202 Accepted), and how does the client learn the result (poll a status endpoint, webhook callback, WebSocket/push, or a client-side long-poll)?
3. State the trade-off: sync is simpler for the client but couples client and server timing; async decouples them but adds complexity (need a status model, possibly a notification channel).

**Worked example — Ride-Sharing.** `POST /rides` returns immediately (202) with a `ride_id` and status `"searching"` — the actual driver match may take several seconds and involves scanning nearby drivers, so it's async under the hood even though it's presented as one API call. The client then polls `GET /rides/{id}` or subscribes via WebSocket for status changes (`matched`, `driver_en_route`, etc.).

**Common mistakes.** Making everything synchronous, including operations that clearly fan out or take variable time (leads to client-side timeouts and poor UX at scale). Making everything async "for scalability" even for genuinely fast operations (adds needless complexity and latency for the common case). Forgetting to design *how* the client learns the async result — an async API without a completion-notification story is half a design.

### Pagination

**What it means in an interview context.** Any list-returning endpoint (feed, search results, ride history) needs pagination, and the offset-vs-cursor choice is a classic, well-defined trade-off interviewers love to probe because it reveals whether you've actually operated a system at scale.

**Step-by-step method / trade-off table.**

| | Offset-based (`?offset=100&limit=20`) | Cursor-based (`?cursor=<opaque_token>&limit=20`) |
|---|---|---|
| Implementation | Simple `LIMIT/OFFSET` SQL, or skip N | Uses a stable sort key (e.g., last-seen ID/timestamp) as the "where to resume" marker |
| Jump to arbitrary page | Yes (page 5 directly) | No (only forward/backward from a cursor) |
| Correctness under concurrent writes | **Poor** — items inserted/deleted mid-pagination shift offsets, causing skips or duplicates | **Good** — cursor is relative to actual data, immune to shifts before/after it |
| Performance at large offsets | **Poor** — `OFFSET 1000000` still scans/skips a million rows in many databases | **Good** — indexed lookup from the cursor position regardless of depth |
| Best for | Small, mostly-static datasets, admin UIs needing "go to page N" | Infinite-scroll feeds, high-write-rate lists, anything at scale |

1. Default to cursor-based pagination for any high-scale, frequently-mutated list (feeds, search, activity logs).
2. Use offset-based only for small, rarely-changing, or admin-facing lists where "jump to page N" genuinely matters.
3. Make the cursor an opaque, server-defined token (don't expose raw internal IDs/offsets as a contract — lets you change the underlying implementation later).

**Worked example — Social Feed.** `GET /feed?cursor=<opaque>&limit=20` returns 20 posts plus a `next_cursor`. The cursor internally encodes (last_post_timestamp, last_post_id) to break ties, so pagination remains stable even as new posts are inserted above the current view.

**Common mistakes.** Defaulting to offset pagination without acknowledging the deep-offset performance cliff and the skip/duplicate correctness bug under concurrent writes. Exposing raw database IDs as cursors (leaks implementation detail, breaks if you change sort order or storage). Forgetting a `limit` cap (unbounded page sizes are a resource-exhaustion risk — a security/reliability point worth mentioning in Phase 7).

### Idempotency

**What it means in an interview context.** Networks retry. Clients retry. Load balancers retry. Any non-idempotent write operation (especially "create" and "charge money") exposed over an unreliable network needs an idempotency mechanism, or a retried request creates a duplicate ride, a duplicate charge, or a duplicate short URL. This is a favorite probe question at payments-adjacent companies (PayPal explicitly) because double-charging is a direct financial/trust failure.

**Step-by-step method.**
1. Identify every write endpoint that is *not* naturally idempotent (POST-create, "accept," "charge") — GET/PUT/DELETE are naturally idempotent by HTTP semantics if implemented correctly; POST usually is not.
2. Require the client to generate and send an **idempotency key** (a UUID, typically in a header like `Idempotency-Key`) with each such request.
3. On the server, store `(idempotency_key → result)` for a bounded time window; on a retried request with the same key, return the stored result instead of re-executing the operation.
4. Decide where this dedup store lives (fast key-value store, e.g., Redis, keyed by idempotency key, with a TTL) and what happens on a key collision mid-flight (return "in progress"/409, or block until the first completes).

**Worked example — Ride-Sharing accept.** `POST /rides/{id}/accept` with header `Idempotency-Key: <driver-generated-uuid>`. If the driver's app times out and retries the same accept call with the same key, the server recognizes the key, sees the ride is already accepted by this driver, and returns the same success response — instead of erroring or (worse) accidentally reassigning.

**Worked example — Payments-adjacent.** `POST /payments/charge` with an idempotency key is the canonical example: without it, a client-side retry after a timeout could double-charge a customer. This is precisely why idempotency keys are considered baseline hygiene, not an advanced feature, at any payments company.

**Common mistakes.** Assuming POST is safe to retry without a key (it isn't, by default). Using the client's own data (e.g., ride_id) instead of a dedicated random idempotency key, which can't distinguish "same logical request retried" from "legitimately create a second ride." Forgetting to bound the idempotency-key store with a TTL (unbounded storage growth) and forgetting to define behavior for concurrent retries of the same key (race condition if not handled with a lock/compare-and-swap).

### Versioning

**What it means in an interview context. ** APIs evolve, and interviewers want to know you have a plan to change a contract without breaking every existing client — relevant for both public APIs and internal service contracts.

**Step-by-step method.**
1. Pick a versioning strategy and state why: URI versioning (`/api/v1/...`, `/api/v2/...` — simple, visible, easy to route, but proliferates URLs), header versioning (`Accept: application/vnd.company.v2+json` — cleaner URLs, less visible/discoverable), or field-level additive evolution (only ever add optional fields, never remove/rename — avoids versioning entirely for a long time but doesn't handle breaking changes).
2. State your backward-compatibility policy: how long old versions are supported, and what counts as a breaking vs. non-breaking change (adding an optional field = non-breaking; removing/renaming a field or changing a type = breaking).
3. For internal gRPC/protobuf contracts, mention protobuf's built-in additive-evolution model (new optional fields, reserved field numbers for removed fields) as the natural fit.

**Worked example.** URL shortener's public API starts at `/api/v1/urls`. When a `v2` needs to change the response shape substantially (e.g., splitting `short_url` into `code` + `domain`), introduce `/api/v2/urls`, keep `v1` running for a stated deprecation window (e.g., 6-12 months), and communicate via changelog/deprecation headers.

**Common mistakes.** No versioning strategy at all until a breaking change is unavoidable and there's no plan for existing clients. Treating every field addition as requiring a new version (unnecessary churn — additive changes should be non-breaking by convention). Not stating a deprecation/sunset policy for old versions.

---

## Phase 4 — Data Modeling

### Entities

**What it means in an interview context.** Entities are the nouns from Phase 3's resource modeling, now defined precisely enough to store: field names, types, and which fields are required vs. optional. This is where the API contract and the storage layer connect.

**Step-by-step method.**
1. Take the resource list from Phase 3 and, for each, list fields with types.
2. Mark the primary identifier for each entity (see Keys, below).
3. Note which fields are mutable vs. immutable (immutable fields, like `created_at` or an event's payload, are candidates for cheaper storage/caching strategies).
4. Keep this at "whiteboard schema" depth — field name + type + one-line purpose — not full DDL, unless the interviewer asks for exact SQL.

**Worked example — URL Shortener `ShortURL` entity.**
```
ShortURL {
  code:        string (7 chars, PK)
  long_url:    string
  created_by:  user_id (nullable, if anonymous allowed)
  created_at:  timestamp
  expires_at:  timestamp (nullable)
  click_count: integer (denormalized counter, eventually consistent)
}
```

**Common mistakes.** Jumping straight to SQL DDL syntax when a simple field list would communicate the same thing faster. Forgetting nullable/optional fields that were implied by Phase 1 (e.g., anonymous vs. authenticated creation). Not distinguishing which fields are read-hot vs. write-hot (the `click_count` above is exactly the kind of field that deserves separate handling — see Hotspot Handling in Phase 6).

### Relationships

**What it means in an interview context.** Once entities exist, you need to state how they relate: one-to-one, one-to-many, many-to-many — because this drives whether you need a join table, an embedded array, a foreign key, or a separate mapping collection, and it drives query patterns in Phase 4's Access Patterns step.

**Step-by-step method.**
1. For each pair of related entities, state the cardinality (1:1, 1:N, N:M).
2. For N:M relationships, decide whether to model an explicit join entity (needed if the relationship itself has attributes, e.g., "role" in a user-to-organization relationship) or an embedded reference list (fine for small, rarely-changing N:M sets).
3. Note directionality of access: do you primarily query "given A, find all B" or "given B, find all A" or both? This affects indexing (see Indexes) and, in NoSQL, which side owns the denormalized copy.

**Worked example — Ride-Sharing.** `Rider 1—N Ride` (a rider has many rides over time), `Driver 1—N Ride` (similarly), `Ride 1—1 Driver` at a point in time (once matched). No natural N:M here — a clean set of 1:N relationships, which keeps the schema simple.

**Worked example — Social Feed.** `User N—M User` (follows relationship) is the classic N:M case; because "follows" itself might carry a `followed_at` timestamp, model it as an explicit `Follow` entity/edge, not just an embedded array on each `User`.

**Common mistakes.** Modeling an N:M relationship as two embedded arrays on both sides (leads to consistency drift — updating one side without the other). Not identifying the dominant query direction before deciding storage layout, which becomes expensive to fix later in a NoSQL system with no cheap ad-hoc joins.

### Access Patterns

**What it means in an interview context.** This is the single most important data-modeling skill for NoSQL-heavy interviews (and increasingly expected even in SQL-context interviews): **design the schema around how data will be queried, not just what the data conceptually is.** In SQL you can somewhat get away with a normalized entity model and add indexes/joins later; in NoSQL (DynamoDB, Cassandra-style wide-column stores), the partition/sort key design *is* the query design, decided up front.

**Step-by-step method.**
1. List every read query your core flow needs, in the exact shape it will be called ("get all rides for a rider, most recent first," "get the current active ride for a driver," "get a short URL's long URL by code").
2. For each query, identify what key(s) it filters/sorts by.
3. Design the primary key (and any secondary indexes / GSIs) so that each listed query is answerable with a single, direct lookup — not a full scan or an application-side join.
4. If two access patterns need incompatible key layouts, either add a secondary index, maintain a denormalized second copy of the data keyed differently, or (if using SQL) accept the join/index cost as a trade-off — and say which you chose and why.

**Worked example — Ride-Sharing "find nearby available drivers."** The natural entity model (`Driver` keyed by `driver_id`) doesn't answer "who's near this lat/lng" efficiently. Access-pattern-first modeling says: maintain a geo-indexed structure (geohash-prefixed partition key, or a specialized geospatial index/store — see Stage 2) keyed for proximity queries, separate from the `driver_id`-keyed profile table. Two different physical layouts for two different access patterns on data that's conceptually "the same driver."

**Worked example — URL Shortener.** Only one dominant access pattern: "get long_url by code." This is why a simple key-value store (or a single-indexed SQL table) is sufficient — no need for a complex schema when there's really one query to serve.

**Common mistakes.** Designing the schema by asking "what is this data" (entity-first) instead of "how will this be queried" (access-pattern-first) — the classic mistake when candidates carry over SQL habits into a NoSQL answer. Trying to force one key design to serve every access pattern instead of accepting a second denormalized copy when patterns genuinely conflict. Not listing access patterns explicitly before touching the schema.

### SQL vs NoSQL Decision Framework

**What it means in an interview context.** This is a decision, not a preference — interviewers want the *criteria* you used, not just the label you picked. (Full deep dive on specific stores is Stage 2; this is the decision framework you apply during HLD.)

**Step-by-step decision checklist — lean SQL when:**
- Data is naturally relational and you need multi-entity transactions (e.g., financial ledgers, order+inventory updates) — strong consistency (ACID) matters.
- Access patterns are varied/ad-hoc and not fully known upfront (analytics, admin tooling, evolving product).
- Data volume/QPS is moderate enough that a well-indexed relational store (plus read replicas) meets the NFRs.

**Lean NoSQL when:**
- Access patterns are few, well-known, and demand extreme scale/low-latency single-key lookups (Phase 2's numbers show hundreds of thousands of QPS).
- Schema is naturally flexible/evolving per-record (varied attributes across items).
- You need horizontal write scalability beyond what a single relational primary can offer, and can tolerate eventual consistency for the relevant fields (tie back to Phase 1's NFR discussion).
- Data model is inherently key-value, wide-column, document, or graph-shaped (state which of these four sub-flavors and why — "NoSQL" alone is not a specific enough answer).

**Worked example — Ride-Sharing.** Ride/trip records with a fixed, transactional need (must never double-assign a driver) → lean relational (or a strongly-consistent NoSQL store with transactions, e.g., DynamoDB transactions) for the `Ride` entity. Live location pings → high write volume, simple key(driver_id)-based access, tolerant of loss → a NoSQL/in-memory store (e.g., Redis with geospatial commands, or a wide-column store) is the better fit. **Note this is one system using two different storage decisions for two different entities** — a strong, senior-level answer states this explicitly rather than picking one database for the whole system.

**Common mistakes.** Treating "SQL vs NoSQL" as one binary choice for the entire system instead of an entity-by-entity (or even table-by-table) decision. Choosing NoSQL purely because "it scales better" without checking whether the access pattern and consistency needs actually fit. Not naming the specific NoSQL sub-type (document/key-value/wide-column/graph) — this signals shallow knowledge.

### Keys

**What it means in an interview context.** Choosing a primary key well affects uniqueness guarantees, index performance, and (in distributed systems) which node owns a given record. This is a small-sounding decision with large downstream consequences.

**Step-by-step method.**
1. Decide natural key vs. surrogate key: a natural key (e.g., email, short-code) is meaningful but can change or collide; a surrogate key (UUID, auto-increment, or a generated short code) is stable and preferred for internal references.
2. For distributed/high-write systems, prefer non-sequential surrogate keys (UUID, or a Twitter-Snowflake-style time-ordered distributed ID) over simple auto-increment, because a monotonically increasing key concentrates writes on one shard/node ("hotspotting" — see Phase 6).
3. If a human-facing identifier is also needed (like a short URL code), separate concerns: an internal surrogate key for storage/joins, and a public-facing code that may be derived from or independent of it.

**Worked example — URL Shortener.** The short code itself (e.g., `aZ9k2`) can double as the primary key directly (base62-encoded counter or hash-based) — a case where the public-facing key and the storage key are deliberately the same, because there's exactly one access pattern (lookup by code) and no need for a separate surrogate ID.

**Common mistakes.** Defaulting to auto-increment integer keys in a system that will eventually be sharded (creates a hotspot on the "latest" shard and leaks information about record count/order). Not distinguishing an internal storage key from a public-facing identifier when they have different stability/security requirements (e.g., exposing sequential integer order IDs publicly can leak business volume information).

### Indexes

**What it means in an interview context.** Indexes are what make your Access Patterns fast. Every query you listed in the Access Patterns step should map to either the primary key or an explicit secondary index — if it doesn't, say so and flag it as a full scan (usually a red flag you should fix).

**Step-by-step method.**
1. For each access pattern that isn't served by the primary key, propose a secondary index on the filter/sort field(s).
2. State the cost of each index explicitly: indexes speed up reads but slow down writes (every write updates every index) and consume additional storage — this is a genuine trade-off, not a free lunch.
3. For composite queries (filter by A, sort by B), consider a composite index on (A, B) rather than two single-column indexes.
4. In NoSQL systems, this is the Global Secondary Index (GSI) / Local Secondary Index (LSI) decision — mention that GSIs have their own throughput provisioning and eventual consistency characteristics (Stage 2 territory, but worth a one-line callout here).

**Worked example — Ride-Sharing.** Primary access: `Ride` by `ride_id` (primary key, no index needed). Secondary access pattern: "get all rides for a rider, most recent first" → composite index on `(rider_id, created_at)`. Without this index, that query would require a full table scan filtered by `rider_id` — clearly unacceptable at scale.

**Common mistakes.** Proposing an index for every conceivable query without weighing the write-amplification cost. Forgetting that a query filtering on a non-indexed field will silently degrade to a full scan in production, often not caught until real scale. Not distinguishing single-column vs. composite index needs when queries filter and sort together.

### Partition Keys

**What it means in an interview context.** In a sharded/distributed data store, the partition key decides which physical node/shard a record lives on. This is arguably the single highest-leverage data-modeling decision in a system that must scale horizontally — a bad partition key produces hotspots that no amount of later tuning fully fixes without a re-shard.

**Step-by-step method / checklist for a good partition key:**
1. **High cardinality** — many distinct values, so records spread across many shards (a `country` field with 5 values is a bad partition key for a global system; a `user_id` with millions of values is good).
2. **Even access distribution** — not just many values, but *access* to those values should be roughly even (a celebrity `user_id` in a social system can still create a hotspot even with high cardinality overall — see Hotspot Handling).
3. **Aligned with the dominant access pattern** — the partition key should be the field your most frequent/critical query filters by, so that query hits one shard instead of fanning out across all of them (a "scatter-gather" query across every shard is expensive and should be the exception, not the norm).
4. **Stable over the record's lifetime** — changing a record's partition key after creation typically means physically moving it, so avoid keys built from mutable fields.

**Worked example — Ride-Sharing location pings.** Partition key candidate: `driver_id` — high cardinality, evenly accessed (each driver pings roughly equally often), matches the access pattern ("update this driver's current location"), and stable. Compare to a bad alternative: partitioning by `city` would create a hotspot on high-traffic cities (San Francisco, NYC) while other partitions sit idle.

**Worked example — URL Shortener.** Partition key = the short `code` itself (or a hash of it) — high cardinality, evenly distributed if codes are randomly generated (not if they're sequential — reinforcing the Keys section's point about avoiding monotonic keys in distributed stores).

**Common mistakes.** Picking a low-cardinality field (status, country, boolean flag) as the partition key. Picking a high-cardinality field that's still access-skewed (a "trending post" or "celebrity user" scenario) without a hotspot mitigation plan. Choosing a partition key that doesn't match the dominant query, forcing scatter-gather queries across all shards for the common case.

### Data Ownership

**What it means in an interview context.** At the data-modeling level (as distinct from the service-level ownership in Phase 5), data ownership means: for each entity, which single system is the source of truth, and which systems hold read-only denormalized copies. Getting this muddled leads to split-brain writes and unclear reconciliation logic.

**Step-by-step method.**
1. For each entity, name exactly one owning store/service that can write it.
2. Any other place the data appears (a cache, a search index, a denormalized copy in another entity) is explicitly a *derived, read-only copy* — state how it's kept in sync (write-through, async event, periodic batch — Stage 1/Stage 2 territory) and what staleness window is acceptable.
3. Flag any entity where ownership is ambiguous (a classic sign of an under-designed system) and resolve it before moving to Phase 5.

**Worked example.** `Ride` status is owned by the Trip/Ride service; a denormalized `current_ride_status` field cached on the Driver's live-location record (for a fast "is this driver busy" check) is a derived copy, updated asynchronously via an event when the Ride service changes status, with an accepted staleness window of a few hundred milliseconds.

**Common mistakes.** Letting two services both write directly to the same entity's canonical record (no clear owner) — this is the root cause of a large share of real-world data-consistency bugs. Treating a denormalized copy as if it were as fresh/authoritative as the source of truth when reasoning about correctness elsewhere in the design.

---

## Phase 5 — Architecture Decomposition

### Service Boundaries

**What it means in an interview context.** This is where you decide how many boxes appear on your final diagram and what each one is responsible for. Good service boundaries follow from the FRs and data ownership you've already established — they are not chosen first and rationalized after.

**Step-by-step method.**
1. Group your FRs and entities by which ones change together and are owned by the same team/concern (this is the DDD "bounded context" instinct, formalized below).
2. Draw a boundary around each group as a candidate service; each boundary should own its own data (Phase 4's Data Ownership, promoted to the service level).
3. Check each boundary against a single-responsibility gut check: can you describe what this service does in one sentence without an "and"? If not, it's probably two services (or you're prematurely splitting one).
4. Check for chatty boundaries: if two "services" need to call each other synchronously on every single request to do anything useful, reconsider whether they're really one service or whether the boundary is drawn wrong (see also Monolith vs Microservices, next).

**Worked example — Ride-Sharing.** Candidate services: **Rider Service** (rider profile, ride requests), **Driver Service** (driver profile, availability, live location), **Matching/Dispatch Service** (finds a driver for a request), **Trip Service** (owns `Ride` lifecycle/state machine once matched). Each has one sentence of responsibility and one owned data store.

**Common mistakes.** Drawing service boundaries around technical layers (a "database service," a "business logic service") instead of business capabilities — this produces boundaries that don't reduce coupling. Creating a service per entity mechanically without checking for excessive chattiness between them. Not being able to state each service's responsibility in one sentence.

### Monolith vs Microservices

**What it means in an interview context.** This is a decision framework, not a dogma — interviewers at senior/staff level specifically want to hear you *not* default to microservices, and instead reason about team size, deployment independence needs, and actual scaling needs per component.

**Decision framework — lean monolith (or "modular monolith") when:**
- Team is small (roughly, one team can own the whole codebase without excessive coordination overhead).
- Components don't need independent scaling — their load profiles are similar.
- The domain boundaries are still being discovered (early-stage product) — splitting too early on guessed boundaries is expensive to undo.
- Operational simplicity matters more than deployment independence (fewer moving parts, one deployment pipeline, simpler transactions/joins).

**Lean microservices when:**
- Different components have very different scaling profiles (Phase 2's numbers show, e.g., the matching service needs 100x the throughput of the billing service) — splitting lets you scale each independently.
- Multiple independent teams need to own and deploy their piece without blocking on each other.
- Fault isolation matters (one component's failure/overload shouldn't take down unrelated functionality).
- Domain boundaries are already well-understood and stable (often true for a company re-architecting a known product, less true for a brand-new startup idea).

**Worked example — Ride-Sharing at scale.** Given Phase 2-style numbers (location pings at very high write QPS vs. trip billing at low QPS with strict consistency needs), microservices make sense here specifically *because* the scaling profiles genuinely diverge — not as a default architectural style. State this explicitly: "I'm splitting these into separate services primarily because their throughput and consistency requirements are so different, not because more services is inherently better."

**Common mistakes.** Defaulting to microservices because it's the "expected" interview answer — interviewers specifically probe this and reward candidates who push back with "do we actually need this split given the scale we estimated?" Defaulting to a monolith and never revisiting the decision even after the numbers clearly show divergent scaling needs. Not naming the actual criteria (team size, scaling divergence, fault isolation, deployment independence) and instead giving a generic "microservices are more scalable" answer.

### Domain Boundaries (DDD Bounded Contexts)

**What it means in an interview context.** Domain-Driven Design's "bounded context" concept — the idea that the same real-world word can mean different things in different parts of the system, and each part should have its own model rather than forcing one shared "universal" model — is a useful lens for justifying service boundaries at Staff level, even without a deep DDD background.

**Step-by-step method (lightweight, interview-appropriate version).**
1. Look for a word/entity that means subtly different things to different parts of the system (a classic sign of separate bounded contexts).
2. Confirm each context can have its own local model of that entity, translated at the boundary rather than forced into one shared schema.
3. Use this as justification for a service split, not as an academic exercise — tie it back to Phase 5's Service Boundaries decision.

**Worked example — Ride-Sharing "Driver."** To the **Matching Service**, a `Driver` is mostly: current location + availability status + vehicle type — just enough to run a matching algorithm. To the **Payments/Payout Service**, a `Driver` is: bank account details, tax status, earnings history — an entirely different set of concerns. Forcing one giant `Driver` model shared by both contexts creates a bloated, tightly-coupled entity that every team is afraid to change. Bounded contexts say: let Matching and Payments each have their own narrow `Driver` view, linked by a shared `driver_id`, translated at integration points.

**Common mistakes.** Trying to build one "canonical" entity model shared across all services (the anti-pattern DDD bounded contexts specifically warns against) — this is a common instinct for engineers coming from a single-database monolith background. Treating DDD as requiring heavyweight ceremony (this lightweight version — "does this word mean different things in different parts of the system?" — is enough for interview purposes).

### Data Ownership (Service Level)

**What it means in an interview context.** This extends Phase 4's entity-level data ownership to the service level: **each service owns its own datastore, and no other service reaches into it directly.** This is one of the most load-bearing rules in a microservices architecture, and violating it is one of the fastest ways to turn "microservices" into "a distributed monolith with all the downsides and none of the benefits."

**Step-by-step method.**
1. For each service from Phase 5's Service Boundaries, assign exactly one datastore it owns and writes to.
2. State the rule explicitly: other services must go through this service's API (sync call or async event) to read/affect its data — never direct database access across a service boundary.
3. For data another service needs frequently (e.g., Matching Service needs driver availability, which the Driver Service owns), decide: synchronous API call (simple, adds a dependency/latency), or an async event-driven denormalized copy (the Matching Service keeps its own fast local cache of "available drivers," kept in sync via events published by the Driver Service).

**Worked example.** The Trip Service owns the `Ride` table exclusively. The Matching Service, when it needs to check ride status, calls the Trip Service's API — it never queries the Trip Service's database directly, even though technically nothing stops it. This rule is exactly what preserves the ability to change the Trip Service's internal schema without breaking other services.

**Common mistakes.** Allowing "just this once" direct cross-service database access for convenience/performance (this erodes the entire boundary and is very hard to walk back later). Not deciding upfront whether cross-service data needs are served synchronously or via an async denormalized copy — leads to ad hoc, inconsistent patterns across the system.

### Sync vs Async Communication

**What it means in an interview context.** Once you have multiple services, you need to decide, boundary by boundary, whether they call each other synchronously (REST/gRPC, caller waits) or asynchronously (message queue/event stream, caller doesn't wait for the receiver to finish). This is one of the highest-signal decisions in a multi-service HLD — the same system can be resilient or fragile depending on where sync calls are used.

**Step-by-step method.**
1. For each inter-service dependency, ask: "Does the caller need the result immediately to respond to its own caller?" If yes → sync call. If no (fire-and-forget, eventual side effect) → async.
2. Ask: "If this downstream service is slow or down, should the caller's whole request fail, or should it proceed and let the effect happen eventually?" This is really asking about failure coupling — sync calls couple availability (Stage 1/Stage 2: your service's availability is now bounded by the callee's), async calls decouple it.
3. Prefer async (via a message queue/event bus) for: notifications, analytics/logging, any "and also do X" side effect that isn't required for the immediate response, and for smoothing bursty load (a queue absorbs a spike that would otherwise overload a downstream sync call).
4. Keep sync for: anything the immediate response genuinely depends on (can't return a successful ride-request response without actually knowing a driver was found).

**Worked example — Ride-Sharing.** Rider requests a ride → Trip Service synchronously calls Matching Service (needs the match result, or at least a "searching" acknowledgment, to respond). Once matched, Trip Service publishes a `RideMatched` event asynchronously — Notification Service consumes it to push a message to the rider's phone, and an Analytics Service consumes it independently for reporting. Neither consumer being slow/down should ever block or fail the core ride-matching flow — that's exactly the coupling async communication avoids.

**Common mistakes.** Making a notification/logging/analytics side effect a synchronous call in the critical path (now your core flow's availability is bounded by your logging system's availability — a real, embarrassingly common production incident pattern). Making everything async "for resilience," including calls whose result the caller genuinely needs before it can respond, which just moves the coupling into a more complex polling/callback pattern for no benefit. Not naming *why* a boundary is sync or async (should always be traceable to "does the caller need this result to proceed").

---

## Phase 6 — Scaling

### Statelessness

**What it means in an interview context.** A stateless service instance keeps no client-specific data in local memory/disk between requests — any instance can serve any request, which is the precondition for effortless horizontal scaling and painless failover. This is the "cheapest" scaling win, and interviewers expect it stated early, before jumping to more complex scaling mechanisms.

**Step-by-step method.**
1. For each service, check: does it store session/request state locally in a way that ties a client to a specific instance ("sticky sessions")?
2. If so, move that state to a shared external store (Redis/DB) keyed by session/user ID, so any instance can serve any request.
3. State the payoff explicitly: stateless services can sit behind a plain round-robin/least-connections load balancer, scale by simply adding instances, and can be killed/replaced without any special handoff.

**Worked example.** The API gateway/application servers in the ride-sharing system should be stateless — a rider's in-flight ride state lives in the Trip Service's database, not in the memory of whichever app server handled their last request, so any server can handle their next request (crucial after a deploy or an instance crash).

**Common mistakes.** Storing session state in local server memory "for speed" and then needing sticky load-balancing to compensate — this caps your scalability and complicates failover. Confusing "stateless service" with "no state anywhere in the system" (the state still exists — it just lives in a shared, external, scalable store, not pinned to one instance).

### Horizontal Scaling

**What it means in an interview context.** Horizontal scaling (add more machines) vs. vertical scaling (bigger machine) is foundational, and the interview expects you to default to horizontal for anything beyond a small/early-stage system, with vertical scaling mentioned only as a simple stopgap.

**Step-by-step method.**
1. State that stateless services (previous section) scale horizontally behind a load balancer almost for free — this is the easy win, mention it first.
2. For stateful components (databases), horizontal scaling requires either read replicas (for read scaling) or sharding (for write scaling) — covered next.
3. Mention vertical scaling only as: "a quick stopgap for a single bottleneck node, with a hard ceiling" — never as the long-term answer at the scale Phase 2 established.
4. Tie back to your Phase 2 peak QPS number: "at 60,000 peak QPS, we need roughly N application server instances assuming each handles ~M QPS" — showing the numbers actually drive the count, not just a vague "add more servers."

**Worked example.** Redirect service handling 60,000 peak QPS, each instance comfortably handling ~2,000 QPS → roughly 30 instances behind a load balancer, with auto-scaling to handle the daily peak/trough cycle rather than provisioning 30 instances permanently.

**Common mistakes.** Saying "just add more servers" without connecting it back to an actual QPS-per-instance estimate. Forgetting that horizontal scaling of *stateful* components (databases) is fundamentally harder than stateless ones and requires an explicit replication/sharding strategy, not just "add more DB servers."

### Caching

**What it means in an interview context.** (Full mechanics — cache-aside, write-through, eviction policies, cache invalidation strategies — live in Stage 1; here the focus is *where in this specific architecture* a cache belongs and *why*, justified by your Phase 2 read/write ratio and latency NFRs.)

**Step-by-step method.**
1. Identify hot read paths from your NFRs/read-write ratio (Phase 1, Phase 2) — caching is justified precisely where reads vastly outnumber writes and some staleness is tolerable.
2. Decide cache placement: CDN/edge (for static or rarely-changing, geographically-distributed content), application-level cache (Redis/Memcached in front of the DB for hot keys), or client-side cache (for data the client can safely hold briefly).
3. State the invalidation/staleness strategy explicitly (TTL-based expiry is the simplest and often sufficient; event-driven invalidation for stricter freshness — reference Stage 1 for the full trade-off).
4. Connect back to your latency NFR: "our p99 target is 50ms; a cache hit gets us ~1ms, a cache miss falls back to the DB at ~10-20ms — this only meets the target if our cache hit rate is high, which our read-heavy access pattern supports."

**Worked example — URL Shortener redirect path.** 100:1 read:write ratio, redirect latency target <50ms → cache `code → long_url` mappings in Redis with a generous TTL (mappings rarely change once created) or no TTL at all (invalidate explicitly on the rare update/delete). Cache hit serves the redirect in ~1-2ms; cache miss falls through to the primary datastore and populates the cache (cache-aside pattern, Stage 1).

**Common mistakes.** Adding a cache without connecting it to an actual read-heavy pattern established in Phase 2 (caching a write-heavy or rarely-re-read dataset provides little benefit and adds invalidation complexity for nothing). Not stating an invalidation strategy at all (a cache with no eviction/invalidation story is a correctness bug waiting to happen). Forgetting the failure mode: what happens on a cache-layer outage — does the system fall back to the DB (probably yes, but can the DB handle the full unsharded load if it does? — worth a one-line mention in Phase 7).

### Replication

**What it means in an interview context.** (Mechanics — leader-follower, multi-leader, quorum, replication lag — are Stage 1/Stage 2 territory.) Here, the HLD-level judgment is: replicate for *read scaling* and *durability/availability*, and be explicit about what consistency you're trading away.

**Step-by-step method.**
1. If read QPS (Phase 2) exceeds a single primary's capacity, or availability requires surviving a node failure, add read replicas.
2. State the consistency trade-off explicitly: replicas typically lag the primary by some amount — is that acceptable for the specific read in question (tie back to Phase 1's per-operation consistency answer)?
3. Decide routing: reads that must see the latest write (read-your-own-write cases) go to the primary or a synchronously-replicated replica; other reads can go to any replica.

**Worked example.** URL shortener redirect reads can tolerate a replica that's a few hundred milliseconds stale (a URL created seconds ago being briefly unavailable on a lagging replica is a rare, low-stakes edge case) — so redirects freely load-balance across read replicas. Contrast with the Ride-Sharing driver-assignment write, which must go to a strongly consistent primary (or a quorum-based store) because a stale read here risks double-assignment.

**Common mistakes.** Adding replication as a blanket "for scale" move without stating which reads are replica-safe and which aren't. Ignoring replication lag entirely when reasoning about correctness for a read-your-own-write scenario (a very common real bug: user creates something, immediately re-fetches it, hits a lagging replica, sees nothing, assumes creation failed).

### Sharding

**What it means in an interview context.** Sharding splits a single logical dataset across multiple physical nodes by key (Phase 4's Partition Keys decision, now realized physically) — this is what you reach for when a single primary can no longer handle the *write* volume or total data size, which replication alone doesn't solve (replication helps read scaling and durability, not write scaling).

**Step-by-step method.**
1. Confirm sharding is actually needed: check Phase 2's storage/write-QPS numbers against a single well-provisioned node's realistic ceiling — don't shard prematurely (the Worked Example in Storage Estimation showed a case, the URL shortener, that explicitly does *not* need sharding yet).
2. If needed, reuse the partition key already chosen in Phase 4 — sharding should follow naturally from that decision, not require a new one.
3. State how routing works: a shard map/directory service, consistent hashing, or range-based partitioning — and mention rebalancing cost when nodes are added/removed (consistent hashing minimizes this — a Stage 1/2 concept worth a one-line callback).
4. Flag cross-shard operations (queries or transactions spanning multiple shards) as the main new complexity sharding introduces, and state how you'll handle the ones your design actually needs (scatter-gather for rare cross-shard reads; avoid cross-shard transactions if at all possible).

**Worked example — Ride-Sharing location store, at very large scale.** Sharded by `driver_id` (matching Phase 4's chosen partition key) across many nodes, each handling a slice of the overall write volume. A query like "find nearby drivers" that's inherently geographic doesn't align with a `driver_id`-based shard, so it's served by a separate geo-indexed structure (as noted in Access Patterns) rather than by scattering a query across every shard.

**Common mistakes.** Sharding before the numbers justify it (a real cost: added operational complexity, harder transactions/joins, harder ad hoc querying — pay this cost only when Phase 2's numbers actually demand it). Choosing a shard key that doesn't match the dominant access pattern, forcing expensive scatter-gather queries for routine operations. Not mentioning cross-shard transaction/query complexity at all, which is the first follow-up question an interviewer will ask once sharding is on the board.

### Async Processing

**What it means in an interview context.** Beyond the sync/async *API* and *service-communication* decisions already covered (Phases 3 and 5), "async processing" at the scaling level specifically means: use a queue/stream to decouple a fast producer from a slower or bursty consumer, so the producer's latency and availability aren't bounded by the consumer's.

**Step-by-step method.**
1. Identify any step in your core flow that is slow, bursty, or not required for the immediate response (matches Phase 3's Sync vs Async APIs criteria, but now at the infrastructure level — a queue, not just an API contract).
2. Insert a message queue/stream between producer and consumer; the producer publishes and moves on, the consumer(s) process at their own pace, and the queue absorbs bursts (Phase 2's peak-vs-average gap is exactly what a queue smooths over).
3. State the delivery guarantee needed (at-least-once is the common default, requiring idempotent consumers — link back to Phase 3's Idempotency) and roughly how consumer scaling works (add more consumer instances/partitions as backlog grows).

**Worked example — Social Feed fan-out.** When a user with many followers posts, fanning out that post into every follower's feed synchronously would be far too slow and bursty for the write path. Instead: the post-creation API returns immediately after writing the post itself, and publishes a `PostCreated` event; a pool of fan-out worker consumers reads the event and asynchronously writes the post into each follower's feed cache, scaling worker count independently of the post-write rate.

**Common mistakes.** Not recognizing a fan-out/bursty step and instead doing it synchronously in the request path (classic cause of a slow, timeout-prone "create" endpoint for high-follower-count users). Introducing a queue but not addressing at-least-once delivery's implication (consumer logic must be idempotent, or duplicates cause bugs — e.g., a post appearing twice in a feed).

### Hotspot Handling

**What it means in an interview context.** Even a well-chosen partition key (Phase 4) can develop a hotspot when *access*, not just data volume, skews heavily toward one key — a celebrity user, a viral post, a popular ride pickup zone during a big event. This is a favorite "what if" follow-up interviewers ask after a candidate has already designed sharding/partitioning, specifically to test whether the design survives real-world skew.

**Step-by-step method / mitigation toolkit.**
1. Name the specific hotspot scenario relevant to your system (don't wait for the interviewer to ask — raising it yourself is a strong signal).
2. Apply one or more standard mitigations:
   - **Key salting/splitting**: append a random or round-robin suffix to a hot key to spread its writes across multiple physical partitions, then merge on read (e.g., a viral post's like-counter split into N sub-counters, summed on read).
   - **Caching the hot item aggressively** (an in-memory cache in front of the hot partition absorbs most read traffic before it reaches the store).
   - **Read replicas targeted at the hot shard** specifically, if the skew is read-heavy.
   - **Request coalescing** at the application/cache layer (many identical in-flight requests for the same hot key are collapsed into one backend request).
3. State the trade-off of your chosen mitigation (salting adds read-side merge complexity; caching adds staleness).

**Worked example — Ride-Sharing during a major event (stadium concert ending).** A huge spike of ride requests from one small geographic area could overwhelm the geo-partition covering that zone. Mitigation: cache the "available drivers in this geo-cell" result briefly (even a 1-2 second TTL meaningfully reduces load during a spike) and/or dynamically split an overloaded geo-cell into finer sub-cells during detected high load.

**Worked example — Social Feed celebrity post.** A celebrity's post like-counter receiving extreme write volume: split the counter into N shards internally (`like_count_shard_0` through `like_count_shard_N`), write to a randomly chosen shard, and sum all shards on read (with the sum itself cached, since it doesn't need to be perfectly real-time).

**Common mistakes.** Assuming a good partition key choice alone prevents all hotspots (it prevents *data-volume* skew, not necessarily *access-pattern* skew, which can appear even with a great key if one key becomes suddenly popular). Not having a concrete mitigation ready when the interviewer raises "what if this one key gets 100x normal traffic" — this is one of the most commonly asked follow-ups in the entire HLD interview format, and it rewards candidates who've thought about it before being asked.

---

## Phase 7 — Architecture Review

### Bottlenecks

**What it means in an interview context.** In the final review phase, you walk your own diagram and proactively name the single points of overload or slowness — this self-critique is often worth more credit than the initial design, because it shows you can evaluate your own work rather than just produce it.

**Step-by-step method.**
1. Walk each box and arrow on your diagram; for each, ask "what happens at peak QPS (Phase 2's number) here specifically?"
2. Identify the component most likely to saturate first (often: a single database primary taking all writes, or a synchronous call chain where the slowest link determines overall latency).
3. Propose the specific mitigation already covered in Phase 6 (cache, replica, shard, queue) rather than a vague "we'd scale it."

**Worked example.** In the ride-sharing design, the Matching Service's synchronous "scan nearby drivers" step is a likely bottleneck under a sudden demand spike in one area — mitigated by the geo-partitioning and hotspot handling already designed in Phase 6, referenced here as the answer.

**Common mistakes.** Only naming bottlenecks the interviewer explicitly asks about instead of proactively walking the whole diagram. Naming a bottleneck without connecting it to a specific, already-discussed mitigation (a bottleneck named with no fix is an incomplete answer).

### Failure Paths

**What it means in an interview context.** Every component fails eventually — the interview wants to see you reason about *what happens when X is down*, not assume happy-path forever. This is where you demonstrate operational maturity.

**Step-by-step method.**
1. Pick the 2-3 most critical components and ask "what does the rest of the system do if this is unavailable?" for each.
2. Distinguish graceful degradation (system does something reasonable but reduced) from hard failure (system stops working) — state which applies and whether that's acceptable given Phase 1's availability NFR.
3. Mention standard resilience patterns where relevant: retries with backoff, circuit breakers (stop calling a failing dependency to avoid cascading failure), timeouts, and fallback responses (e.g., serve slightly stale cached data rather than an error).

**Worked example.** If the Matching Service is down, can a rider still submit a ride request? Ideally yes — the request is accepted and queued (async processing, Phase 6), matched once the service recovers, rather than the whole ride-request flow hard-failing. If the geo-location cache is down, fall back to the primary datastore directly (slower, but not a hard failure) — a graceful-degradation answer.

**Common mistakes.** Only discussing failure of "the database" in the abstract without walking through specific dependent services. Not distinguishing graceful degradation from total outage — "it fails over" is not a complete answer without saying what the user actually experiences during that failover.

### Security

**What it means in an interview context.** Even in a systems-design (not security-focused) interview, basic security posture is expected: authentication/authorization boundaries, data-in-transit/at-rest protection, and abuse prevention. This is especially weighted heavily at a payments-adjacent company like PayPal.

**Step-by-step method.**
1. State the authentication mechanism at the API boundary (e.g., OAuth2/token-based auth for user-facing APIs, mTLS or service-to-service tokens internally).
2. State authorization: does a given request check that the caller is allowed to act on this specific resource (e.g., a rider can only cancel their *own* ride, not any ride by ID)?
3. Mention encryption in transit (TLS everywhere) and at rest for sensitive fields (PII, payment details) as a baseline, without over-indexing on cryptographic detail unless asked.
4. Mention basic abuse prevention: rate limiting (Stage 1 concept) at the API gateway to prevent scraping/abuse (e.g., a bad actor mass-generating short URLs, or scraping ride data).

**Worked example.** `POST /rides/{id}/cancel` must verify the authenticated caller's `user_id` matches the ride's `rider_id` (or is the assigned driver) — a missing authorization check here is a classic, concrete vulnerability worth naming explicitly rather than a generic "we'd add security."

**Common mistakes.** Treating security as an afterthought mentioned only if asked, rather than proactively raised in the review. Confusing authentication (who are you) with authorization (are you allowed to do this specific thing) — interviewers listen for this distinction. Ignoring rate limiting/abuse prevention entirely for a public-facing API.

### Observability

**What it means in an interview context. ** A system nobody can debug in production is an unfinished design. Interviewers want a one-line acknowledgment of how you'd know the system is healthy and how you'd diagnose it when it isn't.

**Step-by-step method.**
1. Name the three standard pillars briefly: metrics (QPS, latency percentiles, error rates per service — dashboards and alerting thresholds tied to your Phase 1 NFRs), logs (structured, correlate-able), and traces (follow one request across service boundaries in a multi-service system — directly useful given Phase 5's decomposition).
2. Tie an alert to a concrete NFR: "alert if p99 redirect latency exceeds our 50ms target for 5 minutes" is a stronger answer than "we'd have monitoring."
3. Mention a request ID / correlation ID propagated across service calls so a single user-facing request can be traced through the whole system.

**Worked example.** In the ride-sharing system, a single `request_id` generated at the API gateway is propagated through Trip Service → Matching Service → Driver Service, allowing an engineer to reconstruct the full path of one ride request across services when debugging a customer complaint ("my ride never matched").

**Common mistakes.** A vague "we'd add logging and monitoring" with no connection to specific NFRs or specific failure scenarios already discussed. Forgetting tracing/correlation IDs specifically in a multi-service (Phase 5) design, where cross-service debugging is otherwise very hard.

### Cost

**What it means in an interview context.** Every architectural choice has a cost implication, and being able to reason about cost trade-offs (not just technical elegance) is a Staff-level signal, especially at a cost-conscious enterprise.

**Step-by-step method.**
1. Name the 1-2 most expensive components in your design (usually: large-scale storage, cross-region replication/bandwidth, or over-provisioned compute for peak capacity).
2. Mention at least one lever to control cost: right-sizing compute to actual load (auto-scaling instead of provisioning for permanent peak), tiered storage (hot data on fast/expensive storage, cold data moved to cheaper storage after a TTL), or choosing a managed service vs. self-hosted based on team size/operational cost.
3. Explicitly connect a cost decision to an earlier NFR/constraint trade-off ("we could serve this from cache with a longer TTL, trading a bit of staleness for meaningfully lower database cost").

**Worked example.** URL shortener click-analytics data (if in scope) could dominate storage cost far more than the URL mappings themselves (as flagged back in Storage Estimation) — mitigate with a retention policy (roll up raw click events into daily aggregates after 30 days, delete raw events) rather than keeping every raw click event indefinitely.

**Common mistakes.** Never mentioning cost at all (common when candidates treat "infinite scale" as the only goal) — enterprise interviewers specifically listen for cost-awareness. Proposing an expensive solution (e.g., multi-region active-active everywhere) without weighing it against the actual availability NFR that justifies it.

### Trade-offs

**What it means in an interview context.** By this point in the interview, you've made a dozen decisions. The review phase is where you explicitly restate the 2-3 biggest ones as trade-offs — this shows self-awareness and gives the interviewer a natural entry point for follow-up questions.

**Step-by-step method.**
1. Pick the 2-3 decisions with the most significant alternative path not taken (e.g., "I chose eventual consistency for location updates to keep write latency low; the cost is a driver's shown location can be a few hundred milliseconds stale").
2. State each as: "I chose X over Y because [NFR/constraint]; the cost of this choice is Z."
3. Invite the follow-up: "happy to go deeper on any of these if useful."

**Worked example.** "I chose to shard the location store by `driver_id` rather than by geography, because it evenly distributes writes; the cost is that 'find nearby drivers' needs a separate geo-index rather than being a natural query on the primary store — I judged this worth it because write volume here is much higher than read volume."

**Common mistakes.** Not revisiting trade-offs at all, leaving the interviewer to infer whether you're aware of the paths not taken. Listing trade-offs as vague pros/cons without a clear "I chose X because of NFR Y" structure.

### Evolution (10x/100x Preview)

**What it means in an interview context.** The closing move of a strong HLD answer is showing that your design isn't a dead end — you can sketch, briefly, what breaks first as scale grows 10x or 100x, and what the next architectural change would be. (This is a preview — Stage 8 dedicates a full scaling-ladder exercise to this skill in depth; here, one or two sentences per jump is enough.)

**Step-by-step method.**
1. Take your Phase 2 numbers and imagine them 10x and 100x larger.
2. For each jump, name the first component that would break and the specific next architectural step (not a redesign from scratch — an incremental evolution of what you already built).
3. Keep this brief — a sentence or two per jump is sufficient; the goal is to show the design has a growth path, not to fully design the next stage live.

**Worked example — URL Shortener.**
- **10x** (10M writes/day, ~2.7TB over 5 years): still comfortably single-cluster; maybe add a read replica if redirect QPS also grew 10x.
- **100x** (100M writes/day, ~27TB+): likely need to shard the primary datastore by the partition key already chosen (short code hash) — the seam for this was deliberately built into Phase 4's key choice, so this is a scaling change, not a redesign.

**Worked example — Ride-Sharing.**
- **10x** ride volume: geo-partition cell size may need to shrink in dense cities to avoid hotspots (Phase 6); matching service adds more instances behind existing horizontal scaling.
- **100x**: likely need multi-region deployment (each region handles its own local geography largely independently, since a ride in Tokyo has no interaction with one in Chicago) — a natural fit given rides are inherently geographically localized, unlike, say, a global social feed.

**Common mistakes.** Skipping this section entirely (a design that visibly has no growth path reads as short-sighted). Proposing a full ground-up redesign for 10x growth instead of an incremental evolution of the existing design (a good design bends, it doesn't need to be replaced, for the first order of magnitude of growth). Spending too long here — this is a brief, confident preview, not the main event.

---

## The HLD Interview Checklist

Use this as a literal mental runbook, in order, during any HLD interview:

**Opening (first 5-10 minutes)**
- [ ] Restated the problem in one sentence and confirmed scope.
- [ ] Listed functional requirements; explicitly separated in-scope from out-of-scope.
- [ ] Asked about scale (DAU/MAU or QPS) before asking about consistency/latency.
- [ ] Asked read/write ratio and traffic shape (steady vs. spiky).
- [ ] Asked per-operation consistency/availability preference (not one blanket answer).
- [ ] Asked about constraints (compliance, existing systems, tech mandates).
- [ ] Stated assumptions out loud for anything not clarified, and kept a visible list.
- [ ] Prioritized (Must/Should/Could/Won't) and confirmed the plan with the interviewer.

**Capacity estimation**
- [ ] Converted DAU → daily actions (per FR) → average QPS → peak QPS, showing every step.
- [ ] Computed storage with per-record size, growth period, index overhead, and replication factor.
- [ ] Computed bandwidth for at least the dominant read or write path.
- [ ] Projected numbers forward (growth) and flagged when today's design would break.
- [ ] Used round numbers, stated every assumption, sanity-checked the final figures.

**API design**
- [ ] Modeled resources (nouns) before endpoints (verbs).
- [ ] Chose REST vs. RPC/gRPC per boundary, with a stated reason.
- [ ] Marked each endpoint sync or async, with a completion-notification story for async ones.
- [ ] Chose cursor-based pagination for any large/high-write list, offset only for small/static ones.
- [ ] Added idempotency keys to every non-idempotent write, especially anything money- or state-transition-related.
- [ ] Stated a versioning strategy and a backward-compatibility policy.

**Data modeling**
- [ ] Defined entities with fields/types, and relationships with cardinality.
- [ ] Listed access patterns explicitly before designing the schema (access-pattern-first for NoSQL).
- [ ] Made an explicit SQL-vs-NoSQL call per entity, with stated criteria, not one blanket choice.
- [ ] Chose keys deliberately (surrogate vs. natural, avoided naive auto-increment in distributed writes).
- [ ] Added indexes tied to specific access patterns, and acknowledged the write-cost trade-off.
- [ ] Chose a partition key with high cardinality, even access, and alignment to the dominant query.
- [ ] Named exactly one owner per entity; treated every other copy as derived and explained its sync strategy.

**Architecture decomposition**
- [ ] Drew service boundaries around business capabilities, each describable in one sentence.
- [ ] Justified monolith vs. microservices with actual criteria (team size, scaling divergence, fault isolation) — not by default.
- [ ] Applied a bounded-context lens to any entity that means different things in different parts of the system.
- [ ] Enforced one datastore owner per service; no direct cross-service DB access.
- [ ] Marked each inter-service call sync or async, tied to whether the caller needs the result to proceed.

**Scaling**
- [ ] Made application services stateless before reaching for anything more complex.
- [ ] Connected horizontal scaling counts back to actual peak QPS numbers.
- [ ] Justified caching by an actual read-heavy pattern from Phase 2, with a stated invalidation strategy and cache-outage fallback.
- [ ] Used replication for read scaling/durability, with an explicit consistency/staleness call.
- [ ] Only introduced sharding once the numbers justified it, reusing the Phase 4 partition key.
- [ ] Used async processing (queues) for bursty/non-critical-path work, with idempotent consumers.
- [ ] Proactively named at least one hotspot scenario and its mitigation.

**Review (last 5-10 minutes)**
- [ ] Walked the diagram and named the most likely bottleneck first to break.
- [ ] Named a failure path for at least 2-3 critical components, distinguishing graceful degradation from hard failure.
- [ ] Covered authentication vs. authorization, encryption, and basic rate limiting/abuse prevention.
- [ ] Named metrics/logs/traces and tied at least one alert to a real NFR.
- [ ] Named the most expensive component and one lever to control its cost.
- [ ] Restated the 2-3 biggest trade-offs explicitly, in "I chose X over Y because Z" form.
- [ ] Sketched, briefly, what breaks at 10x and 100x and the next incremental step — not a redesign.

---

> **Framing question, revisited:** *How do I go from ambiguous requirements to a defensible architecture?*
>
> The answer this stage teaches is: **you don't skip steps, and you narrate every one of them.** Requirements before numbers, numbers before contracts, contracts before schemas, schemas before service boundaries, boundaries before scaling mechanics, and a deliberate self-review before you call it done. A defensible architecture isn't the one with the most boxes or the fanciest technology named — it's the one where every box, every arrow, and every technology choice can be traced back, out loud, to a requirement, a number, or a stated trade-off. That traceability *is* the skill this stage builds, and it is exactly what carries forward into Stage 5 and beyond as the systems you're asked to design grow larger and more open-ended.
