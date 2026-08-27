# Senior Java Lead / Architect Quick Revision
Last updated: 2026-08-27

_Use this file before interviews. Use the deep-dive files only when a topic feels weak._

## How To Use This Study Set

The existing notes are intentionally deep. They are good for learning, but too heavy for daily
revision. For interview preparation, use three reading modes:

| Mode | Time | Use when | What to read |
|---|---:|---|---|
| Quick scan | 30-45 min | Before/after work, daily revision | This file only |
| Focused revision | 2-3 hours | A topic feels rusty | The relevant deep-dive topic and its interview questions |
| Mock prep | 45-60 min | Weekend or day before interview | One HLD/LLD prompt + verbal explanation |

## The 17-Year Profile Bar

For a Java Lead / Architect, interviewers are not only checking whether you know Java syntax or
Spring annotations. They are checking whether you can:

- Explain trade-offs clearly.
- Design systems that survive failure.
- Choose consistency, latency, cost, and reliability deliberately.
- Lead migration and modernization conversations.
- Debug production issues from symptoms to root cause.
- Mentor teams toward maintainable design.
- Communicate decisions in simple language.

Your answers should sound like: "Here is what I would choose, here is why, here is what can fail,
and here is how I would operate it in production."

## Quick Decision Tree for Any System Design Question

**Stuck? Use this in 30 seconds:**

1. **What's the consistency requirement?**
   - Financial, payment-critical, inventory counts → **Strong consistency (SQL, ACID, row locks)**
   - Social feeds, recommendations, search rankings → **Eventual consistency (cache, replicas, async)**
   - User auth/credentials → **Strong consistency, always**

2. **What's the scale of writes?**
   - <1K/sec → Single database with read replicas (e.g., PostgreSQL primary + replicas)
   - 1K-10K/sec → Database sharding by partition key
   - 10K-100K/sec → Sharded database + cache layer (Redis)
   - >100K/sec → Specialized store (Redis counter, Kafka topic, time-series DB like Cassandra)

3. **What data model fits?**
   - Related data across multiple entities (orders → items → shipments) → **SQL/relational**
   - Simple lookups by key (user profile by ID, product by SKU) → **NoSQL/KV store**
   - Immutable append-only (ledger entries, events, audit logs) → **Event log / ledger / append-only**
   - Time-series (metrics, location pings, logs) → **Time-series DB (InfluxDB, Cassandra) or object store**

4. **Where is failure most costly?**
   - **Money moving** → Idempotency + double-entry ledger + reconciliation + strong consistency
   - **Availability/user experience** → Redundancy + failover + circuit breakers + graceful degradation
   - **Latency** → Cache + async + denormalize + read replicas
   - **Correctness** → ACID transactions + strong consistency + comprehensive testing

## Priority Reading Order

If interview time is limited, do not read everything from top to bottom.

| Priority | File | Why it matters |
|---:|---|---|
| 1 | [08-staff-principal-architecture.md](08-staff-principal-architecture.md) | Builds senior/architect trade-off language |
| 2 | [05c-hld-mastery-level5-6-marketplace-and-fintech.md](05c-hld-mastery-level5-6-marketplace-and-fintech.md) | Best for PayPal/Visa/payment-style system design |
| 3 | [java-core-jvm-deep-dive.md](java-core-jvm-deep-dive.md) | Java/JVM depth expected from a senior Java profile |
| 4 | [spring-boot-microservices-deep-dive.md](spring-boot-microservices-deep-dive.md) | Spring Boot, microservices, security, observability |
| 5 | [03-reliability-resilience-production-engineering.md](03-reliability-resilience-production-engineering.md) | Production maturity: timeouts, retries, SLOs, incidents |
| 6 | [07b-lld-practice-problems.md](07b-lld-practice-problems.md) | LLD practice with class modeling |
| 7 | [09-interview-mastery.md](09-interview-mastery.md) | How to perform in the interview room |

## Java / JVM Must-Know List

Read the deep dive only for topics where you cannot explain the bullets below in 2-3 minutes.

### Language And Collections

- Functional interfaces: SAM, `@FunctionalInterface`, lambda vs anonymous class.
- Streams: lazy intermediate operations, terminal operations, parallel stream traps.
- Optional: return type use, avoid fields/parameters and `get()` without check.
- Records, sealed classes, pattern matching: where they improve domain modeling.
- `HashMap`: hashing, buckets, treeification, resizing, equals/hashCode contract.
- `ConcurrentHashMap`: lock striping/bin locking, weakly consistent iteration.

### Concurrency

- Java Memory Model: visibility, happens-before, `volatile`.
- `synchronized` vs `ReentrantLock` vs `ReadWriteLock`.
- ExecutorService: pool sizing for CPU-bound vs I/O-bound work.
- CompletableFuture: composition, exception handling, thread selection.
- CAS and atomics: compare-and-swap, ABA risk, when lock-free is useful.
- Deadlock: prevention using lock ordering, timeout, reducing shared state.
- Virtual threads: great for blocking I/O, not a cure for CPU-bound work.

### JVM And Performance

- Heap vs stack vs metaspace vs code cache.
- GC basics: G1 as common default, ZGC for low-latency/large heaps.
- Class loading: parent delegation, custom classloaders, classpath conflicts.
- JIT: warm-up, inlining, escape analysis, why microbenchmarks lie.
- Profiling: JFR, async-profiler, GC logs, thread dumps, heap dumps.

## Spring Boot / Microservices Must-Know List

### Spring Core

- Auto-configuration: conditional beans, starters, override rules.
- Dependency Injection: constructor injection, bean lifecycle, scopes.
- Transactions: proxy behavior, propagation, isolation, self-invocation trap.
- REST APIs: validation, error contracts, pagination, idempotency.
- Testing: unit, slice, integration, Testcontainers.

### Microservices

- Service boundaries: domain ownership, data ownership, transaction boundaries.
- API Gateway: routing, auth enforcement, rate limiting, observability.
- Service discovery: Kubernetes DNS vs Eureka/Consul, avoid double discovery.
- Resilience4j: timeout, retry, circuit breaker, bulkhead, rate limiter.
- Observability: logs, metrics, traces, correlation IDs.
- Security: OAuth/OIDC, JWT validation, mTLS, service-to-service auth.
- Kubernetes: readiness/liveness probes, graceful shutdown, config/secrets.

## System Design Must-Know List

For every HLD answer, cover these in order:

1. Clarify functional scope.
2. Clarify scale and traffic shape.
3. Identify consistency requirements.
4. Draw core services and data stores.
5. Explain write path and read path.
6. Choose data model and partition key.
7. Discuss caching and invalidation.
8. Discuss async processing and retries.
9. Discuss failure modes.
10. Discuss observability and operations.
11. Discuss security and compliance.
12. State trade-offs and future evolution.

## Payment / FinTech Must-Know List

For PayPal/Visa/banking-style interviews, be ready to explain:

- Idempotency key for payment initiation.
- Ledger as source of truth.
- Double-entry accounting.
- Authorization vs capture vs settlement.
- Wallet balance and available balance.
- Reconciliation between internal ledger and external processor.
- Refund and dispute handling.
- Fraud scoring as synchronous plus asynchronous layers.
- Exactly-once is usually "effectively once" using idempotency and deduplication.
- Never acknowledge money movement until the durable state is safely written.

## FinTech Design Checkpoints ✓

**Check these every single time you design a payment/wallet/ledger system:**

- [ ] **Idempotency key** present on every money-moving API call (payments, transfers, refunds)
- [ ] **Ledger as source of truth**, not a derived balance
- [ ] **Double-entry accounting** — every transaction: debit one account, credit another, always balanced
- [ ] **Reconciliation job** for recovering orphaned money states (payment captured but order not created, etc.)
- [ ] **Clear state progression**: authorization (hold funds) ≠ capture (move funds) ≠ settlement (batch to bank)
- [ ] **"Exactly-once" means idempotent + deduplication**, not guaranteed-once (external networks are unreliable)
- [ ] **External network can fail mid-flight** — support PENDING/IN_FLIGHT state, query to recover
- [ ] **Every state transition auditable** — ledger entries, event logs, event sourcing
- [ ] **Failure handling named explicitly** — "if processor times out, we..." (not "it won't happen")
- [ ] **Cascading failures prevented** — don't block A waiting for B; make B async or degrade gracefully

## LLD Must-Know List

For a Java lead, LLD should show clean design, not pattern memorization.

- Start with use cases.
- Identify entities, value objects, services, repositories, policies.
- Put behavior close to the domain object when appropriate.
- Use interfaces for real variability, not everywhere.
- Prefer composition over inheritance.
- Model state transitions explicitly.
- Show thread-safety when shared mutable state exists.
- Add extension points only where requirements justify them.
- Mention tests for important invariants.

Good practice problems:

- Parking lot: object modeling and pricing strategy.
- Vending machine: state machine.
- Elevator: scheduling and concurrency.
- Logger framework: chain/strategy/appender design.
- Cache: eviction policy and thread safety.
- Splitwise: domain model and algorithmic simplification.

## Behavioral Stories To Prepare

Prepare 8-10 real stories using STAR format.

| Story | What it proves |
|---|---|
| Production incident you led | Ownership, debugging, calm under pressure |
| Architecture migration | Planning, risk reduction, incremental delivery |
| Technical debt decision | Business trade-off maturity |
| Disagreement with senior stakeholder | Influence without authority |
| Mentoring a weaker engineer/team | Leadership |
| Performance issue solved | Deep technical diagnosis |
| Failed design or wrong assumption | Learning and accountability |
| Security/compliance improvement | Architect-level risk thinking |
| Cost optimization | Business-aware engineering |
| Cross-team platform change | Communication and governance |

## Time Management in a 60-Minute System Design Interview

**Follow this pacing to avoid running out of time or rambling:**

| Minute Range | Activity | What you're doing | Red flags if you're here |
|---|---|---|---|
| 0-5 | **Clarifying questions** | "How many users? What's the SLA? Strong or eventual consistency? Single region or global?" | Jumping straight into design; not asking scale questions; answering with assumptions |
| 5-12 | **High-level diagram** | 4-5 boxes: API Gateway → services → DB → cache; no detailed SQL or implementation yet | Too many boxes (15+); diving into tech minutiae; unclear data flow; no narrative |
| 12-28 | **Happy path walkthrough** | "User creates order → order service writes to DB → cache is invalidated → async event to fulfillment" | Vague ("it works"); unclear who owns what; too technical (showing SQL queries instead of logical flow) |
| 28-40 | **Failure modes & trade-offs** | "If payment processor times out, we hold txn in PENDING state and reconcile. This trades latency for correctness." | Brushing off with "the system is resilient"; not naming specific weaknesses; no explicit mitigations |
| 40-52 | **Scaling plan** | "At 10x traffic, we shard by user_id; at 100x, we split reads/writes and add geo-replication" | No numbers; hand-wavy ("just add more machines"); no partition key discussion; jumping to Kafka unnecessarily |
| 52-58 | **Observability, ops, compliance** | "How do we monitor? Who's on-call? Data residency?" | Treating as afterthought; vague ("we log everything") |
| 58-60 | **Closing & follow-ups** | Answer 1-2 rapid-fire follow-ups; state your top trade-off explicitly | Silence; pivoting to a completely different design; no clear closing |

**Pro tip:** If you finish the happy path by minute 20, you're ahead — spend extra time on failure modes (this is where interviews are won).

## Worked Example: "Design a Peer-to-Peer Payment System"

**Real interview scenario — follow the pacing above.**

### Minute 0-5: Clarifying Questions

**You ask:**
- How many users? How many daily active? _Answer: 10M users, 1M DAU._
- Payment scale? _1K payments/sec peak._
- Consistency? Do users need to see their balance instantly correct? _Yes, strong consistency — users trust balance._
- Regions? _Start single-region, but must be able to explain multi-region later._
- Settlement timeline? _Same-bank instant (internally), cross-bank T+1._

### Minute 5-12: High-Level Diagram

**You draw (on whiteboard/doc):**

```
┌─────────────────────────────────────────────────────────┐
│                     User App                            │
└────────────┬────────────────────────────────────────────┘
             │ POST /transfers
             ▼
┌─────────────────────────────────────────────────────────┐
│         API Gateway (validates, auth)                   │
└────────────┬────────────────────────────────────────────┘
             │
      ┌──────▼──────┐
      │              │
      ▼              ▼
┌──────────────┐  ┌──────────────────┐
│  Wallet Svc  │  │ Payment Processor │
│  (stateless) │  │   (external)      │
└──────┬───────┘  └──────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  PostgreSQL                      │
│  - accounts (balance)            │
│  - ledger_entries (audit trail)  │
└──────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Redis Cache                     │
│  - user balance (cached)         │
│  - TTL 5 min                     │
└──────────────────────────────────┘
```

**Narrative:** "Wallet Service is stateless, all money state lives in Postgres. Ledger is append-only, source of truth. Cache is purely for reads (balance), never for money-moving operations."

### Minute 12-28: Happy Path Walkthrough

**Scenario: User A sends $10 to User B**

1. **API call:** Client → `POST /transfers { toUserId: B, amount: 1000, idempotencyKey: "uuid-xxx" }`
2. **Wallet Service (stateless):**
   - Check idempotency key (DB lookup) — if exists, return cached result immediately
   - If new: read User A's balance from cache (or DB if cache miss)
   - Validate: User A has >= $10 available
3. **Database transaction (single, atomic):**
   ```
   BEGIN TRANSACTION
     INSERT INTO ledger_entries (account=A, debit, amount=1000)
     INSERT INTO ledger_entries (account=B, credit, amount=1000)
     UPDATE accounts SET cached_balance = cached_balance - 1000 WHERE account=A
     UPDATE accounts SET cached_balance = cached_balance + 1000 WHERE account=B
     INSERT INTO idempotency_keys (key="uuid-xxx", result="success")
   COMMIT
   ```
4. **Response:** Return success, User A's new balance to client
5. **Async:** Emit event `transfer.completed` → Notifications service sends receipt emails

**Key point:** "Everything money-moving is inside one DB transaction. Ledger is append-only (immutable). Balance is cached but backed by ledger, never autonomous."

### Minute 28-40: Failure Modes & Trade-Offs

**Scenario 1: Network timeout**
- "Client retries with same idempotency key → Wallet Service checks idempotency_keys table → returns previous result. No double-debit."
- *Mechanism:* `UNIQUE(idempotency_key)` constraint at DB level, not just app-level check.

**Scenario 2: Database crashes mid-transaction**
- "Transaction either fully commits or fully rolls back (ACID). Partial ledger entries never exist."

**Scenario 3: Balance cache stale**
- "Cache is used only for reads / balance display. Money-moving operations always read from DB in the transaction. OK if UI shows slightly stale balance for a few seconds."

**Scenario 4: Processor timeout (cross-bank transfer, if applicable)**
- "Payment processor call is async, separate from the ledger transaction. If processor times out: transaction stays in `PENDING` state. Reconciliation job queries processor's API to resolve."

**Explicit trade-off statement:** "We chose **strong consistency** (correct balances, ACID) over eventual consistency (faster writes, weaker guarantees) because users need to trust their balance is accurate. Cost: slightly higher DB latency, but acceptable for <1K/sec."

### Minute 40-52: Scaling Plan

**At 1K/sec today:**
- Single PostgreSQL primary + read replicas (replicas used for reporting/audits only, never for money-moving)
- Redis cluster for balance cache (sharded by user_id, doesn't matter if cache falls behind)

**At 10K/sec (10x traffic):**
- Shard Postgres by `user_id` (hash) → 8-16 shards
- Transfer within same shard: 1 DB transaction (fast)
- Transfer across shards: saga pattern (2-phase commit alternative) — reserve from sender shard, credit to receiver shard, compensate on failure
- *Explicit callout:* "Cross-shard transfers are harder — we'd need an orchestrator or saga engine. Worth asking: does the business need to support cross-shard transfers instantly, or can we batch them?"

**At 100K/sec (100x traffic):**
- Multiple Postgres clusters per shard; load balance within cluster
- Ledger becomes multi-table (sharded by account, not by transaction) to reduce contention
- Possibly move to event sourcing (Kafka) as the ledger, with Postgres as a replicated view

**Scaling visualization:**
```
1K/sec:   1 DB, cache
10K/sec:  8 sharded DBs, saga for cross-shard, cache
100K/sec: per-shard HA (primary + replica), ledger sharding, event log
```

### Minute 52-58: Observability & Compliance

**Monitoring:**
- "Alert if `idempotency_keys` table grows faster than transfer rate (indicates retry storm)"
- "Dashboard: transfers/sec, p99 latency, cache hit rate"
- "Alert on reconciliation job errors (orphaned ledger entries)"

**On-call:**
- "Wallet Service team owns P1 alerting. Processor integration team owns cross-bank transfer delays."

**Compliance:**
- "All ledger entries immutable and auditable for 7 years"
- "No balance ever goes negative without explicit overdraft approval (business rule)"
- "PII (names, accounts) in separate table, encrypted at rest if required by regulation"

### Minute 58-60: Closing

**Your closing statement:**
"The core design is simple: **Ledger is the source of truth, idempotency keys prevent double-charging, strong consistency is required, and every state transition is auditable.** The failure mode we care most about is processor timeout, which we handle with PENDING state + reconciliation. If you scale this 100x, the hardest part is cross-shard transactions — we'd probably move to event sourcing at that scale. Any questions?"

---

## Answer Templates

### Java Deep-Dive Answer

"At a high level, this works like X. The important internal detail is Y. In production, the risk is
Z. So my rule of thumb is A, except when B."

### Architecture Trade-Off Answer

"I would choose option A for this system because the main constraint is X. Option B is also valid if
Y matters more. The failure mode of A is Z, so I would mitigate it with these controls."

### Production Incident Answer

"First I would stabilize customer impact. Then I would identify the failing dependency or resource
saturation point using metrics, logs, and traces. After mitigation, I would add a prevention action:
alert, test, limit, or design change."

### Handling "Why Not [Trendy Tech]?" Answer

"I'd consider [tech] if the constraint it solves is a real bottleneck. Here, the constraint is [specific], which is solved better by [simpler choice]. [Trendy tech] would add operational complexity without addressing this system's actual problem."

## Final 7-Day Revision Plan

| Day | Focus | Success criteria |
|---:|---|---|
| 1 | Java/JVM quick revision + 10 Java questions | Can explain visibility, GC strategy, JIT in 2 min each |
| 2 | Spring Boot + microservices + transactions/security | Can name 3 Spring traps (self-invocation, propagation, proxy), explain circuit breaker |
| 3 | Distributed systems + reliability patterns | Can design a timeout/retry strategy for a given SLA, name partition tolerance trade-off |
| 4 | Payment/fintech HLD from `05c` | Can draw and walk payment processor design in 15 min, name 3 failure modes |
| 5 | LLD practice: cache, logger, vending machine | Can code-sketch 2 designs with thread safety, state machines |
| 6 | Staff architecture: migration, multi-region, ADR, cost | Can name explicit costs of each option (build vs buy, consistency vs availability) |
| 7 | Two mock interviews + behavioral stories | Can complete mock in 55 min with clear closing; can tell 2 stories with measurable outcomes |

## Common Interview Anti-Patterns (Avoid These)

- ❌ **Design without clarifying questions.** You'll optimize for the wrong metric. *Do:* Ask about users, SLA, consistency model, growth timeline.
- ❌ **Name technologies without explaining why.** "We'd use Kafka" is cargo-cult thinking. *Do:* Name the problem it solves ("to decouple order→fulfillment because fulfillment can fail independently").
- ❌ **Ignore the operational cost.** A design requiring 24/7 on-call heroics is only viable if revenue justifies it. *Do:* Ask: "Who operates this? What's the cost/benefit?"
- ❌ **Assume the interviewer wants every tool you know.** Depth > breadth. Pick 2-3 tools/patterns well. *Do:* Say "I'd use SQL here because..., but if [constraint], I'd use NoSQL instead."
- ❌ **Skip the failure modes section.** This is where interviews are won/lost. *Do:* Name 3 specific failures and your mitigation (not "it's resilient").
- ❌ **Treat idempotency as optional.** In any payment or money-moving system, non-idempotent retries = budget-killing production incident. *Do:* Name how idempotency keys are enforced (DB unique constraint, not app-level check).
- ❌ **Over-design for scale you don't have.** "At 10x traffic" should only come up if you've justified why the simple version breaks. *Do:* Start simple, explain the trigger that forces change ("when DB queries hit 10K QPS, we'd shard").
- ❌ **Ramble without a closing.** Interviewer's last impression is your parting statement. *Do:* End with: "In summary, we chose [option] because [constraint]. The failure we're most concerned about is [X], which we handle with [mitigation]."

## Bridging Technical to Behavioral (The Secret Weapon)

In the last 5 minutes, you often have a chance to connect your technical answer to a real story. **This is where you stand out.**

**Pattern 1: Learned from a mistake**
- "The idempotency-key pattern here isn't academic — we had a double-charge incident at [company] last year, $50K in refunds. Now I always start with: is this operation idempotent?"

**Pattern 2: You've operated what you're designing**
- "We chose strong consistency over eventual because I was on-call for a wallet service that had a balance-reconciliation bug — it cost us weeks of manual refunds. Now I design ledger systems around immutability."

**Pattern 3: You understand business trade-offs**
- "We chose to shard by user_id at 10K/sec, even though it added cross-shard complexity, because our biggest customer (30% of revenue) needed instant balance visibility. The operational cost was justified."

**Pattern 4: Humility about when to revisit**
- "If I'm designing this now, my first deploy is the simplest version — single DB, Redis cache. If we hit bottleneck X [specific metric], that's the signal to shard. I've seen teams over-engineer too early."

---

## Final 7-Day Revision Plan (Detailed Actions)

### Day 1: Java/JVM Foundations
- [ ] Explain visibility + happens-before in 2 min (focus: `volatile`, happens-before edges)
- [ ] Explain GC strategy choice (G1 vs ZGC, when each wins) in 2 min
- [ ] Explain JIT (warm-up, inlining, escape analysis) in 2 min
- [ ] Answer 10 random Java questions (use your deep-dive file)

### Day 2: Spring & Microservices
- [ ] Name 3 Spring traps (self-invocation, propagation, proxy) + how to avoid each
- [ ] Explain circuit breaker (open/half-open/closed, when it trips)
- [ ] Explain service discovery (DNS vs Eureka, trade-offs)
- [ ] Mock answer: "Design a service that calls 3 external APIs, one flaky" (add resilience)

### Day 3: Distributed Systems
- [ ] Design a timeout/retry strategy for SLA: "p99 latency <500ms"
- [ ] Explain CAP trade-off (consistency vs availability vs partition tolerance) with real example
- [ ] Explain quorum reads/writes, when to use
- [ ] Mock answer: "Design a multi-region active-active system"

### Day 4: Payment/FinTech HLD
- [ ] Walk through payment processor design (auth→capture→settle) in 15 min
- [ ] Name 5 specific failure modes + mitigation for each
- [ ] Explain idempotency key enforcement (DB unique constraint, not app-level)
- [ ] Mock answer: "Design a wallet system with 1K users → 1M users scaling"

### Day 5: LLD Practice
- [ ] Code-sketch a thread-safe cache with eviction policy (LRU)
- [ ] Design a state machine (vending machine: idle → accepting coin → dispensing)
- [ ] Explicitly name thread safety: locks, atomics, or immutability
- [ ] Bonus: Sketch a logger framework (appenders, levels, composition)

### Day 6: Staff Architecture
- [ ] Study one migration pattern (monolith→microservices OR database migration)
- [ ] Name explicit costs: build ($X) vs buy ($Y), consistency (Z ms latency) vs availability (A % downtime)
- [ ] Write a 2-page fake ADR (decision record): problem, options, choice, consequences
- [ ] Practice: "Should we build or buy a search service?" (don't just say "buy")

### Day 7: Mock Interviews
- [ ] **Mock 1 (55 min):** "Design an e-commerce checkout system" — follow pacing from worked example
- [ ] **Mock 2 (55 min):** "Design a ride-sharing matching service" (geo + real-time, harder)
- [ ] **Behavioral prep:** Tell 2 stories (STAR format) with measurable outcomes — practice out loud
- [ ] **Record yourself or have friend listen** — watch for filler words, rambling, unclear closings

---

## What Not To Do

- Do not memorize every paragraph from the deep dives.
- Do not answer with definitions only.
- Do not over-design every system as multi-region/event-driven/Kafka-based.
- Do not ignore production concerns.
- Do not skip behavioral preparation because the role is technical.

The goal is not to sound like a textbook. The goal is to sound like someone who has designed,
operated, repaired, and evolved real Java systems.
